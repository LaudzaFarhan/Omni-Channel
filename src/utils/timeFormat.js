// Time formatting shared by the dashboard panels.
//
// These were copied into three components (the customer list, the home page and the
// team activity view), which is how they drifted: the same timestamp rendered as
// "Kemarin" in one panel and "Yesterday" in another, and the home page used en-US
// weekday names under Indonesian headings. One definition each, so every panel agrees.
//
// All inputs are epoch milliseconds. Anything unusable returns an empty string rather
// than throwing or printing "Invalid Date", because these run inside list rows where a
// single bad timestamp must not take the panel down.

const DAY_MS = 86400000;

const asDate = (ms) => {
  if (!ms) return null;
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d : null;
};

/**
 * Compact timestamp for a narrow column: a time today, "Kemarin", a weekday this week,
 * then a date. Pair it with a title attribute carrying the full timestamp.
 */
export function shortWhen(ms) {
  const d = asDate(ms);
  if (!d) return '';

  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';

  if (now - d < 7 * DAY_MS) return d.toLocaleDateString('id-ID', { weekday: 'short' });
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/**
 * How long ago something happened, phrased as elapsed time rather than a clock reading.
 * Used where the age matters more than the moment, such as the latest-messages list.
 */
export function relativeWhen(ms) {
  const d = asDate(ms);
  if (!d) return '';

  const elapsed = Date.now() - d.getTime();
  // A clock skew between the phone and this browser can put a message slightly in the
  // future; "baru saja" is the honest reading, not a negative duration.
  if (elapsed < 60000) return 'Baru saja';

  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return `${minutes} mnt lalu`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';

  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/** Full timestamp for a title attribute, or undefined so the attribute is omitted. */
export function fullWhen(ms) {
  const d = asDate(ms);
  return d ? d.toLocaleString('id-ID') : undefined;
}

/**
 * A span of time, rounded down to its largest useful unit — response times are read at
 * a glance ("2 jam") and the extra precision only makes the row harder to scan.
 */
export function shortDuration(spanMs) {
  if (!Number.isFinite(spanMs) || spanMs < 0) return '';
  if (spanMs < 60000) return '< 1 mnt';

  const minutes = Math.floor(spanMs / 60000);
  if (minutes < 60) return `${minutes} mnt`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam`;

  return `${Math.floor(hours / 24)} hari`;
}

/**
 * Computes the 24-hour follow-up window status for a customer conversation.
 * Returns null for group chats or unselected chats.
 */
export function get24HourWindowStatus(chat, messages = []) {
  if (!chat || chat.id?.endsWith('@g.us')) {
    return null;
  }

  // Find the last customer inbound message or last conversation message
  let lastCustomerTimestamp = null;
  let lastMessageTimestamp = null;

  if (Array.isArray(messages) && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg) continue;
      
      let ts = msg.messageTimestamp;
      if (ts) {
        if (typeof ts === 'object' && ts.low) ts = ts.low;
        const tsMs = Number(ts) > 1e11 ? Number(ts) : Number(ts) * 1000;
        if (!lastMessageTimestamp) lastMessageTimestamp = tsMs;
        if (!msg.key?.fromMe) {
          if (!lastCustomerTimestamp) lastCustomerTimestamp = tsMs;
          break;
        }
      }
    }
  }

  // Fallback to chat.lastMessageTimestamp
  if (!lastCustomerTimestamp && chat.lastMessageTimestamp) {
    let ts = chat.lastMessageTimestamp;
    const tsMs = Number(ts) > 1e11 ? Number(ts) : Number(ts) * 1000;
    if (!chat.lastMessageFromMe) {
      lastCustomerTimestamp = tsMs;
    }
    if (!lastMessageTimestamp) {
      lastMessageTimestamp = tsMs;
    }
  }

  const refTimestamp = lastCustomerTimestamp || lastMessageTimestamp;
  if (!refTimestamp || !Number.isFinite(refTimestamp)) {
    return null;
  }

  const now = Date.now();
  const windowDurationMs = 24 * 60 * 60 * 1000;
  const elapsedMs = now - refTimestamp;
  const remainingMs = windowDurationMs - elapsedMs;

  const isExpired = remainingMs <= 0;
  const hoursLeft = Math.max(0, Math.floor(remainingMs / (1000 * 60 * 60)));
  const minutesLeft = Math.max(0, Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60)));

  const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
  const elapsedMinutes = Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60));
  const elapsedDays = Math.floor(elapsedHours / 24);

  let level = 'healthy'; // 'healthy' | 'warning' | 'urgent' | 'expired'
  if (isExpired) {
    level = 'expired';
  } else if (remainingMs <= 1 * 60 * 60 * 1000) {
    level = 'urgent';
  } else if (remainingMs <= 6 * 60 * 60 * 1000) {
    level = 'warning';
  }

  return {
    refTimestamp,
    isExpired,
    level,
    hoursLeft,
    minutesLeft,
    elapsedHours,
    elapsedMinutes,
    elapsedDays,
    remainingMs,
    isLastFromCustomer: Boolean(lastCustomerTimestamp && lastCustomerTimestamp === lastMessageTimestamp),
  };
}

