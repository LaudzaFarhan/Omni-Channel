// Plan definitions.
//
// Limits used to be literals scattered across the codebase (`messageLimit: 500`
// at signup, `?? 500` at every read site, `|| 1` for sessions). Changing what
// "premium" meant required editing every user document by hand, so plans now
// live in Firestore under `plans/{planId}` and the app resolves a user's limits
// from their plan at read time.
//
// Precedence for any limit:
//   1. a per-user override stored on the user document (admin set it explicitly)
//   2. the value from the user's plan
//   3. the hardcoded fallback below, used only when the plans collection is
//      empty or unreachable
//
// Keeping the per-user field as an override means existing customers who were
// given a custom quota keep it when plans are introduced. The admin panel
// exposes a "reset to plan" action that deletes the override so the user starts
// tracking their plan again.
//
// Note: there is deliberately no "unlimited" sentinel. Every limit is a finite
// number, because the dashboard renders these values directly and an Infinity
// would leak into the UI. Use a large number instead.

import { fetchPlans } from './api.js';

export const PLANS_COLLECTION = 'plans';
export const DEFAULT_PLAN_ID = 'free';

// Last-resort values, matching the limits that were previously hardcoded.
export const HARD_FALLBACK = {
  messageLimit: 500,
  sessionLimit: 1,
  trialDays: 7,
};

// Seeded into Firestore by the admin panel when no plans exist yet.
export const FALLBACK_PLANS = [
  {
    id: 'free',
    name: 'Free',
    description: 'Trial access with a single device and a capped message quota.',
    price: 0,
    currency: 'IDR',
    messageLimit: 500,
    sessionLimit: 1,
    trialDays: 7,
    // The free plan is the trial, and the trial has its own expiry. Giving it a paid window
    // as well would mean two countdowns racing on the same account.
    durationDays: 0,
    features: [
      '1 WhatsApp device',
      '500 outbound messages',
      '7-day trial window',
    ],
    isDefault: true,
    archived: false,
    sortOrder: 0,
  },
  {
    id: 'premium',
    name: 'Premium',
    description: 'Paid tier with multiple devices and a high message quota.',
    price: 299000,
    currency: 'IDR',
    messageLimit: 50000,
    sessionLimit: 5,
    trialDays: 0,
    durationDays: 30,
    features: [
      '5 WhatsApp devices',
      '50,000 outbound messages',
      'Full chat history',
      'Priority support',
    ],
    isDefault: false,
    archived: false,
    sortOrder: 1,
  },
];

// Coerce a raw Firestore document into a predictable shape. Numeric fields
// arrive as strings when they were typed into the plan editor, and older
// documents may be missing fields entirely.
export function normalizePlan(id, raw = {}) {
  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };

  const price = num(raw.price, 0);

  return {
    id: raw.id || id,
    name: raw.name || id,
    description: raw.description || '',
    price,
    currency: raw.currency || 'IDR',
    messageLimit: num(raw.messageLimit, HARD_FALLBACK.messageLimit),
    sessionLimit: Math.max(1, num(raw.sessionLimit, HARD_FALLBACK.sessionLimit)),
    trialDays: num(raw.trialDays, 0),
    features: Array.isArray(raw.features) ? raw.features.filter(Boolean) : [],
    isDefault: Boolean(raw.isDefault),
    archived: Boolean(raw.archived),
    sortOrder: num(raw.sortOrder, 100),

    // Agent pricing. These must survive normalisation: the plan editor reads them
    // back from the normalised object, so dropping them here silently reset an
    // admin's add-on price to zero on the next save.
    //
    // basePrice falls back to the flat price so plans created before agent pricing
    // still show a figure.
    basePrice: num(raw.basePrice, price),
    includedAgents: Math.max(1, num(raw.includedAgents, 1)),
    addonAgentPrice: num(raw.addonAgentPrice, 0),
    // null is meaningful: unlimited. Only undefined falls back.
    maxAgents: raw.maxAgents === null || raw.maxAgents === undefined
      ? null
      : Math.max(1, num(raw.maxAgents, 1)),

    // How many days one purchase lasts. 0 means it never expires. Defaults to 30 rather
    // than 0 so a plan document written before subscription periods existed reads as the
    // billing period being sold, not as perpetual access.
    durationDays: raw.durationDays === undefined || raw.durationDays === null
      ? 30
      : num(raw.durationDays, 30),

    // This plan does not cap concurrent agents, so the UI shows an infinity indicator.
    // An explicit flag because there is deliberately no numeric unlimited sentinel — see
    // the note at the top of this file.
    unlimitedAgents: Boolean(raw.unlimitedAgents),

    // A per-unit top-up rather than a plan. Must survive normalisation for the same
    // reason the agent-pricing fields must: the plan editor reads its own form values
    // back from the normalised object, so dropping this here would silently turn an
    // add-on back into a plan on the next save.
    isAddon: Boolean(raw.isAddon),
  };
}

// Plan objects built from the fallback list, used when Firestore has no plans.
export function fallbackPlans() {
  return FALLBACK_PLANS.map(plan => normalizePlan(plan.id, plan));
}

