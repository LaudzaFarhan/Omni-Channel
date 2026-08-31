import React, { useMemo } from 'react';
import { Filter, ChevronRight } from 'lucide-react';

// The three commercial states a conversation can be in, in the order they progress.
//
// Labels and colours match the filter pills above the chat list on purpose: these are the
// same buckets, and a dashboard that renames them would read as a different feature.
// "New Leads" rather than "Prospect" because an untouched conversation is a new lead.
const STAGES = [
  { key: 'prospect', label: 'New Leads', color: 'var(--primary)' },
  { key: 'closed_won', label: 'Closed Won', color: 'var(--success)' },
  { key: 'dropped', label: 'Bukan Prospek', color: 'var(--text-dimmed)' },
];

/**
 * Where the team's conversations stand commercially.
 *
 * Counted from the same `chats` array and the same status map the chat list uses, and a
 * conversation with no stored status reads as a prospect — exactly as the pills do — so
 * the two screens can never disagree about a number.
 *
 * The rows are deliberately not links. Applying a filter lives with the chat list that
 * owns that state, so a row here could show the count but not act on it; one honest
 * button to the inbox beats three that half-work.
 */
export default function PipelinePanel({ chats = [], chatStatuses = {}, onOpenInbox }) {
  const counts = useMemo(() => {
    const tally = { prospect: 0, closed_won: 0, dropped: 0 };
    chats.forEach((chat) => {
      if (!chat?.id) return;
      const status = chatStatuses[chat.id] || 'prospect';
      if (tally[status] !== undefined) tally[status]++;
    });
    return tally;
  }, [chats, chatStatuses]);

  const total = counts.prospect + counts.closed_won + counts.dropped;

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <Filter size={18} />
        <span>Pipeline Percakapan</span>
        <span className="customer-count">{total}</span>
      </div>

      <div className="dashboard-panel-body pipeline-body">
        {total === 0 ? (
          <div className="dashboard-empty-state">
            <div className="dashboard-empty-icon"><Filter size={36} /></div>
            <p>Pipeline akan terisi setelah ada percakapan masuk</p>
          </div>
        ) : (
          <>
            <ul className="pipeline-list">
              {STAGES.map(({ key, label, color }) => {
                const count = counts[key];
                // Share of the pipeline. Widths are relative to the total rather than to
                // the largest stage, so the three bars read as parts of one whole.
                const share = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <li key={key} className="pipeline-row">
                    <span className="pipeline-label">
                      <i className="pipeline-dot" style={{ background: color }} />
                      {label}
                    </span>
                    <span className="pipeline-track">
                      <span
                        className="pipeline-fill"
                        style={{ width: `${share}%`, background: color }}
                      />
                    </span>
                    <span className="pipeline-value">
                      {count}
                      <small>{share}%</small>
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="pipeline-note">
              Status diubah dari dalam percakapan, dan berlaku untuk seluruh tim.
            </p>
          </>
        )}
      </div>

      {onOpenInbox && (
        <button type="button" className="convlog-seeall" onClick={onOpenInbox}>
          Buka percakapan <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}
