// Reading an account's paid window.
//
// One definition, because the same three questions get asked in five places — the TopBar
// badge, the Sidebar badge, the Subscription card, the App-level access gate and the admin
// customer table. When the trial equivalent of this was computed inline it drifted: the
// client rounds days up while one admin view rounded down, so the same account could read
// "1 day left" in the header and "0d left" in the console.
//
// THE CRITICAL RULE: a null end date is NOT expired. It means the account has no
// subscription limit at all, which is what every account created before subscription
// periods existed carries, and what a perpetual plan (durationDays 0) produces. Treating
// absence as expiry would lock out every existing paying customer the moment this shipped.

const DAY_MS = 86400000;

/**
 * @param subscriptionEndsAt ISO string, Date, or null.
 * @returns {{
 *   hasSubscription: boolean,  a paid window exists at all
 *   isExpired: boolean,        the window has closed
 *   daysLeft: number,          whole days remaining, rounded up so a part-day reads as 1
 *   endsAt: Date|null,
 *   isEndingSoon: boolean      within a week, worth drawing attention to
 * }}
 */
export function readSubscription(subscriptionEndsAt) {
  const none = {
    hasSubscription: false,
    isExpired: false,
    daysLeft: 0,
    endsAt: null,
    isEndingSoon: false,
  };

  if (!subscriptionEndsAt) return none;

  const endsAt = new Date(subscriptionEndsAt);
  // An unparseable value is treated as no subscription rather than as expired, for the same
  // fail-open reason: bad data must not lock anyone out.
  if (!Number.isFinite(endsAt.getTime())) return none;

  const msLeft = endsAt.getTime() - Date.now();

  if (msLeft <= 0) {
    return { hasSubscription: true, isExpired: true, daysLeft: 0, endsAt, isEndingSoon: false };
  }

  // Rounded UP: with 6 hours left the honest answer is "1 day", not "0 days left" on an
  // account that still works.
  const daysLeft = Math.ceil(msLeft / DAY_MS);

  return {
    hasSubscription: true,
    isExpired: false,
    daysLeft,
    endsAt,
    isEndingSoon: daysLeft <= 7,
  };
}

/** The renewal date, for showing next to the countdown. */
export function formatRenewalDate(endsAt) {
  if (!endsAt) return '';
  const d = endsAt instanceof Date ? endsAt : new Date(endsAt);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "30 days" / "1 day", for a plan's advertised period. */
export function formatDuration(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return 'No expiry';
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}
