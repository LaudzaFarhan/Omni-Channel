// Calendar-day arithmetic for the heat map's range filter.
//
// Extracted from InteractionHeatmap so the calendar picker and the component that
// queries the server share one definition. Two of these have already been the source
// of an off-by-a-timezone bug, so they belong in one tested place rather than being
// re-derived per component.
//
// The convention throughout: a DAY is the string 'YYYY-MM-DD' in the viewer's local
// calendar, and an INSTANT is epoch milliseconds. Only `boundsFor` crosses between
// them, and only at the moment a request is built.

/** Rolling windows offered as presets. `days: null` means unbounded. */
export const RANGES = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'all', label: 'All', days: null },
  { key: 'custom', label: 'Custom', days: null },
];

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Sunday first, matching the heat map's own rows so the two calendars read the same
// way round.
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * 'YYYY-MM-DD' -> a Date at local midnight.
 *
 * Built from the parts rather than via Date.parse, which reads that format as UTC
 * midnight — enough to land the boundary in the previous day for anyone east of
 * Greenwich, which is a 7-hour error in WIB.
 */
export function localDate(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Date or epoch ms -> 'YYYY-MM-DD' in local time. */
export function toDayKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey() {
  return toDayKey(new Date());
}

/**
 * The instants to query for a given selection.
 *
 * `from` is the start of its day and `to` is the END of its day, so a single-day
 * range covers that whole day. That asymmetry is why the two DAYS are ordered here
 * rather than the two instants afterwards: swapping the numbers would pair a 23:59
 * lower bound with a 00:00 upper one and silently drop both boundary days from a
 * reversed selection. 'YYYY-MM-DD' sorts chronologically as a string, so a direct
 * comparison is enough.
 */
export function boundsFor(rangeKey, customFrom, customTo) {
  if (rangeKey === 'all') return { from: null, to: null };

  if (rangeKey === 'custom') {
    let a = customFrom;
    let b = customTo;
    if (a && b && a > b) [a, b] = [b, a];

    return {
      from: a ? startOfDay(localDate(a)) : null,
      to: b ? endOfDay(localDate(b)) : null,
    };
  }

  const preset = RANGES.find(r => r.key === rangeKey);
  if (!preset?.days) return { from: null, to: null };

  // Inclusive of today, so "7 days" is today plus the six before it rather than
  // today plus seven.
  const start = new Date();
  start.setDate(start.getDate() - (preset.days - 1));
  return { from: startOfDay(start), to: endOfDay(new Date()) };
}

// ---------------------------------------------------------------------------
// calendar grid
// ---------------------------------------------------------------------------

/** Shift a {year, month} cursor by whole months, wrapping the year. */
export function addMonths({ year, month }, delta) {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function monthCursorFor(day) {
  const d = day ? localDate(day) : new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

/**
 * Weeks of a month as rows of 7, padded with nulls so the first day lands under its
 * weekday. Returned as day keys rather than Dates, because every comparison the
 * picker makes is a string comparison.
 */
export function monthGrid({ year, month }) {
  const first = new Date(year, month, 1);
  const leading = first.getDay(); // 0 = Sunday, matching WEEKDAY_LABELS
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = new Array(leading).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(toDayKey(new Date(year, month, day)));
  }
  // Pad the final row so every week has 7 cells and the grid cannot reflow.
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Inclusive, and order-independent so it works mid-selection. */
export function isDayInRange(day, from, to) {
  if (!day || !from || !to) return false;
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return day >= lo && day <= hi;
}

/** Human label for a selected span, collapsing a single day. */
export function formatDayRange(from, to) {
  if (!from && !to) return null;
  if (from && to) {
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    if (lo === hi) return formatDay(lo);
    return `${formatDay(lo)} – ${formatDay(hi)}`;
  }
  return formatDay(from || to);
}

export function formatDay(day) {
  if (!day) return '';
  const d = localDate(day);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

/** Whole days between two day keys, inclusive. */
export function daysBetween(from, to) {
  if (!from || !to) return 0;
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return Math.round((startOfDay(localDate(hi)) - startOfDay(localDate(lo))) / 86400000) + 1;
}
