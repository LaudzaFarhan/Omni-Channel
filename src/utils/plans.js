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

import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase.js';

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

  return {
    id: raw.id || id,
    name: raw.name || id,
    description: raw.description || '',
    price: num(raw.price, 0),
    currency: raw.currency || 'IDR',
    messageLimit: num(raw.messageLimit, HARD_FALLBACK.messageLimit),
    sessionLimit: Math.max(1, num(raw.sessionLimit, HARD_FALLBACK.sessionLimit)),
    trialDays: num(raw.trialDays, 0),
    features: Array.isArray(raw.features) ? raw.features.filter(Boolean) : [],
    isDefault: Boolean(raw.isDefault),
    archived: Boolean(raw.archived),
    sortOrder: num(raw.sortOrder, 100),
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
export function assignablePlans(plans) {
  return sortPlans(plans.filter(p => !p.archived));
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
export function resolveEffectiveLimits(user = {}, plans = []) {
  const planId = resolveUserPlanId(user);
  const plan = findPlan(plans, planId);

  const messageOverridden = hasOverride(user.messageLimit);
  const sessionOverridden = hasOverride(user.sessionLimit);

  return {
    planId: plan.id,
    plan,
    planName: plan.name,
    planMissing: plan.id !== planId,
    messageLimit: messageOverridden ? Number(user.messageLimit) : plan.messageLimit,
    sessionLimit: Math.max(1, sessionOverridden ? Number(user.sessionLimit) : plan.sessionLimit),
    trialDays: plan.trialDays,
    messageLimitSource: messageOverridden ? 'override' : 'plan',
    sessionLimitSource: sessionOverridden ? 'override' : 'plan',
  };
}

// One-shot read of the catalogue, for code paths that need a plan outside of a
// live subscription (signup, profile repair). Falls back to the built-in list so
// a missing or unreadable collection never blocks account creation.
export async function loadPlansOnce() {
  const snapshot = await getDocs(collection(db, PLANS_COLLECTION));
  const list = [];
  snapshot.forEach((docSnap) => list.push(normalizePlan(docSnap.id, docSnap.data() || {})));
  return sortPlans(list);
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
