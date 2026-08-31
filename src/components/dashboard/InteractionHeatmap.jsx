import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Clock, MessageSquare, CalendarRange } from 'lucide-react';
import { fetchActivityHeatmap, fetchActivityContributors } from '../../utils/api.js';
import { subscribeSocket } from '../../utils/socket.js';
import { RANGES, boundsFor, toDayKey } from '../../utils/dateRange.js';
import DateRangePicker from './DateRangePicker.jsx';

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const VIEWS = [
  { key: 'all', label: 'Semua' },
  { key: 'incoming', label: 'Masuk' },
  { key: 'outgoing', label: 'Keluar' },
];

// RANGES, boundsFor and the day-key helpers live in utils/dateRange.js, shared with
// the calendar picker. They were local to this file until the picker needed the same
// arithmetic, and duplicating timezone-sensitive date maths across two components is
// how the reversed-range bug got in the first time.

// Five buckets, matching the "Sepi -> Ramai" legend. Level 0 is a distinct
// neutral rather than the lightest green, so "no messages at all" reads
// differently from "one message" at a glance.
const LEVELS = 4;

/**
 * Which shade a cell gets.
 *
 * Bucketed against the busiest cell rather than a fixed scale, because absolute
 * volume varies enormously between accounts — a fixed scale would render a small
 * operator's grid entirely pale and a large one entirely dark. Any non-zero count
 * is guaranteed at least level 1, so a quiet hour is never mistaken for silence.
 */
function levelFor(count, max) {
  if (!count) return 0;
  if (max <= 1) return LEVELS;
  const ratio = count / max;
  return Math.max(1, Math.min(LEVELS, Math.ceil(ratio * LEVELS)));
}

function formatRange(from, to) {
  if (!from || !to) return null;
  const opts = { day: 'numeric', month: 'short' };
  const start = new Date(from).toLocaleDateString('id-ID', opts);
  const end = new Date(to).toLocaleDateString('id-ID', opts);
  return start === end ? start : `${start} – ${end}`;
}

/**
 * When conversations actually happen, as a weekday-by-hour grid.
 *
 * Answers the question a message counter cannot: which hours are worth staffing.
 * Every cell is a real button so the grid works by keyboard and by touch — a
 * hover-only tooltip would make the whole panel unreadable on a phone.
 */
