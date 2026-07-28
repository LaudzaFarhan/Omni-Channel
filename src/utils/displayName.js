// Single source of truth for how a chat/contact is labelled in the UI.
//
// Previously ChatList, ChatWindow and Dashboard each had their own copy of this
// logic, so they could disagree about the same chat.
//
// Resolution order (best identity first):
//   1. "(YOU)"          - the chat with your own number
//   2. Real name        - saved contact name or the contact's own pushName
//   3. Phone number     - resolved from the LID mapping, or from the JID itself
//   4. LID short form   - last resort, kept distinguishable per contact
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

/** Display label for a chat row / conversation header. */
export function getChatDisplayName(chat, userInfo) {
  if (!chat || !chat.id) return 'Unknown';

  if (isSelfChat(chat, userInfo)) return '(YOU)';

  const rawId = chat.id.split('@')[0];

  // 2. A real (non-numeric) name always wins.
  if (isRealName(chat.name)) return chat.name;

  // 3. A resolved phone number, normalized with a leading '+'.
  if (chat.phoneNumber) {
    return chat.phoneNumber.startsWith('+') ? chat.phoneNumber : `+${chat.phoneNumber}`;
  }

  // Plain phone-number JIDs carry the number directly.
  if (chat.id.endsWith('@s.whatsapp.net') && /^\d+$/.test(rawId)) {
    return `+${rawId}`;
  }

  // Groups without a fetched subject.
  if (chat.id.endsWith('@g.us')) return 'Group Chat';

  // 4. Unresolved LID: keep rows distinguishable instead of all reading the
  // same. The suffix is not a phone number, so it is not formatted like one.
  if (chat.id.endsWith('@lid')) {
    const suffix = rawId.slice(-4);
    return `WhatsApp User #${suffix}`;
  }

  return isRealName(chat.name) ? chat.name : (rawId || 'Unknown');
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
