import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MessageSquare, RefreshCw, ChevronRight, Loader2, Info, Inbox, ArrowDownLeft, ArrowUpRight,
} from 'lucide-react';
import { fetchConversationLog } from '../../utils/api.js';
import { getChatDisplayName, getInitials, avatarColor, isSelfChat } from '../../utils/displayName.js';
import { shortWhen, fullWhen, shortDuration } from '../../utils/timeFormat.js';
import { subscribeSocket } from '../../utils/socket.js';

// Which conversations to show. One selection at a time, because these overlap: an
// unanswered chat is also a customer-initiated one, so independent toggles would produce
// combinations that mean nothing.
const FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'customer', label: 'Dari pelanggan' },
  { key: 'awaiting', label: 'Belum dibalas' },
];

/**
 * The team's customer conversation history.
 *
 * Replaces a per-agent grouping that repeated the same customer under every teammate who
 * had replied, and split one teammate into two rows when some of their messages predated
 * uid stamping. Here the conversation is the row and the agents who answered are a
 * detail inside it, so a customer appears exactly once and the history reads as a log.
 *
 * Two variants share this code because they are the same list at two sizes: `panel` is
 * the compact home-page card, `page` is the full view with filters. Splitting them into
 * separate components is what let the old copies drift apart in the first place.
 *
 * Groups and the self-chat are excluded. A group is not a customer, and counting them
 * makes "how many customers started a conversation" unanswerable.
 */
