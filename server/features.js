// Feature control.
//
// An admin decides, per feature, what every customer sees: it is either released, shown
// as coming soon, or hidden entirely. Individual accounts can then be granted early
// access or refused, which is how a feature gets piloted with one customer before it goes
// out to everyone.
//
// Three statuses rather than a boolean, because "not available yet" and "not for you" are
// different messages and a single `enabled` flag cannot tell them apart:
//
//   released     visible and usable. The default for anything not configured.
//   coming_soon  visible, not usable, labelled as coming. Announces the roadmap.
//   hidden       absent. The customer has no way to know it exists.
//
// This module is deliberately free of database and request handling so the precedence
// rules can be checked directly. The data layer supplies rows; this decides what they
// mean.

export const FEATURE_STATUSES = ['released', 'coming_soon', 'hidden'];

// Per-account overrides. `allow` is early access, `deny` withdraws a released feature from
// one customer.
export const FEATURE_ACCESS = ['allow', 'deny'];

// Nothing configured means released. A newly deployed flag table is empty, and the
// alternative default would black out the product on first boot.
export const DEFAULT_STATUS = 'released';

/**
 * The catalogue. `key` is the contract shared with the client, and for a navigable
 * feature it is also the `activeTab` string, so there is nothing to translate between
 * the admin console and the customer's sidebar.
 *
 * `locked` marks the features that must never be hidden or deferred:
 *
 *   messages      the product itself.
 *   subscription  where a customer pays. The trial-expired overlay only lets
 *                 subscription and profile through, so hiding either would strand an
 *                 expired account with no route to fix it.
 *   profile       the same argument, plus it is where they see their own account state.
 *
 * They are listed rather than omitted so the console shows the full inventory and says
 * why those three cannot be changed, instead of leaving an admin wondering where they
 * went.
 */
export const FEATURES = [
  {
    key: 'messages',
    label: 'Conversations',
    description: 'The inbox: chat list, conversation view, templates, tags and status.',
    surface: 'Sidebar · Messages',
    locked: true,
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'The home page with its counters, charts and feature index.',
    surface: 'Sidebar · Dashboard',
  },
  {
    key: 'heatmap',
    label: 'Interaction heat map',
    description: 'Weekday-by-hour grid of when conversations happen, with its drill-down.',
    surface: 'Dashboard panel',
  },
  {
    key: 'pipeline',
    label: 'Conversation pipeline',
    description: 'New Leads / Closed Won / Bukan Prospek counts on the home page.',
    surface: 'Dashboard panel',
  },
  {
    key: 'contacts',
    label: 'Contacts',
    description: 'Saved address book, CSV import and export, notes and contact tags.',
    surface: 'Sidebar · Contacts',
  },
  {
    key: 'activity',
    label: 'Chat history',
    description: 'Team-wide customer conversation log: who started it and who replied.',
    surface: 'Sidebar · Chat History',
    supervisorOnly: true,
  },
  {
    key: 'team',
    label: 'Team',
    description: 'Invite agents, manage seats and revoke access.',
    surface: 'Sidebar · Team',
    supervisorOnly: true,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    description: 'The notification drawer, the sidebar badge and the notifications view.',
    surface: 'Sidebar · Notifications',
  },
  {
    key: 'subscription',
    label: 'Subscription',
    description: 'Plan, quota, agent add-ons and payment history.',
    surface: 'Sidebar · Subscription',
    supervisorOnly: true,
    locked: true,
  },
  {
    key: 'profile',
    label: 'Profile',
    description: 'The account holder\'s own details and verification state.',
    surface: 'Sidebar · Profile',
    locked: true,
  },
  {
    key: 'settings',
    label: 'Settings',
    description: 'Theme and notification preferences.',
    surface: 'Sidebar · Settings',
  },
];

export const FEATURE_KEYS = FEATURES.map(f => f.key);

const BY_KEY = new Map(FEATURES.map(f => [f.key, f]));

export function findFeature(key) {
  return BY_KEY.get(String(key)) || null;
}

export function isFeatureKey(key) {
  return BY_KEY.has(String(key));
}

/** True for the features an admin is not allowed to hide or defer. */
export function isLocked(key) {
  return Boolean(BY_KEY.get(String(key))?.locked);
}

/**
 * What one account actually sees for one feature.
 *
 * Precedence, most decisive first:
 *
 *   1. locked          released, whatever anyone configured. Enforced here rather than
 *                      only in the admin route, so a row written before a feature became
 *                      locked — or by a direct database edit — still cannot strand a
 *                      customer.
 *   2. account override an explicit decision about this account beats the global rollout.
 *                      `allow` is early access and reads as fully released; `deny`
 *                      hides it rather than showing "coming soon", because the feature is
 *                      not coming for them.
 *   3. global status   the rollout state for everyone.
 *   4. default         released.
 */
export function resolveFeature(key, { status, access } = {}) {
  if (isLocked(key)) return 'released';
  if (access === 'allow') return 'released';
  if (access === 'deny') return 'hidden';
  return FEATURE_STATUSES.includes(status) ? status : DEFAULT_STATUS;
}

/**
 * The full effective map for one account: every catalogue key to its status.
 *
 * Every key is always present, so the client never has to distinguish "not configured"
 * from "not sent" — a missing key in the response would otherwise be indistinguishable
 * from a truncated payload, and the safe reading of those two differs.
 *
 * @param flags     [{ key, status }] global rows, in any order. Unknown keys are ignored.
 * @param overrides [{ featureKey, access }] rows for this one account.
 */
export function resolveFeatures({ flags = [], overrides = [] } = {}) {
  const statusByKey = new Map();
  for (const row of flags) {
    if (row && isFeatureKey(row.key)) statusByKey.set(String(row.key), row.status);
  }

  const accessByKey = new Map();
  for (const row of overrides) {
    const key = row?.featureKey ?? row?.feature_key;
    if (key && isFeatureKey(key)) accessByKey.set(String(key), row.access);
  }

  const resolved = {};
  for (const key of FEATURE_KEYS) {
    resolved[key] = resolveFeature(key, {
      status: statusByKey.get(key),
      access: accessByKey.get(key),
    });
  }
  return resolved;
}

/** Usable right now. `coming_soon` is visible but not usable, so it is not enabled. */
export function isEnabled(resolved, key) {
  return (resolved?.[key] ?? DEFAULT_STATUS) === 'released';
}
