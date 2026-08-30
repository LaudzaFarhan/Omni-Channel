import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Clock, MessageSquare } from 'lucide-react';
import { fetchActivityHeatmap } from '../../utils/api.js';
import { subscribeSocket } from '../../utils/socket.js';

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const VIEWS = [
  { key: 'all', label: 'Semua' },
  { key: 'incoming', label: 'Masuk' },
  { key: 'outgoing', label: 'Keluar' },
];

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
export default function InteractionHeatmap({ activeSessionId = 'default', connected = true }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('all');

  // Hover is transient; a click pins a cell so the reading survives the pointer
  // leaving, and so touch users can read it at all.
  const [hovered, setHovered] = useState(null);
  const [pinned, setPinned] = useState(null);

  const gridRef = useRef(null);

  const load = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      return;
    }
    try {
      setData(await fetchActivityHeatmap(activeSessionId));
      setError(null);
    } catch (err) {
      console.info('[Heatmap] Could not load activity:', err.message);
      setError(err.message || 'Tidak bisa memuat data aktivitas.');
    } finally {
      setLoading(false);
    }
  }, [activeSessionId, connected]);

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

  // Clear a pinned cell when the numbers underneath it change meaning.
  useEffect(() => { setPinned(null); }, [view]);

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

  const togglePin = (day, hour, element) => {
    const grid = gridRef.current;
    if (!grid || !element) return;
    if (pinned && pinned.day === day && pinned.hour === hour) {
      setPinned(null);
      return;
    }
    const gridBox = grid.getBoundingClientRect();
    const cellBox = element.getBoundingClientRect();
    setPinned({
      day, hour,
      x: cellBox.left - gridBox.left + cellBox.width / 2,
      y: cellBox.top - gridBox.top,
    });
  };

  const range = data ? formatRange(data.from, data.to) : null;

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
            <p>
              {view === 'all'
                ? 'Peta panas akan terisi setelah ada percakapan'
                : `Belum ada pesan ${view === 'incoming' ? 'masuk' : 'keluar'} yang tercatat`}
            </p>
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
                {range && <span className="heatmap-range">{total} interaksi · {range}</span>}
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
