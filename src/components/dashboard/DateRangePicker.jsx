import React, { useState, useEffect, useRef, useMemo } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  MONTH_NAMES, WEEKDAY_LABELS,
  addMonths, monthCursorFor, monthGrid, isDayInRange,
  formatDayRange, daysBetween, todayKey,
} from '../../utils/dateRange.js';

// Two-month calendar for picking a day range.
//
// Replaces a pair of <input type="date"> boxes. Those work, but choosing a span with
// them is two disconnected decisions — you cannot see how far apart the dates are,
// which days actually hold data, or that you have picked a Wednesday. A calendar
// answers all three by showing the span.
//
// It deals only in 'YYYY-MM-DD' day keys. Converting those to the instants the API
// wants stays in dateRange.js, which is where the timezone reasoning is tested, so
// this component cannot reintroduce that class of bug.
export default function DateRangePicker({
  from, to,
  minDay, maxDay,
  onChange,
  onClear,
  align = 'left',
}) {
  const [open, setOpen] = useState(false);

  // Half-finished selection. Kept separate from the committed `from`/`to` so
  // abandoning a pick leaves the applied range untouched.
  const [anchor, setAnchor] = useState(null);
  const [hovered, setHovered] = useState(null);

  // Which month is on the left. Opens on the current selection so reopening does not
  // jump away from what is applied.
  const [cursor, setCursor] = useState(() => monthCursorFor(from));

  const rootRef = useRef(null);

  useEffect(() => {
    if (open) {
      setCursor(monthCursorFor(from || maxDay));
      setAnchor(null);
      setHovered(null);
    }
  }, [open, from, maxDay]);

  // Close on an outside click or Escape. Without this the popover would sit over the
  // grid it is meant to filter.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const months = useMemo(() => [cursor, addMonths(cursor, 1)], [cursor]);

  // While picking the second date, preview against whatever the pointer is over.
  // Normalised to [start, end] once, here, so the per-cell code is three string
  // comparisons instead of re-deriving the order 42 times per month.
  const [rangeStart, rangeEnd] = useMemo(() => {
    const a = anchor || from;
    const b = anchor ? (hovered || anchor) : to;
    if (!a) return [null, null];
    if (!b) return [a, a];
    return a <= b ? [a, b] : [b, a];
  }, [anchor, hovered, from, to]);

  const today = todayKey();

  const isDisabled = (day) => {
    if (!day) return true;
    if (minDay && day < minDay) return true;
    if (maxDay && day > maxDay) return true;
    return false;
  };

  const pick = (day) => {
    if (isDisabled(day)) return;

    if (!anchor) {
      setAnchor(day);
      setHovered(day);
      return;
    }

    // Second click completes it. Order is normalised by boundsFor, but sorting here
    // too keeps what the UI reports back consistent with what the user sees.
    const [lo, hi] = anchor <= day ? [anchor, day] : [day, anchor];
    setAnchor(null);
    setHovered(null);
    setOpen(false);
    onChange?.({ from: lo, to: hi });
  };

  // Can the left month go back / the right month go forward without leaving the data?
  const canGoBack = !minDay || monthStart(months[0]) > minDay;
  const canGoForward = !maxDay || monthStart(addMonths(cursor, 1)) < maxDay;

  const label = formatDayRange(from, to);
  const spanDays = from && to ? daysBetween(from, to) : 0;

  return (
    <div className="heatmap-calendar" ref={rootRef}>
      <button
        type="button"
        className={`heatmap-calendar-trigger ${label ? 'has-value' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <CalendarRange size={14} />
        <span>{label || 'Pick dates'}</span>
        {spanDays > 0 && (
          <span className="heatmap-calendar-count">
            {spanDays} {spanDays === 1 ? 'day' : 'days'}
          </span>
        )}
      </button>

      {label && onClear && (
        <button
          type="button"
          className="heatmap-calendar-clear"
          onClick={onClear}
          aria-label="Clear date range"
          title="Clear range"
        >
          <X size={13} />
        </button>
      )}

      {open && (
        <div
          className={`heatmap-calendar-pop ${align === 'right' ? 'align-right' : ''}`}
          role="dialog"
          aria-modal="false"
          aria-label="Select a date range"
        >
          <div className="heatmap-calendar-nav">
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, -1))}
              disabled={!canGoBack}
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <span aria-live="polite">
              {anchor ? 'Pick the end date' : 'Pick the start date'}
            </span>
            <button
              type="button"
              onClick={() => setCursor(addMonths(cursor, 1))}
              disabled={!canGoForward}
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="heatmap-calendar-months">
            {months.map((m) => (
              <div className="heatmap-calendar-month" key={`${m.year}-${m.month}`}>
                <div className="heatmap-calendar-caption">
                  {MONTH_NAMES[m.month]} {m.year}
                </div>

                <div className="heatmap-calendar-weekdays" aria-hidden="true">
                  {WEEKDAY_LABELS.map((d, i) => <span key={i}>{d}</span>)}
                </div>

                <div className="heatmap-calendar-grid" onMouseLeave={() => anchor && setHovered(anchor)}>
                  {monthGrid(m).flat().map((day, i) => {
                    if (!day) return <span className="heatmap-day is-blank" key={i} />;

                    const disabled = isDisabled(day);

                    const classes = ['heatmap-day'];
                    if (disabled) classes.push('is-disabled');
                    if (isDayInRange(day, rangeStart, rangeEnd)) classes.push('in-range');
                    if (day === rangeStart) classes.push('is-start');
                    if (day === rangeEnd) classes.push('is-end');
                    if (day === today) classes.push('is-today');

                    return (
                      <button
                        type="button"
                        key={i}
                        className={classes.join(' ')}
                        disabled={disabled}
                        onClick={() => pick(day)}
                        onMouseEnter={() => !disabled && setHovered(day)}
                        onFocus={() => !disabled && anchor && setHovered(day)}
                        aria-label={day}
                        aria-current={day === today ? 'date' : undefined}
                      >
                        {localDayNumber(day)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="heatmap-calendar-foot">
            <span>
              {anchor
                ? `From ${formatDayRange(anchor, anchor)} — pick the end date`
                : label
                  ? `Selected: ${label}`
                  : 'Click the start date, then the end date'}
            </span>
            {minDay && maxDay && (
              <span className="heatmap-calendar-avail">
                Data: {formatDayRange(minDay, maxDay)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// The day-of-month, straight off the key. Avoids constructing a Date just to read a
// number that is already the last two characters.
function localDayNumber(day) {
  return Number(String(day).slice(8, 10));
}

function monthStart({ year, month }) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month + 1)}-01`;
}
