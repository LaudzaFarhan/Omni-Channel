import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// Filter pills above the chat list with compact view optimization.
export default function ChatFilterPills({
  filter,          // { kind: 'all' | 'status' | 'tag' | 'window' | 'unread' | 'ad', value }
  onChange,
  totalCount,
  statusCounts = {},    // { prospect, closed_won, dropped }
  over24hCount = 0,
  unreadCount = 0,
  adCount = 0,
  tags = [],            // [{ label, color, bg }]
  tagCounts = {},
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isActive = (kind, value) =>
    filter.kind === kind && (kind === 'all' || filter.value === value);

  const Pill = ({ kind, value, label, count, color, isMoreBtn, onClick }) => {
    const active = isActive(kind, value);
    return (
      <button
        type="button"
        className={`chat-pill ${active ? 'active' : ''} ${isMoreBtn ? 'chat-pill-more' : ''}`}
        aria-pressed={active}
        onClick={onClick ? onClick : () => onChange(active && kind !== 'all' ? { kind: 'all' } : { kind, value })}
        style={active && color ? { background: color, borderColor: color } : undefined}
      >
        {color && !active && <span className="chat-pill-dot" style={{ background: color }} />}
        {label}
        {count !== undefined && <span className="chat-pill-count">{count}</span>}
      </button>
    );
  };

  // Sort tags so tags with active conversations appear first
  const sortedTags = useMemo(() => {
    return [...tags].sort((a, b) => {
      const countA = tagCounts[a.label.toLowerCase()] || 0;
      const countB = tagCounts[b.label.toLowerCase()] || 0;
      return countB - countA;
    });
  }, [tags, tagCounts]);

  // Max tags to show in compact mode
  const MAX_COMPACT_TAGS = 2;

  // Compute visible tags and remaining tags in compact view
  const { visibleTags, remainingTags, hasHiddenActiveTag } = useMemo(() => {
    if (isExpanded || sortedTags.length <= MAX_COMPACT_TAGS) {
      return { visibleTags: sortedTags, remainingTags: [], hasHiddenActiveTag: false };
    }

    const activeTagValue = filter.kind === 'tag' ? filter.value : null;
    let initialVisible = sortedTags.slice(0, MAX_COMPACT_TAGS);
    let initialRemaining = sortedTags.slice(MAX_COMPACT_TAGS);

    // If active tag is inside remaining list, pull it into visible list so the user sees it
    if (activeTagValue) {
      const activeIdx = initialRemaining.findIndex(t => t.label.toLowerCase() === activeTagValue);
      if (activeIdx > -1) {
        const [activeTag] = initialRemaining.splice(activeIdx, 1);
        initialVisible.push(activeTag);
      }
    }

    return {
      visibleTags: initialVisible,
      remainingTags: initialRemaining,
      hasHiddenActiveTag: false,
    };
  }, [sortedTags, isExpanded, filter]);

  return (
    <div className="chat-pill-row">
      {/* 1. All Chats */}
      <Pill kind="all" label="Semua" count={totalCount} />

      {/* 2. New Leads */}
      <Pill kind="status" value="prospect" label="New Leads" count={statusCounts.prospect} />

      {/* 3. > 24 Hours Overdue */}
      {over24hCount > 0 && (
        <Pill
          kind="window"
          value="over24h"
          label="> 24 Jam"
          count={over24hCount}
          color="#ef4444"
        />
      )}

      {/* 3.5. Unread Chats */}
      {unreadCount > 0 && (
        <Pill
          kind="unread"
          value="unread"
          label="Belum Dibaca"
          count={unreadCount}
          color="#3b82f6"
        />
      )}

      {/* 3.7. Ad Chats */}
      {adCount > 0 && (
        <Pill
          kind="ad"
          value="ad"
          label="📢 Iklan"
          count={adCount}
          color="#8b5cf6"
        />
      )}

      {/* 4. Commercial Statuses (Only shown if count > 0) */}
      {statusCounts.closed_won > 0 && (
        <Pill kind="status" value="closed_won" label="Closed Won" count={statusCounts.closed_won} />
      )}
      {statusCounts.dropped > 0 && (
        <Pill kind="status" value="dropped" label="Bukan Prospek" count={statusCounts.dropped} />
      )}

      {/* 5. Visible Tags */}
      {visibleTags.map(tag => (
        <Pill
          key={tag.value || tag.label}
          kind="tag"
          value={tag.label.toLowerCase()}
          label={tag.label}
          count={tagCounts[tag.label.toLowerCase()] || 0}
          color={tag.color}
        />
      ))}

      {/* 6. Expand / Show More Tags Toggle Pill */}
      {!isExpanded && remainingTags.length > 0 && (
        <button
          type="button"
          className="chat-pill chat-pill-more"
          onClick={() => setIsExpanded(true)}
          title={`Tampilkan ${remainingTags.length} tag lainnya`}
          style={{
            borderStyle: 'dashed',
            color: 'var(--primary)',
            background: 'var(--primary-subtle)',
            borderColor: 'var(--primary-border)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>+{remainingTags.length} Tag</span>
          <ChevronDown size={12} />
        </button>
      )}

      {/* 7. Collapse Pill when expanded */}
      {isExpanded && sortedTags.length > MAX_COMPACT_TAGS && (
        <button
          type="button"
          className="chat-pill chat-pill-collapse"
          onClick={() => setIsExpanded(false)}
          title="Sembunyikan tag ekstra"
          style={{
            color: 'var(--text-dimmed)',
            background: 'transparent',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>Ringkas</span>
          <ChevronUp size={12} />
        </button>
      )}
    </div>
  );
}
