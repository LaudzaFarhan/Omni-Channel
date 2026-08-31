// Single source of truth for how a chat/contact is labelled in the UI.
//
// Previously ChatList, ChatWindow and Dashboard each had their own copy of this
// logic, so they could disagree about the same chat.
//
// Resolution order (best identity first):
//   1. "(YOU)"          - the chat with your own number
//   2. Saved contact    - a name the operator typed into their address book
//   3. Real name        - the contact's WhatsApp name or pushName
//   4. Phone number     - resolved from the LID mapping, or from the JID itself
//   5. LID short form   - last resort, kept distinguishable per contact
//
// Background on step 4: WhatsApp addresses many chats by an anonymous "@lid"
// instead of a phone number. The phone number is only knowable when WhatsApp
// supplies it (saved contact sync, an incoming message's senderPn, or a
// phoneNumberShare event). There is no lookup that reverses a LID into a phone
// number. So for a not-yet-resolved LID we show a stable short identifier
// rather than one identical label on every row.

const isRealName = (name) =>
  !!name && !/^\d+$/.test(String(name).trim());

/** True when this chat is the user's own number. */
export function isSelfChat(chat, userInfo) {
  if (!chat?.id || !userInfo?.id) return false;
  const mine = userInfo.id.split('@')[0].split(':')[0];
  const theirs = chat.id.split('@')[0].split(':')[0];
  return mine === theirs;
}

/**
 * Display label for a chat row / conversation header.
 *
 * `savedName` is the name from the operator's own contacts, when they have saved
 * this number. It outranks everything WhatsApp reports: the operator typed it
 * deliberately, whereas `chat.name` is often a pushName the other party chose and
 * can change at will.
 */
export function getChatDisplayName(chat, userInfo, savedName) {
  if (!chat || !chat.id) return 'Unknown';

  if (isSelfChat(chat, userInfo)) return '(YOU)';

  const rawId = chat.id.split('@')[0];

  // 2. The operator's own label for this person.
  if (isRealName(savedName)) return savedName;

  // 3. A real (non-numeric) name from WhatsApp.
  if (isRealName(chat.name)) return chat.name;

  // 4. A resolved phone number, normalized with a leading '+'.
  if (chat.phoneNumber) {
    return chat.phoneNumber.startsWith('+') ? chat.phoneNumber : `+${chat.phoneNumber}`;
  }

  // Plain phone-number JIDs carry the number directly.
  if (chat.id.endsWith('@s.whatsapp.net') && /^\d+$/.test(rawId)) {
    return `+${rawId}`;
  }

  // Groups without a fetched subject.
  if (chat.id.endsWith('@g.us')) return 'Group Chat';

  // 5. Unresolved LID: keep rows distinguishable instead of all reading the
  // same. The suffix is not a phone number, so it is not formatted like one.
  if (chat.id.endsWith('@lid')) {
    const suffix = rawId.slice(-4);
    return `WhatsApp User #${suffix}`;
  }

  return isRealName(chat.name) ? chat.name : (rawId || 'Unknown');
}

// Avatar palette. Deliberately varied rather than brand-coloured: the colour exists to
// tell one row from the next, and a column of identical circles does not.
const AVATAR_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

/**
 * Stable avatar colour for a seed (a chat JID, or an agent uid).
 *
 * Hashed rather than assigned by index so a person keeps the same colour between
 * renders, between panels and between sessions — an avatar that changes colour when the
 * list reorders reads as a different person.
 */
export function avatarColor(seed) {
  const s = String(seed || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/** Two-letter avatar initials derived from the display label. */
export function getInitials(label) {
  if (!label) return 'WA';

  // Unresolved LID labels: use the numeric suffix so avatars differ too.
  const lidMatch = /^WhatsApp User #(\d+)$/.exec(label);
  if (lidMatch) return lidMatch[1].slice(-2);

  if (label === '(YOU)') return 'ME';

  // A phone number: use the last two digits.
  const digitsOnly = label.replace(/[^\d]/g, '');
  if (/^\+?[\d\s-]+$/.test(label) && digitsOnly.length >= 2) {
    return digitsOnly.slice(-2);
  }

  const clean = label.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (!clean) return 'WA';

  const parts = clean.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}
