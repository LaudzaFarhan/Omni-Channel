import React, { useMemo, useState } from 'react';
import { Users, Search, ChevronRight, MessageSquare, Clock, X } from 'lucide-react';
import { getChatDisplayName, getInitials, avatarColor, isSelfChat } from '../../utils/displayName.js';
import { shortWhen } from '../../utils/timeFormat.js';

// Customers, most recently active first, beside the heatmap.
//
// The heatmap answers "when are we busy"; this answers "who was that". Both read from
// the same `chats` the messages view already holds, so the panel costs no extra
// request.
//
// Groups are left out: a 40-person group is not a customer, and mixing them in makes
// the count meaningless. The self-chat is dropped for the same reason.
export default function CustomerList({
  chats = [], userInfo, savedNames = {}, onOpenChat,
  // Set by clicking a heatmap cell: { label, count, groupTotal, contributors }.
  cellSelection = null,
  onClearCellSelection,
}) {
  const [query, setQuery] = useState('');

  // Interaction count per chat for the selected cell, or null when nothing is selected.
  const cellCounts = useMemo(() => {
    if (!cellSelection) return null;
    const map = new Map();
    (cellSelection.contributors || []).forEach(({ chatJid, count }) => map.set(chatJid, count));
    return map;
  }, [cellSelection]);

  const customers = useMemo(() => {
    const list = chats
      .filter(c => c?.id)
      .filter(c => !c.id.endsWith('@g.us'))
      .filter(c => !isSelfChat(c, userInfo))
      // Only the conversations that produced interactions in the selected hour.
      .filter(c => !cellCounts || cellCounts.has(c.id))
      .map(c => ({
        ...c,
        label: getChatDisplayName(c, userInfo, savedNames[c.id]),
        cellCount: cellCounts ? (cellCounts.get(c.id) || 0) : null,
      }))
      // Under a cell filter, "who talked most in that hour" is the useful order. Otherwise
      // recency is.
      .sort((a, b) => (cellCounts
        ? b.cellCount - a.cellCount
        : (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)));

    const q = query.trim().toLowerCase();
    if (!q) return list;

    // Numbers are stored internationally (62811…) but people type them locally
    // (0811…), so a leading zero has to come off the query or the two never meet.
    // normalizePhone() handles this properly but needs a whole number; a partial
    // search is exactly the case it rejects, hence the narrower rule here. Stored
    // numbers never begin with 0, so stripping is unambiguous.
    const digits = q.replace(/\D/g, '').replace(/^0+/, '');

    return list.filter((c) => {
      if (c.label.toLowerCase().includes(q)) return true;
      if ((c.lastMessage || '').toLowerCase().includes(q)) return true;
      // Matched against the JID AND the resolved phone, because an @lid chat carries
      // its number in only one of the two.
      if (digits.length >= 3) {
        return `${c.id}${c.phoneNumber || ''}`.replace(/\D/g, '').includes(digits);
      }
      return false;
    });
  }, [chats, userInfo, savedNames, query, cellCounts]);

  const total = useMemo(
    () => chats.filter(c => c?.id && !c.id.endsWith('@g.us') && !isSelfChat(c, userInfo)).length,
    [chats, userInfo]
  );

  return (
    <div className="dashboard-panel customer-panel">
      <div className="dashboard-panel-header">
        <div className="dashboard-panel-header-left">
          <div className="panel-header-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
            <Users size={16} />
          </div>
          <span>Pelanggan</span>
        </div>
        {/* Under a cell filter the badge counts the people in that hour, not the whole
            book — a badge saying 340 above eleven rows contradicts itself. */}
        <span className="customer-count">
          {cellCounts ? `${customers.length}/${total}` : total}
        </span>
      </div>

      {/* Drill-down banner. Explains what the list is showing and how to get out of it —
          a silently filtered list looks like missing data. */}
      {cellSelection && (
        <div className="customer-cellfilter">
          <Clock size={13} style={{ flexShrink: 0, color: 'var(--primary)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{cellSelection.label}</strong>
            {/* English, because it completes the sentence the heat map hands over in
                `label` ("Monday at 14:00"), and the two halves cannot disagree. */}
            <div className="customer-cellfilter-sub">
              {cellSelection.count === 0
                ? 'No interactions in this hour'
                : <>
                    {cellSelection.count} {cellSelection.count === 1 ? 'interaction' : 'interactions'}
                    {/* The count includes group traffic, which this list cannot show. Said
                        out loud, because otherwise the rows visibly fail to add up. */}
                    {cellSelection.groupTotal > 0 && (
                      <> · {cellSelection.groupTotal} from groups (not shown)</>
                    )}
                  </>}
            </div>
          </div>
          <button
            onClick={onClearCellSelection}
            className="customer-cellfilter-clear"
            aria-label="Clear the hour filter"
            title="Show all customers"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {total > 0 && (
        <div className="customer-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama atau nomor…"
            aria-label="Cari pelanggan"
          />
        </div>
      )}

      {/* The only scrolling region. Its parent is a fixed-height flex column, so the
          list scrolls internally instead of stretching the row and pushing the
          heatmap out of alignment. */}
      <div className="customer-scroll">
        {customers.length === 0 ? (
          <div className="customer-empty">
            <MessageSquare size={28} />
            <p>
              {total === 0
                ? 'Belum ada percakapan dengan pelanggan'
                : query.trim()
                  ? `Tidak ada pelanggan yang cocok dengan “${query.trim()}”`
                  : cellSelection
                    // Reached when every interaction in the cell came from groups, which
                    // this list excludes. Without this the panel would look broken.
                    ? 'Every interaction in this hour came from groups, not customers'
                    : 'Belum ada percakapan dengan pelanggan'}
            </p>
          </div>
        ) : (
          <ul className="customer-list">
            {customers.map((customer) => (
              <li key={customer.id}>
                {/* One button per row rather than a clickable row plus a nested
                    button: nesting interactive elements is invalid and makes the row
                    unreachable by keyboard. The pill on the right is the visible
                    affordance for the same action. */}
                <button
                  type="button"
                  className="customer-row"
                  onClick={() => onOpenChat?.(customer.id)}
                  title={`Buka riwayat chat ${customer.label}`}
                >
                  <span className="customer-avatar" style={{ background: avatarColor(customer.id) }}>
                    {getInitials(customer.label)}
                  </span>

                  <span className="customer-body">
                    <span className="customer-top">
                      <span className="customer-name">{customer.label}</span>
                      <span
                        className="customer-when"
                        title={customer.lastMessageTimestamp
                          ? new Date(customer.lastMessageTimestamp).toLocaleString('id-ID')
                          : undefined}
                      >
                        {shortWhen(customer.lastMessageTimestamp)}
                      </span>
                    </span>

                    <span className="customer-hint">
                      {customer.lastMessageFromMe && <span className="customer-you">Anda: </span>}
                      {customer.lastMessage || 'Belum ada pesan'}
                    </span>
                  </span>

                  {/* Under a cell filter, this person's share of that hour is more useful
                      than their unread count, and showing both crowds the row. */}
                  {customer.cellCount !== null ? (
                    <span className="customer-cellcount">{customer.cellCount}</span>
                  ) : customer.unreadCount > 0 && (
                    <span className="customer-unread">{customer.unreadCount}</span>
                  )}

                  <span className="customer-open">
                    Lihat <ChevronRight size={12} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