export default function ConversationLog({
  activeSessionId = 'default',
  chats = [],
  userInfo,
  savedNames = {},
  onOpenChat,
  variant = 'page',
  // Panel variant: how many rows to show before deferring to the full view.
  limit = 6,
  onSeeAll,
  // Reports the server's totals to the parent, so the home page can show "menunggu
  // balasan" without making the same request a second time.
  onTotals,
}) {
  const isPanel = variant === 'panel';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchConversationLog(activeSessionId));
      setError(null);
    } catch (err) {
      setError(err?.message || 'Gagal memuat riwayat percakapan.');
    } finally {
      setLoading(false);
    }
  }, [activeSessionId]);

  useEffect(() => { load(); }, [load]);

  // Keep the log current without a manual refresh, coalesced because a history sync
  // fires this hundreds of times and each one re-walks the whole store server-side.
  useEffect(() => {
    let timer = null;
    let attached = null;

    const handleActivity = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; load(); }, 5000);
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

  // Resolve labels the way the rest of the app does, so a customer reads identically
  // here and in the chat list. The server's own label is the fallback for a chat that has
  // aged out of the live list.
  const chatById = useMemo(() => {
    const map = new Map();
    chats.forEach((c) => { if (c?.id) map.set(c.id, c); });
    return map;
  }, [chats]);

  const rows = useMemo(() => {
    const all = (data?.conversations || [])
      .filter(c => !c.isGroup)
      .map((c) => {
        const chat = chatById.get(c.jid)
          || { id: c.jid, name: c.name, phoneNumber: c.phoneNumber };
        return {
          ...c,
          chat,
          label: getChatDisplayName(chat, userInfo, savedNames[c.jid]),
          awaiting: c.incoming > 0 && c.outgoing === 0,
        };
      })
      .filter(c => !isSelfChat(c.chat, userInfo));

    if (filter === 'customer') return all.filter(c => c.initiatedBy === 'customer');
    if (filter === 'awaiting') return all.filter(c => c.awaiting);
    return all;
  }, [data, chatById, userInfo, savedNames, filter]);

  const visible = isPanel ? rows.slice(0, limit) : rows;
  const totals = data?.totals;

  // Hand the totals up after render rather than during the fetch, so a parent setting
  // state in response cannot re-enter this component's own update.
  useEffect(() => {
    if (totals) onTotals?.(totals);
    // onTotals is intentionally omitted: parents commonly pass an inline arrow, which
    // would make this fire on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals]);

  // ---------------------------------------------------------------------------
  // pieces shared by both variants
  // ---------------------------------------------------------------------------
  const emptyMessage = () => {
    if (filter === 'awaiting') return 'Semua pesan pelanggan sudah dibalas.';
    if (filter === 'customer') return 'Belum ada percakapan yang dimulai oleh pelanggan.';
    return 'Belum ada percakapan pelanggan yang tercatat.';
  };

  const list = (
    <>
      {error && (
        <div className="convlog-error">
          <strong>Tidak bisa memuat riwayat.</strong> {error}
        </div>
      )}

      {loading && !data && (
        <div className="convlog-loading">
          <Loader2 size={18} className="spin-icon" /> Memuat…
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="dashboard-empty-state">
          <div className="dashboard-empty-icon"><Inbox size={36} /></div>
          <p>{emptyMessage()}</p>
        </div>
      )}

      {visible.length > 0 && (
        <ul className="convlog-list">
          {visible.map((row) => {
            // When the conversation started. The customer's first message is the
            // meaningful date for a log of inbound conversations; a chat we opened
            // ourselves falls back to its oldest retained message.
            const startedTs = row.firstCustomerTs || row.firstTs;

            return (
              <li key={row.jid}>
                <button
                  type="button"
                  className="convlog-row"
                  onClick={() => onOpenChat?.(row.jid)}
                  title={`Buka riwayat chat ${row.label}`}
                >
                  <span className="convlog-avatar" style={{ background: avatarColor(row.jid) }}>
                    {getInitials(row.label)}
                  </span>

                  <span className="convlog-body">
                    <span className="convlog-top">
                      <span className="convlog-name">{row.label}</span>

                      {row.initiatedBy === 'customer' && (
                        <span className="convlog-tag is-customer">Pelanggan mulai</span>
                      )}
                      {row.initiatedBy === 'us' && (
                        <span className="convlog-tag">Kami mulai</span>
                      )}
                      {/* The opening message has aged out of the retained window, so
                          claiming either side started it would be a guess. */}
                      {row.initiatedBy === 'unknown' && (
                        <span
                          className="convlog-tag"
                          title={`Percakapan lebih panjang dari ${data?.retainedPerChat || 100} pesan terakhir yang disimpan, jadi pembukanya tidak diketahui.`}
                        >
                          Awal tidak diketahui
                        </span>
                      )}
                      {row.awaiting && <span className="convlog-tag is-awaiting">Belum dibalas</span>}
                    </span>

                    <span className="convlog-meta">
                      {startedTs && (
                        <span title={fullWhen(startedTs)}>Mulai {shortWhen(startedTs)}</span>
                      )}
                      <span className="convlog-counts">
                        <ArrowDownLeft size={12} /> {row.incoming}
                        <ArrowUpRight size={12} /> {row.outgoing}
                      </span>
                      {row.responseMs !== null && row.responseMs !== undefined && (
                        <span title="Selisih antara pesan pertama pelanggan dan balasan pertama tim">
                          Dibalas dalam {shortDuration(row.responseMs)}
                        </span>
                      )}
                    </span>

                    {/* Who actually handled it. This is the whole per-agent view reduced
                        to one line, which is all it needed to be. */}
                    {row.agents.length > 0 && (
                      <span className="convlog-agents">
                        {row.agents.map(agent => (
                          <span
                            key={agent.uid || agent.name}
                            className="convlog-agent"
                            title={`${agent.name}: ${agent.count} pesan`}
                          >
                            <i style={{ background: avatarColor(agent.uid || agent.name) }} />
                            {agent.name}
                            <b>{agent.count}</b>
                          </span>
                        ))}
                        {row.unattributedOutgoing > 0 && (
                          <span
                            className="convlog-agent is-muted"
                            title="Terkirim dari HP, oleh bot, atau sebelum pencatatan agen aktif"
                          >
                            Tanpa agen <b>{row.unattributedOutgoing}</b>
                          </span>
                        )}
                      </span>
                    )}
                  </span>

                  <span className="convlog-tail">
                    <span className="convlog-when" title={fullWhen(row.lastTs)}>
                      {shortWhen(row.lastTs)}
                    </span>
                    {row.unreadCount > 0 && (
                      <span className="convlog-unread">{row.unreadCount}</span>
                    )}
                    <span className="customer-open">
                      Lihat <ChevronRight size={12} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  // ---------------------------------------------------------------------------
  // panel variant: the home page card
  // ---------------------------------------------------------------------------
  if (isPanel) {
    return (
      <div className="dashboard-panel convlog-panel">
        <div className="dashboard-panel-header">
          <MessageSquare size={18} />
          <span>Riwayat Percakapan Pelanggan</span>
          {totals && (
            <span className="customer-count" title="Percakapan pelanggan yang tercatat">
              {totals.customers}
            </span>
          )}
        </div>

        {/* Surfaced above the list because it is the one number here that asks for
            action, and it would otherwise be buried several rows down. */}
        {totals && totals.awaitingReply > 0 && (
          <div className="convlog-alert">
            <Info size={14} />
            <span><strong>{totals.awaitingReply}</strong> pelanggan menunggu balasan pertama</span>
          </div>
        )}

        <div className="convlog-scroll">{list}</div>

        {onSeeAll && rows.length > visible.length && (
          <button type="button" className="convlog-seeall" onClick={onSeeAll}>
            Lihat semua {rows.length} percakapan <ChevronRight size={13} />
          </button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // page variant: the full view
  // ---------------------------------------------------------------------------
  return (
    <div className="view-container">
      <div className="view-header convlog-header">
        <div>
          <h2>
            <MessageSquare size={26} style={{ color: 'var(--primary)' }} /> Riwayat Percakapan
          </h2>
          <p>
            Satu baris per pelanggan, percakapan terbaru di atas. Setiap baris menunjukkan
            siapa yang memulai, berapa pesan masuk dan keluar, serta agen mana yang
            membalas. Menampilkan percakapan terbaru, bukan seluruh riwayat.
          </p>
        </div>

        <button onClick={load} disabled={loading} className="convlog-refresh" title="Muat ulang">
          <RefreshCw size={15} className={loading ? 'spin-icon' : ''} /> Segarkan
        </button>
      </div>

      {totals && (
        <div className="convlog-summary">
          <div className="convlog-stat">
            <span className="convlog-stat-value">{totals.customers}</span>
            <span className="convlog-stat-label">Pelanggan</span>
          </div>
          <div className="convlog-stat">
            <span className="convlog-stat-value">{totals.customerInitiated}</span>
            <span className="convlog-stat-label">Dimulai pelanggan</span>
          </div>
          <div className={`convlog-stat ${totals.awaitingReply > 0 ? 'is-awaiting' : ''}`}>
            <span className="convlog-stat-value">{totals.awaitingReply}</span>
            <span className="convlog-stat-label">Belum dibalas</span>
          </div>
          <div className="convlog-stat">
            <span className="convlog-stat-value">{totals.incoming}</span>
            <span className="convlog-stat-label">Pesan masuk</span>
          </div>
          <div className="convlog-stat">
            <span className="convlog-stat-value">{totals.outgoing}</span>
            <span className="convlog-stat-label">Pesan keluar</span>
          </div>
        </div>
      )}

      <div className="chat-pill-row convlog-filters">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`chat-pill ${filter === key ? 'active' : ''}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className="chat-pill-count">
              {key === 'all' ? (totals?.customers ?? 0)
                : key === 'customer' ? (totals?.customerInitiated ?? 0)
                : (totals?.awaitingReply ?? 0)}
            </span>
          </button>
        ))}
      </div>

      <div className="view-content convlog-content">
        {list}

        {/* Said out loud rather than hidden: these messages are counted in the totals but
            cannot be tied to a teammate, so the per-agent chips are knowingly partial. */}
        {totals && totals.unattributedOutgoing > 0 && (
          <div className="convlog-note">
            <Info size={15} />
            <span>
              {totals.unattributedOutgoing} pesan terkirim tidak terlacak ke agen mana pun —
              dikirim dari HP, oleh bot, atau sebelum fitur ini aktif.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
