// Reading the feature map the server resolved for this account.
//
// The map arrives from GET /api/features as { featureKey: 'released' | 'coming_soon' |
// 'hidden' }. Every helper here FAILS OPEN: an absent key, an unrecognised value, or a map
// that has not arrived yet all read as released.
//
// That direction is deliberate. The alternative — treat unknown as hidden — would blank the
// navigation for the moment between sign-in and the features request landing, and would
// black out the whole product if that one request ever failed. A brief flash of a feature
// that is about to be hidden is a far cheaper failure than a customer who cannot find
// anything. The server is the enforcement point regardless: its endpoints refuse a gated
// feature whatever the client believes.

export const RELEASED = 'released';
export const COMING_SOON = 'coming_soon';
export const HIDDEN = 'hidden';

/**
 * Display labels, used for nav items and the coming-soon placeholder.
 *
 * The catalogue itself lives in server/features.js, which owns the keys, the locked flags
 * and the descriptions the admin console shows. This is presentation only — a key missing
 * from here still gates correctly, it just has no pretty name.
 */
export const FEATURE_LABELS = {
  dashboard: 'Dashboard',
  messages: 'Messages',
  contacts: 'Contacts',
  notifications: 'Notifications',
  team: 'Team',
  activity: 'Chat History',
  subscription: 'Subscription',
  profile: 'Profile',
  settings: 'Settings',
  heatmap: 'Interaction heat map',
  pipeline: 'Conversation pipeline',
};

export function featureLabel(key) {
  return FEATURE_LABELS[key] || key;
}

/** The status of one feature, normalised. Anything unrecognised reads as released. */
export function featureStatus(features, key) {
  const status = features?.[key];
  return status === COMING_SOON || status === HIDDEN ? status : RELEASED;
}

/** Usable now. */
export function isReleased(features, key) {
  return featureStatus(features, key) === RELEASED;
}

/** Announced but not usable. */
export function isComingSoon(features, key) {
  return featureStatus(features, key) === COMING_SOON;
}

/** Absent: not in the navigation, not on the dashboard, no trace. */
export function isHidden(features, key) {
  return featureStatus(features, key) === HIDDEN;
}

/**
 * Worth showing at all — released or coming soon.
 *
 * The distinction between those two is about whether it can be USED, so anything that only
 * decides whether to render a nav item or a card wants this rather than isReleased.
 */
export function isVisible(features, key) {
  return featureStatus(features, key) !== HIDDEN;
}