export function sortPlans(plans) {
  return [...plans].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return (a.name || '').localeCompare(b.name || '');
  });
}

// Plans an admin can assign: archived plans stay resolvable for the users
// already on them, but are hidden from the assignment dropdown.
//
// Add-ons are excluded. They are top-ups, not plans — assigning one as somebody's
// plan would give them the add-on's message limit (typically nothing) in place of what
// they were paying for.
export function assignablePlans(plans) {
  return sortPlans(plans.filter(p => !p.archived && !p.isAddon));
}

export function getDefaultPlan(plans) {
  const list = plans && plans.length ? plans : fallbackPlans();
  return (
    list.find(p => p.isDefault && !p.archived) ||
    list.find(p => p.id === DEFAULT_PLAN_ID) ||
    sortPlans(list)[0]
  );
}

// `tier` was the original field name and still holds 'free' / 'premium' on every
// existing document, so it doubles as the plan id until a user is reassigned.
export function resolveUserPlanId(user = {}) {
  return user.planId || user.tier || DEFAULT_PLAN_ID;
}

export function findPlan(plans, planId) {
  const list = plans && plans.length ? plans : fallbackPlans();
  return list.find(p => p.id === planId) || getDefaultPlan(list);
}

// True when the user document carries an explicit numeric override.
function hasOverride(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

// Resolve the limits that actually apply to a user, and report where each value
// came from so the admin panel can distinguish "inherited" from "overridden".
//
// The agent (session) limit mirrors `resolveSessionLimitFor` in server/data.js:
//
//   users.session_limit    admin granted it explicitly
//   > users.purchased_agents  the customer paid for it
//   > plans.included_agents   what the plan comes with
//   > plans.session_limit     legacy column, for plans predating agent pricing
//   > 1
//
// Both sides must agree, otherwise a customer who buys 8 agents still sees
// "Allowed: 1" while the server happily lets 8 connect.
export function resolveEffectiveLimits(user = {}, plans = []) {
  const planId = resolveUserPlanId(user);
  const plan = findPlan(plans, planId);

  const messageOverridden = hasOverride(user.messageLimit);
  const sessionOverridden = hasOverride(user.sessionLimit);
  const agentsPurchased = hasOverride(user.purchasedAgents);

  let sessionLimit;
  let sessionLimitSource;
  if (sessionOverridden) {
    sessionLimit = Number(user.sessionLimit);
    sessionLimitSource = 'override';
  } else if (agentsPurchased) {
    sessionLimit = Number(user.purchasedAgents);
    sessionLimitSource = 'purchased';
  } else if (plan.includedAgents) {
    sessionLimit = plan.includedAgents;
    sessionLimitSource = 'plan';
  } else {
    sessionLimit = plan.sessionLimit;
    sessionLimitSource = 'plan';
  }

  return {
    planId: plan.id,
    plan,
    planName: plan.name,
    planMissing: plan.id !== planId,
    messageLimit: messageOverridden ? Number(user.messageLimit) : plan.messageLimit,
    sessionLimit: Math.max(1, sessionLimit),
    trialDays: plan.trialDays,
    messageLimitSource: messageOverridden ? 'override' : 'plan',
    sessionLimitSource,

    // How long a purchase of this plan lasts, for the countdown.
    durationDays: plan.durationDays,

    // Unlimited agents, but only while the plan is what decides the limit. An admin who
    // typed an explicit device override, or a customer who bought a specific number of
    // agents, has set a real ceiling — showing them an infinity symbol would contradict
    // the number the server actually enforces.
    unlimitedAgents: Boolean(plan.unlimitedAgents) && sessionLimitSource === 'plan',
  };
}

// The infinity indicator. A symbol rather than the word so it survives a narrow column, a
// stat box and a table cell without wrapping.
export const UNLIMITED_LABEL = '∞';

/**
 * Render an agent/device limit, showing unlimited as a symbol instead of a number.
 *
 * Every place that displays a seat count goes through this, so "unlimited" cannot end up
 * reading as a number in one panel and a symbol in another.
 */
export function formatAgentLimit(limit, unlimited) {
  if (unlimited) return UNLIMITED_LABEL;
  const parsed = Number(limit);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US') : '1';
}

// One-shot read of the catalogue, for code paths that need a plan outside of a
// live subscription (signup, profile repair). Falls back to the built-in list so
// a missing or unreadable collection never blocks account creation.
export async function loadPlansOnce() {
  const plans = await fetchPlans();
  return sortPlans(plans.map(plan => normalizePlan(plan.id, plan)));
}

export async function defaultPlanForSignup() {
  try {
    const plans = await loadPlansOnce();
    return getDefaultPlan(plans);
  } catch (err) {
    console.warn('[Plans] Could not read the plan catalogue, using built-in defaults:', err?.message);
    return getDefaultPlan([]);
  }
}

export function formatQuota(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '0';
  return parsed.toLocaleString('en-US');
}

export function planPriceLabel(plan) {
  if (!plan || !plan.price) return 'Free';
  const currency = plan.currency || 'IDR';
  return `${plan.price.toLocaleString('id-ID')} ${currency}`;
}
