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
//   trial_expired   not cleared by a purchase. A customer whose trial already expired
//                   stays blocked until an admin clears it on the Customers tab.
//
// That last one is worth knowing when approving a real payment by hand: marking the
// invoice paid does not by itself lift an expired-trial lockout.

import {
  findPlanById, findUserById, updateUser,
  setPurchasedAgents, addPurchasedAgents, recordAudit,
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
 * Returns { appliedPlan, appliedAgents, unfulfilled }, where `unfulfilled` is null on
 * success or a short reason code. It RESOLVES rather than throwing on a bad reference,
 * because the payment is real either way: the caller still has to record it and decide
 * what to tell the operator.
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

      console.log(`${logPrefix} Upgraded ${user.email} to ${plan.name} with ${agentsPaidFor} agent(s).`);

      const fresh = await findUserById(uid);
      // The supervisor's own row goes to their own tabs. It must not reach the
      // workspace room, where a member would receive a profile that is not theirs.
      io?.to(userRoom(uid)).emit('profile-updated', fresh);
      // The plan and the seat count just changed for everyone in the workspace,
      // so every member needs to re-resolve their limits.
      io?.to(uid).emit('workspace-updated', { planId: plan.id, agents: appliedAgents });
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
    },
    ip,
  });

  if (uid) {
    io?.to(uid).emit('payment-success', {
      transactionId: localTransactionId,
      planId: appliedPlan,
      agents: appliedAgents,
      timestamp: new Date().toISOString(),
    });
  }

  return { appliedPlan, appliedAgents, unfulfilled };
}
