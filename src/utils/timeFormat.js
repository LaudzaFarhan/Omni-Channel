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
