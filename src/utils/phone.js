// Phone number normalisation, shared by the server and the browser.
//
// The same digits-plus-suffix rewrite was inlined in four places before this
// file existed: store.js twice (expandHoldJids, canonicalHoldJid), the send path
// in server/index.js, and ChatList's "start new chat" box — and only the last of
// those did the Indonesian 0 -> 62 rewrite. So a contact saved as "0812..." and
// a chat keyed by "62812..." were two different people as far as the code was
// concerned.
//
// Both sides import this module (the server does the same with pricing.js) so a
// number typed into the contacts form resolves to exactly the JID the WhatsApp
// store uses.

// Indonesia. Numbers are stored in full international form without a '+', which
// is what WhatsApp JIDs use, so a default is needed for the local 0-prefixed
// form people actually type.
export const DEFAULT_COUNTRY_CODE = '62';

// A WhatsApp number is at least 8 digits (some country's short mobile) and at
// most 15 by E.164, but LIDs and group ids are longer, so the ceiling is loose.
const MIN_DIGITS = 8;
const MAX_DIGITS = 15;

/**
 * Reduce anything a human might type into the bare international digits used by
 * a WhatsApp JID. Returns null when the input cannot be a phone number, so
 * callers can reject rather than store junk.
 *
 *   '0812-3456-7890'      -> '6281234567890'
 *   '+62 812 3456 7890'   -> '6281234567890'
 *   '00628123456789'      -> '628123456789'
 *   '628123456789@s.whatsapp.net' -> '628123456789'
 *   'not a number'        -> null
 */
export function normalizePhone(raw, countryCode = DEFAULT_COUNTRY_CODE) {
  if (raw === null || raw === undefined) return null;

  // Drop a JID suffix before stripping punctuation, otherwise '@lid' and
  // '@s.whatsapp.net' contribute no digits but '@g.us' none either — harmless,
  // but being explicit keeps the intent clear.
  let value = String(raw).trim();
  if (value.includes('@')) value = value.split('@')[0];

  // A LID is not a phone number and must never be stored as one.
  if (String(raw).includes('@lid')) return null;

  // Baileys device-suffixed JIDs look like '628...:12@s.whatsapp.net'.
  value = value.split(':')[0];

  let digits = value.replace(/\D/g, '');
  if (!digits) return null;

  // International dialling prefix.
  if (digits.startsWith('00')) digits = digits.slice(2);

  // Local trunk prefix: 0812... means countryCode + 812...
  if (digits.startsWith('0')) digits = countryCode + digits.replace(/^0+/, '');

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return null;

  return digits;
}

/** True when `raw` normalises to something storable. */
export function isValidPhone(raw) {
  return normalizePhone(raw) !== null;
}

/** The WhatsApp JID for a set of normalised digits. */
export function phoneToJid(digits) {
  const normalized = normalizePhone(digits);
  return normalized ? `${normalized}@s.whatsapp.net` : null;
}

/**
 * Digits behind a JID, or null when the JID carries no number. An '@lid' is
 * deliberately not resolvable here: reversing a LID needs the store's lidMap.
 */
export function jidToPhone(jid) {
  if (typeof jid !== 'string' || !jid) return null;
  if (jid.endsWith('@g.us') || jid.endsWith('@lid')) return null;
  return normalizePhone(jid);
}

/**
 * Display form. Grouped for Indonesian numbers because that is the common case
 * and an unbroken 13-digit run is hard to read; everything else just gets a '+'.
 *
 *   '6281234567890' -> '+62 812-3456-7890'
 */
export function formatPhone(raw) {
  const digits = normalizePhone(raw);
  if (!digits) return String(raw ?? '');

  if (digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    const rest = digits.slice(DEFAULT_COUNTRY_CODE.length);
    // 3-4-4 is how Indonesian mobile numbers are conventionally written; the
    // final group absorbs any extra digits.
    const groups = [rest.slice(0, 3), rest.slice(3, 7), rest.slice(7)].filter(Boolean);
    return `+${DEFAULT_COUNTRY_CODE} ${groups.join('-')}`;
  }

  return `+${digits}`;
}