export default function InteractionHeatmap({
  activeSessionId = 'default',
  connected = true,
  // Called with { day, hour, label, count, contributors, groupTotal } when a cell is
  // pinned, and with null when it is cleared. The heatmap does the drill-down fetch
  // itself because it owns the range, the view and the timezone offset the query needs.
  onCellSelect,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('all');

  // Defaults to everything stored, which is what the panel showed before a filter
  // existed — and the store only keeps the last 100 messages per chat, so "all" is
  // already a bounded window rather than an unbounded scan.
  const [range, setRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Hover is transient; a click pins a cell so the reading survives the pointer
  // leaving, and so touch users can read it at all.
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);

  const gridRef = useRef(null);

  // A custom range with only one end filled is still in progress; sending it would
  // flash a half-applied filter between the two clicks.
  const customIncomplete = range === 'custom' && !(customFrom && customTo);

  const load = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      return;
    }
    try {
      const bounds = customIncomplete
        ? { from: null, to: null }
        : boundsFor(range, customFrom, customTo);

      setData(await fetchActivityHeatmap(activeSessionId, {
        from: bounds.from ?? undefined,
        to: bounds.to ?? undefined,
      }));
      setError(null);
    } catch (err) {
      console.info('[Heatmap] Could not load activity:', err.message);
      setError(err.message || 'Tidak bisa memuat data aktivitas.');
    } finally {
      setLoading(false);
    }
  }, [activeSessionId, connected, range, customFrom, customTo, customIncomplete]);

  useEffect(() => { load(); }, [load]);

  // Refresh when a new message arrives, but coalesced: a history sync fires this
  // hundreds of times and each one is a full re-aggregation server-side.
  useEffect(() => {
    let timer = null;
    let attached = null;

    const handleActivity = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        load();
      }, 4000);
    };

    const unsubscribe = subscribeSocket((socket) => {
      if (attached) {
        attached.off('new-message', handleActivity);
        attached.off('history-sync-complete', handleActivity);
      }
      attached = null;
      if (socket) {
        socket.on('new-message', handleActivity);
        socket.on('history-sync-complete', handleActivity);
        attached = socket;
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      if (attached) {
        attached.off('new-message', handleActivity);
        attached.off('history-sync-complete', handleActivity);
      }
    };
  }, [load]);

  // The grid actually rendered, plus the peak used to scale the shading.
  const { matrix, max, total, busiest } = useMemo(() => {
    const empty = Array.from({ length: 7 }, () => new Array(24).fill(0));
    if (!data) return { matrix: empty, max: 0, total: 0, busiest: null };

    const incoming = data.incoming || empty;
    const outgoing = data.outgoing || empty;

    const grid = Array.from({ length: 7 }, (_, day) =>
      Array.from({ length: 24 }, (_, hour) => {
        const inCount = incoming[day]?.[hour] || 0;
        const outCount = outgoing[day]?.[hour] || 0;
        if (view === 'incoming') return inCount;
        if (view === 'outgoing') return outCount;
        return inCount + outCount;
      })
    );

    let peak = 0;
    let sum = 0;
    let top = null;
    grid.forEach((row, day) => row.forEach((count, hour) => {
      sum += count;
      if (count > peak) {
        peak = count;
        top = { day, hour, count };
      }
    }));

    return { matrix: grid, max: peak, total: sum, busiest: top };
  }, [data, view]);

  // Clear a pinned cell, and the drill-down it produced, whenever the numbers underneath
  // change meaning. The contributor list was computed under the previous view and range,
  // so leaving it up would show people who are no longer in the cell they came from.
  useEffect(() => {
    setPinned(null);
    onCellSelect?.(null);
    // onCellSelect is intentionally omitted: parents pass an inline arrow, so including it
    // would re-run this on every parent render and clear the selection immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, range, customFrom, customTo, activeSessionId]);

  const active = hovered || pinned;

  const showTip = (day, hour, element) => {
    const grid = gridRef.current;
    if (!grid || !element) return;
    const gridBox = grid.getBoundingClientRect();
    const cellBox = element.getBoundingClientRect();
    setHovered({
      day,
      hour,
      // Measured rather than computed from a cell size, so the tooltip stays put
      // when the grid reflows at a narrower width.
      x: cellBox.left - gridBox.left + cellBox.width / 2,
      y: cellBox.top - gridBox.top,
    });
  };

  // Pinning a cell is also the drill-down: it asks the server which conversations
  // produced that bucket and hands them up, so the customer list beside the panel can
  // show exactly the people behind the number that was clicked.
  const togglePin = async (day, hour, element) => {
    const grid = gridRef.current;
    if (!grid || !element) return;

    // Clicking the pinned cell again clears both the pin and the filter.
    if (pinned && pinned.day === day && pinned.hour === hour) {
      setPinned(null);
      onCellSelect?.(null);
      return;
    }

    const gridBox = grid.getBoundingClientRect();
    const cellBox = element.getBoundingClientRect();
    setPinned({
      day, hour,
      x: cellBox.left - gridBox.left + cellBox.width / 2,
      y: cellBox.top - gridBox.top,
    });

    const count = matrix[day][hour];

    // An empty cell has nothing to drill into, and filtering the list to nothing would
    // look like a bug rather than an answer.
    if (count === 0) {
      onCellSelect?.({
        day, hour, count: 0, contributors: [], groupTotal: 0,
        label: `${DAY_NAMES[day]} jam ${hour}:00`,
      });
      return;
    }

    try {
      const bounds = customIncomplete ? { from: null, to: null } : boundsFor(range, customFrom, customTo);
      const data = await fetchActivityContributors({
        sessionId: activeSessionId,
        day, hour, view,
        from: bounds.from ?? undefined,
        to: bounds.to ?? undefined,
      });

      onCellSelect?.({
        day, hour,
        count: data.total,
        groupTotal: data.groupTotal,
        contributors: data.contributors,
        label: `${DAY_NAMES[day]} jam ${hour}:00`,
      });
    } catch (err) {
      console.info('[Heatmap] Could not load the conversations for that cell:', err.message);
      // The pin stays, so the tooltip still answers "how many". Only the who is missing.
      onCellSelect?.(null);
    }
  };

  // The span the returned numbers actually cover, which is not the same as the span
  // that was requested: a custom range with quiet days at either end reports the
  // first and last message inside it.
  const coveredLabel = data ? formatRange(data.from, data.to) : null;

  // Constrain the calendar to what is actually on disk, so a range with no possible
  // data cannot be chosen. Days outside this are rendered disabled rather than hidden,
  // which shows WHY they cannot be picked.
  const minDay = data?.availableFrom ? toDayKey(data.availableFrom) : '';
  const maxDay = data?.availableTo ? toDayKey(data.availableTo) : '';

  // Whether the server actually applied a bound, taken from what it echoed rather
  // than from local state — they disagree while a custom range is half-filled.
  const isFiltered = Boolean(data?.requestedFrom || data?.requestedTo);

  return (
    <div className="dashboard-panel heatmap-panel">
      <div className="dashboard-panel-header">
        <Clock size={18} />
        <span>Peta Panas Waktu Interaksi</span>

        <div className="heatmap-view-toggle" role="group" aria-label="Jenis interaksi">
          {VIEWS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`heatmap-view-btn ${view === key ? 'active' : ''}`}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Range picker. Outside the body's conditional so it stays usable when the
          current selection returns nothing — otherwise picking an empty range would
          hide the only control that could undo it. */}
      {connected && !error && (
        <div className="heatmap-rangebar">
          <span className="heatmap-rangebar-label">
            <CalendarRange size={14} /> Rentang
          </span>

          <div className="heatmap-range-toggle" role="group" aria-label="Rentang tanggal">
            {RANGES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                className={`heatmap-view-btn ${range === key ? 'active' : ''}`}
                aria-pressed={range === key}
                onClick={() => setRange(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {range === 'custom' && (
            <DateRangePicker
              from={customFrom}
              to={customTo}
              minDay={minDay}
              maxDay={maxDay}
              onChange={({ from, to }) => {
                setCustomFrom(from);
                setCustomTo(to);
              }}
              onClear={() => { setCustomFrom(''); setCustomTo(''); }}
            />
          )}
        </div>
      )}

      <div className="dashboard-panel-body heatmap-body">
        {loading ? (
          <div className="spinner" />
        ) : !connected ? (
          <div className="dashboard-empty-state">
            <div className="dashboard-empty-icon"><MessageSquare size={40} /></div>
            <p>Hubungkan WhatsApp untuk melihat jam-jam tersibuk Anda</p>
          </div>
        ) : error ? (
          <div className="dashboard-empty-state">
            <div className="dashboard-empty-icon"><MessageSquare size={40} /></div>
            <p>{error}</p>
          </div>
        ) : total === 0 ? (
          <div className="dashboard-empty-state">
            <div className="dashboard-empty-icon"><MessageSquare size={40} /></div>
            {/* "Nothing here" and "nothing in the window you picked" are different
                problems with different fixes, so they get different wording. */}
            {isFiltered ? (
              <>
                <p>Tidak ada interaksi pada rentang ini</p>
                <button
                  type="button"
                  className="heatmap-view-btn"
                  onClick={() => { setRange('all'); setCustomFrom(''); setCustomTo(''); }}
                >
                  Tampilkan semua
                </button>
              </>
            ) : (
              <p>
                {view === 'all'
                  ? 'Peta panas akan terisi setelah ada percakapan'
                  : `Belum ada pesan ${view === 'incoming' ? 'masuk' : 'keluar'} yang tercatat`}
              </p>
            )}
          </div>
        ) : (
          <div className="heatmap-wrap">
            <div className="heatmap-grid" ref={gridRef}>
              {/* Hour ruler. Labelled every three hours so the row stays legible
                  at dashboard width instead of collapsing into a smear. */}
              <div className="heatmap-hours" aria-hidden="true">
                <span className="heatmap-daylabel" />
                {Array.from({ length: 24 }, (_, hour) => (
                  <span key={hour} className="heatmap-hour">
                    {hour % 3 === 0 ? `${hour}h` : ''}
                  </span>
                ))}
              </div>

              {matrix.map((row, day) => (
                <div className="heatmap-row" key={day}>
                  <span className="heatmap-daylabel">{DAY_LABELS[day]}</span>
                  {row.map((count, hour) => {
                    const isActive = active && active.day === day && active.hour === hour;
                    const isPinned = pinned && pinned.day === day && pinned.hour === hour;
                    return (
                      <button
                        type="button"
                        key={hour}
                        className={`heatmap-cell level-${levelFor(count, max)}${isActive ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}`}
                        onMouseEnter={(e) => showTip(day, hour, e.currentTarget)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={(e) => showTip(day, hour, e.currentTarget)}
                        onBlur={() => setHovered(null)}
                        onClick={(e) => togglePin(day, hour, e.currentTarget)}
                        /* The visible tooltip is decorative; this is what a
                           screen reader actually reads out. */
                        aria-label={`${DAY_NAMES[day]} jam ${hour}:00 — ${count} interaksi`}
                      />
                    );
                  })}
                </div>
              ))}

              {active && (
                <div
                  className="heatmap-tooltip"
                  style={{ left: `${active.x}px`, top: `${active.y}px` }}
                  role="status"
                >
                  {/* Count read from the current matrix rather than from what was
                      captured when the cell was pinned, so a background refresh
                      or a view switch cannot leave a stale number on screen. */}
                  {DAY_NAMES[active.day]} jam {active.hour}:00 — {matrix[active.day][active.hour]} interaksi
                </div>
              )}
            </div>

            <div className="heatmap-footer">
              <div className="heatmap-summary">
                {busiest && busiest.count > 0 && (
                  <span>
                    Paling ramai <strong>{DAY_NAMES[busiest.day]} jam {busiest.hour}:00</strong>
                    {' '}({busiest.count})
                  </span>
                )}
                {coveredLabel && <span className="heatmap-range">{total} interaksi · {coveredLabel}</span>}
              </div>

              <div className="heatmap-legend" aria-hidden="true">
                <span>Sepi</span>
                {Array.from({ length: LEVELS + 1 }, (_, level) => (
                  <i key={level} className={`heatmap-cell level-${level}`} />
                ))}
                <span>Ramai</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
