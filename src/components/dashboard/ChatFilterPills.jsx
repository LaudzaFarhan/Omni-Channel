import React from 'react';

// Filter pills above the chat list.
//
// Replaces a two-column grid of stat cards that cost ~110px of vertical space before a
// single conversation was visible, and grew a scrollbar of its own once a few custom
// tags existed. A pill row shows the same counts in one line and wraps.
//
// Two kinds of filter share the row because they answer the same question ("show me a
// subset"), and keeping them apart would mean two rows:
//
//   status  where the conversation stands commercially (chat_settings.status)
//   tag     the operator's own labels (localStorage, per browser)
export default function ChatFilterPills({
  filter,          // { kind: 'all' | 'status' | 'tag', value }
  onChange,
  totalCount,
  statusCounts,    // { prospect, closed_won, dropped }
  tags,            // [{ label, color, bg }]
  tagCounts,
}) {
  const isActive = (kind, value) =>
    filter.kind === kind && (kind === 'all' || filter.value === value);

  const Pill = ({ kind, value, label, count, color }) => {
    const active = isActive(kind, value);
    return (
      <button
        type="button"
        className={`chat-pill ${active ? 'active' : ''}`}
        aria-pressed={active}
        // Clicking the active pill clears it, so a filter never needs a separate
        // "clear" control.
        onClick={() => onChange(active && kind !== 'all' ? { kind: 'all' } : { kind, value })}
        style={active && color ? { background: color, borderColor: color } : undefined}
      >
        {color && !active && <span className="chat-pill-dot" style={{ background: color }} />}
        {label}
        {count !== undefined && <span className="chat-pill-count">{count}</span>}
      </button>
    );
  };

  return (
    <div className="chat-pill-row">
      <Pill kind="all" label="Semua" count={totalCount} />

      {/* "New Leads" rather than "Prospect": an untouched conversation is a new lead,
          which is what the operator is looking for. */}
      <Pill kind="status" value="prospect" label="New Leads" count={statusCounts.prospect} />

      {/* Only offered once something has actually been marked, so the row does not carry
          two permanently empty pills on a fresh account. */}
      {statusCounts.closed_won > 0 && (
        <Pill kind="status" value="closed_won" label="Closed Won" count={statusCounts.closed_won} />
      )}
      {statusCounts.dropped > 0 && (
        <Pill kind="status" value="dropped" label="Bukan Prospek" count={statusCounts.dropped} />
      )}

      {tags.map(tag => (
        <Pill
          key={tag.value || tag.label}
          kind="tag"
          value={tag.label.toLowerCase()}
          label={tag.label}
          count={tagCounts[tag.label.toLowerCase()] || 0}
          color={tag.color}
        />
      ))}
    </div>
  );
}
