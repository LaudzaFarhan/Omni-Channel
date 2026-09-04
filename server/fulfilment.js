// What a paid invoice actually grants.
//
// This was inlined in the Mayar webhook. It moved here when the admin console gained a
// manual Approve button, because two copies of "what does paying get you" is exactly the
// kind of duplication that drifts: the webhook would keep working while a hand-approved
// payment quietly granted something different, and nobody would notice until a customer
// complained about the plan they were charged for.
//
// Deliberately NOT touched, matching the webhook's long-standing behaviour:
//
//   session_limit   the admin's explicit override, which outranks anything purchased.
//                   Writing it here would silently discard a manually granted limit.
//   messages_sent   not reset by a purchase. The new allowance comes from the new plan's
//                   message_limit, not from zeroing the counter.
//
// What a plan purchase DOES now write, beyond the plan and the agents:
//
//   subscription_ends_at  the paid window, plan.duration_days long (30 by default).
//                         Extended from whichever is later, now or the current end date,
//                         so renewing early adds to what is left.
//   trial_expired         cleared. Paying is what resolves an expired trial. Before
//                         subscriptions had an end date there was nothing to express that
//                         with, so an admin had to clear the flag by hand after every
//                         payment — and a customer who had paid stayed locked out until
//                         somebody noticed.
//
// An ADD-ON deliberately does not touch the end date. A top-up buys agent slots inside the
// window the customer already has; extending the subscription because they bought one more
// agent would give away a period they did not pay for.

import {
  findPlanById, findUserById, updateUser,
  setPurchasedAgents, addPurchasedAgents, recordAudit,
  startSubscriptionPeriod,
} from './data.js';
import { isAddon, clampAgents, agentsGranted } from '../src/utils/pricing.js';
import { userRoom } from './scope.js';

/**
 * Apply a successful payment.
 *
 * @param io                Socket.IO server, for notifying the customer.
 * @param uid               The WORKSPACE the purchase belongs to.
 * @param planId            What was bought.
 * @param requestedAgents   Units paid for, or null for a payment that predates agent
 *                          pricing — each branch has its own sensible fallback.
 * @param actorUserId       Who is applying this. null for the webhook (nobody), the
 * @param actorEmail        admin's id/email for a manual approval, so the audit trail
 *                          distinguishes an automatic fulfilment from a human decision.
 * @param source            'webhook' | 'admin', recorded in the audit detail.
 * @param logPrefix         Bracketed tag for the console lines.
 *
 * Returns { appliedPlan, appliedAgents, subscriptionEndsAt, unfulfilled }, where
 * `unfulfilled` is null on success or a short reason code, and `subscriptionEndsAt` is set
 * only by a plan purchase. It RESOLVES rather than throwing on a bad reference, because the
 * payment is real either way: the caller still has to record it and decide what to tell the
 * operator.
 */
export async function applyPaidFulfilment({
  io,
  uid,
  planId,
  requestedAgents = null,
  actorUserId = null,
  actorEmail = 'mayar-webhook',
  source = 'webhook',
  logPrefix = '[Mayar Webhook]',
  localTransactionId = null,
  mayarTransactionId = null,
  amount = null,
  status = null,
  ip = null,
}) {
  let appliedPlan = null;
  let appliedAgents = null;
  let unfulfilled = null;
  // Only a plan purchase sets this. Stays null for an add-on, which buys agents inside the
  // window the customer already has.
  let subscriptionEndsAt = null;

  if (uid && planId) {
    const plan = await findPlanById(planId);
    const user = await findUserById(uid);

    if (!plan) {
      console.error(`${logPrefix} Paid for unknown plan "${planId}" — needs manual review.`);
      unfulfilled = 'unknown_plan';
    } else if (!user) {
      console.error(`${logPrefix} Paid for unknown user "${uid}" — needs manual review.`);
      unfulfilled = 'unknown_user';
    } else if (isAddon(plan)) {
      // A top-up. The plan is left exactly as it is — switching it here is what made
      // an "extra agent" product unusable, because a Premium customer who bought one
      // would land on the add-on and lose the message quota they were paying for.
      const units = requestedAgents === null ? 1 : clampAgents(plan, requestedAgents);
      const granted = agentsGranted(plan, units);

      const updated = await addPurchasedAgents(uid, granted);
      appliedPlan = user.planId;
      appliedAgents = updated?.purchasedAgents ?? null;

      console.log(
        `${logPrefix} ${user.email} bought ${plan.name} x${units}: ` +
        `+${granted} agent(s), now ${appliedAgents} total. Plan unchanged (${user.planId}).`
      );

      const fresh = await findUserById(uid);
      io?.to(userRoom(uid)).emit('profile-updated', fresh);
      io?.to(uid).emit('workspace-updated', { planId: user.planId, agents: appliedAgents });

      await recordAudit({
        actorUserId,
        actorEmail,
        action: 'payment.addon_applied',
        targetUserId: uid,
        detail: {
          localTransactionId, source,
          addonId: plan.id, units, grantedAgents: granted, totalAgents: appliedAgents,
        },
        ip,
      });
    } else {
      await updateUser(uid, { planId: plan.id });
      appliedPlan = plan.id;

      // Grant the agents that were paid for. Falls back to the plan's included
      // count for a payment made before agent pricing existed.
      const agentsPaidFor = requestedAgents === null
        ? plan.includedAgents
        : clampAgents(plan, requestedAgents);

      await setPurchasedAgents(uid, agentsPaidFor);
      appliedAgents = agentsPaidFor;

      // Start (or extend) the paid window, and lift any expired-trial lock. Runs before
      // the profile is re-read below, so the row pushed to the customer already carries
      // the new end date and their countdown updates without a reload.
      const renewed = await startSubscriptionPeriod(uid, plan.durationDays);
      subscriptionEndsAt = renewed?.subscriptionEndsAt ?? null;

      console.log(
        `${logPrefix} Upgraded ${user.email} to ${plan.name} with ${agentsPaidFor} agent(s)` +
        `${subscriptionEndsAt ? `, paid until ${new Date(subscriptionEndsAt).toISOString()}` : ' (no expiry)'}.`
      );

      const fresh = await findUserById(uid);
      // The supervisor's own row goes to their own tabs. It must not reach the
      // workspace room, where a member would receive a profile that is not theirs.
      io?.to(userRoom(uid)).emit('profile-updated', fresh);
      // The plan and the seat count just changed for everyone in the workspace,
      // so every member needs to re-resolve their limits.
      io?.to(uid).emit('workspace-updated', {
        planId: plan.id,
        agents: appliedAgents,
        subscriptionEndsAt,
      });
    }
  } else {
    console.warn(`${logPrefix} Payment carried no uid/planId and no local record — fulfil manually from the admin console.`);
    unfulfilled = 'missing_reference';
  }

  await recordAudit({
    actorUserId,
    actorEmail,
    action: 'payment.received',
    targetUserId: uid || null,
    detail: {
      localTransactionId,
      mayarTransactionId,
      planId,
      agents: requestedAgents,
      amount,
      status,
      source,
      appliedPlan,
      appliedAgents,
      subscriptionEndsAt,
    },
    ip,
  });

  if (uid) {
    io?.to(uid).emit('payment-success', {
      transactionId: localTransactionId,
      planId: appliedPlan,
      agents: appliedAgents,
      subscriptionEndsAt,
      timestamp: new Date().toISOString(),
    });
  }

  return { appliedPlan, appliedAgents, subscriptionEndsAt, unfulfilled };
}
