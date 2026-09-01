import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MessageSquare, RefreshCw, ChevronRight, Loader2, Info, Inbox, ArrowDownLeft, ArrowUpRight,
  Search, X, Users, UserCheck, MessageCircle, Clock, ArrowUpDown, Filter,
} from 'lucide-react';
import { fetchConversationLog } from '../../utils/api.js';
import { getChatDisplayName, getInitials, avatarColor, isSelfChat } from '../../utils/displayName.js';
import { shortWhen, fullWhen, shortDuration } from '../../utils/timeFormat.js';
import { subscribeSocket } from '../../utils/socket.js';

// Which conversations to show
const FILTERS = [
  { key: 'all', label: 'Semua Percakapan', icon: Users },
  { key: 'customer', label: 'Dimulai Pelanggan', icon: MessageCircle },
  { key: 'awaiting', label: 'Belum Dibalas', icon: Clock },
];

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
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'messages' | 'waiting'
  const [displayCount, setDisplayCount] = useState(30);

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

  // Resolve labels the way the rest of the app does
  const chatById = useMemo(() => {
    const map = new Map();
    chats.forEach((c) => { if (c?.id) map.set(c.id, c); });
    return map;
  }, [chats]);

  const allRows = useMemo(() => {
    return (data?.conversations || [])
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
  }, [data, chatById, userInfo, savedNames]);

  // Filter & Search & Sort
  const filteredAndSortedRows = useMemo(() => {
    let result = allRows;

    // Filter type
    if (filter === 'customer') {
      result = result.filter(c => c.initiatedBy === 'customer');
    } else if (filter === 'awaiting') {
      result = result.filter(c => c.awaiting);
    }

    // Search query
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      result = result.filter(c => {
        const matchLabel = (c.label || '').toLowerCase().includes(q);
        const matchPhone = (c.chat?.phoneNumber || c.phoneNumber || '').toLowerCase().includes(q);
        const matchJid = (c.jid || '').toLowerCase().includes(q);
        const matchAgent = (c.agents || []).some(a => (a.name || '').toLowerCase().includes(q));
        return matchLabel || matchPhone || matchJid || matchAgent;
      });
    }

    // Sort
    return [...result].sort((a, b) => {
      if (sortBy === 'messages') {
        const aTotal = (a.incoming || 0) + (a.outgoing || 0);
        const bTotal = (b.incoming || 0) + (b.outgoing || 0);
        return bTotal - aTotal;
      }
      if (sortBy === 'waiting') {
        if (a.awaiting !== b.awaiting) return a.awaiting ? -1 : 1;
        const aWait = a.firstCustomerTs ? (Date.now() - new Date(a.firstCustomerTs).getTime()) : 0;
        const bWait = b.firstCustomerTs ? (Date.now() - new Date(b.firstCustomerTs).getTime()) : 0;
        return bWait - aWait;
      }
      // default: recent
      const aTime = a.lastTs ? new Date(a.lastTs).getTime() : 0;
      const bTime = b.lastTs ? new Date(b.lastTs).getTime() : 0;
      return bTime - aTime;
    });
  }, [allRows, filter, searchQuery, sortBy]);

  const visible = isPanel ? filteredAndSortedRows.slice(0, limit) : filteredAndSortedRows.slice(0, displayCount);
  const totals = data?.totals;

  // Hand the totals up after render
  useEffect(() => {
    if (totals) onTotals?.(totals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals]);

  const emptyMessage = () => {
    if (searchQuery) return `Tidak ada percakapan yang cocok dengan "${searchQuery}".`;
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
          <Loader2 size={20} className="spin-icon" /> Memuat riwayat percakapan…
        </div>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="dashboard-empty-state" style={{ padding: '60px 20px' }}>
          <div className="dashboard-empty-icon" style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'var(--overlay-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Inbox size={32} style={{ color: 'var(--text-dimmed)' }} />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', maxWidth: '380px', margin: '0 auto 16px' }}>{emptyMessage()}</p>
          {searchQuery && (
            <button
              type="button"
              className="chat-pill active"
              onClick={() => setSearchQuery('')}
              style={{ margin: '0 auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <X size={14} /> Hapus Pencarian
            </button>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <ul className="convlog-list">
          {visible.map((row) => {
            const startedTs = row.firstCustomerTs || row.firstTs;
            const phoneStr = row.chat?.phoneNumber || (row.jid?.includes('@') ? row.jid.split('@')[0] : '');

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

                      {phoneStr && phoneStr !== row.label && (
                        <span className="convlog-phone" style={{ fontSize: '0.75rem', color: 'var(--text-dimmed)', marginRight: '4px' }}>
                          +{phoneStr}
                        </span>
                      )}

                      {row.awaiting && (
                        <span className="convlog-tag is-awaiting">
                          <span className="pulsing-dot" /> Belum dibalas
                        </span>
                      )}

                      {row.initiatedBy === 'customer' && (
                        <span className="convlog-tag is-customer">Pelanggan mulai</span>
                      )}
                      {row.initiatedBy === 'us' && (
                        <span className="convlog-tag">Kami mulai</span>
                      )}
                      {row.initiatedBy === 'unknown' && (
                        <span
                          className="convlog-tag"
                          title={`Percakapan lebih panjang dari ${data?.retainedPerChat || 100} pesan terakhir yang disimpan.`}
                        >
                          Awal tidak diketahui
                        </span>
                      )}
                    </span>

                    <span className="convlog-meta">
                      {startedTs && (
                        <span title={fullWhen(startedTs)} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Clock size={12} /> Mulai {shortWhen(startedTs)}
                        </span>
                      )}
                      <span className="convlog-counts">
                        <span style={{ color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                          <ArrowDownLeft size={13} /> {row.incoming} masuk
                        </span>
                        <span style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '6px' }}>
                          <ArrowUpRight size={13} /> {row.outgoing} keluar
                        </span>
                      </span>
                      {row.responseMs !== null && row.responseMs !== undefined && (
                        <span title="Selisih antara pesan pertama pelanggan dan balasan pertama tim" style={{ color: 'var(--success)' }}>
                          ⚡ Dibalas dalam {shortDuration(row.responseMs)}
                        </span>
                      )}
                    </span>

                    {/* Agents who handled the conversation */}
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
                      Buka Chat <ChevronRight size={14} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination / Batch loading in Page variant */}
      {!isPanel && filteredAndSortedRows.length > displayCount && (
        <div style={{ textAlign: 'center', padding: '20px 0 10px 0', borderTop: '1px solid var(--border-color)', marginTop: '12px' }}>
          <button
            type="button"
            className="convlog-loadmore-btn"
            onClick={() => setDisplayCount(prev => prev + 30)}
          >
            Tampilkan Lebih Banyak ({visible.length} dari {filteredAndSortedRows.length})
          </button>
        </div>
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

        {totals && totals.awaitingReply > 0 && (
          <div className="convlog-alert">
            <Info size={14} />
            <span><strong>{totals.awaitingReply}</strong> pelanggan menunggu balasan pertama</span>
          </div>
        )}

        <div className="convlog-scroll">{list}</div>

        {onSeeAll && allRows.length > visible.length && (
          <button type="button" className="convlog-seeall" onClick={onSeeAll}>
            Lihat semua {allRows.length} percakapan <ChevronRight size={13} />
          </button>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // page variant: the full view
  // ---------------------------------------------------------------------------
  return (
    <div className="view-container" style={{ gap: '20px' }}>
      {/* Top Banner Header */}
      <div className="convlog-header glass" style={{ padding: '24px', borderRadius: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: '12px',
            background: 'var(--primary-soft)', border: '1px solid var(--primary-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)',
            flexShrink: 0,
          }}>
            <MessageSquare size={26} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: '1.4rem', fontWeight: '700', margin: 0 }}>Riwayat Percakapan</h2>
              {totals && (
                <span style={{ fontSize: '0.8rem', fontWeight: '700', padding: '2px 10px', borderRadius: '12px', background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
                  {totals.customers} Total Kontak
                </span>
              )}
            </div>
            <p style={{ margin: '6px 0 0 0', color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '680px', lineHeight: '1.5' }}>
              Pantau seluruh aktivitas percakapan pelanggan secara terpusat, respon agen tim, serta identifikasi pesan pelanggan yang belum terbalas.
            </p>
          </div>
        </div>

        <button onClick={load} disabled={loading} className="convlog-refresh" title="Muat ulang data">
          <RefreshCw size={15} className={loading ? 'spin-icon' : ''} /> Segarkan
        </button>
      </div>

      {/* Modern Interactive Stat Cards Grid */}
      {totals && (
        <div className="convlog-summary">
          {/* 1. Total Pelanggan */}
          <button
            type="button"
            className={`convlog-stat ${filter === 'all' && !searchQuery ? 'is-active' : ''}`}
            onClick={() => { setFilter('all'); setSearchQuery(''); }}
          >
            <div className="convlog-stat-icon-wrapper" style={{ color: 'var(--primary)', background: 'var(--primary-soft)', borderColor: 'var(--primary-border)' }}>
              <Users size={20} />
            </div>
            <div className="convlog-stat-content">
              <span className="convlog-stat-value">{totals.customers.toLocaleString()}</span>
              <span className="convlog-stat-label">Total Pelanggan</span>
            </div>
          </button>

          {/* 2. Dimulai Pelanggan */}
          <button
            type="button"
            className={`convlog-stat ${filter === 'customer' ? 'is-active' : ''}`}
            onClick={() => { setFilter('customer'); }}
          >
            <div className="convlog-stat-icon-wrapper" style={{ color: 'var(--success)', background: 'var(--success-soft)', borderColor: 'var(--success-border)' }}>
              <MessageCircle size={20} />
            </div>
            <div className="convlog-stat-content">
              <span className="convlog-stat-value" style={{ color: 'var(--success)' }}>
                {totals.customerInitiated.toLocaleString()}
              </span>
              <span className="convlog-stat-label">Dimulai Pelanggan</span>
            </div>
          </button>

          {/* 3. Belum Dibalas */}
          <button
            type="button"
            className={`convlog-stat ${totals.awaitingReply > 0 ? 'is-awaiting' : ''} ${filter === 'awaiting' ? 'is-active' : ''}`}
            onClick={() => { setFilter('awaiting'); }}
          >
            <div className="convlog-stat-icon-wrapper" style={{ color: totals.awaitingReply > 0 ? 'var(--warning)' : 'var(--text-dimmed)', background: totals.awaitingReply > 0 ? 'var(--warning-soft)' : 'rgba(255,255,255,0.04)', borderColor: totals.awaitingReply > 0 ? 'var(--warning-border)' : 'var(--border-color)' }}>
              <Clock size={20} />
            </div>
            <div className="convlog-stat-content">
              <span className="convlog-stat-value" style={{ color: totals.awaitingReply > 0 ? 'var(--warning)' : 'inherit' }}>
                {totals.awaitingReply.toLocaleString()}
              </span>
              <span className="convlog-stat-label">Belum Dibalas</span>
            </div>
          </button>

          {/* 4. Pesan Masuk */}
          <div className="convlog-stat">
            <div className="convlog-stat-icon-wrapper" style={{ color: '#06b6d4', background: 'rgba(6, 182, 212, 0.12)', borderColor: 'rgba(6, 182, 212, 0.25)' }}>
              <ArrowDownLeft size={20} />
            </div>
            <div className="convlog-stat-content">
              <span className="convlog-stat-value">{totals.incoming.toLocaleString()}</span>
              <span className="convlog-stat-label">Pesan Masuk</span>
            </div>
          </div>

          {/* 5. Pesan Keluar */}
          <div className="convlog-stat">
            <div className="convlog-stat-icon-wrapper" style={{ color: '#a855f7', background: 'rgba(168, 85, 247, 0.12)', borderColor: 'rgba(168, 85, 247, 0.25)' }}>
              <ArrowUpRight size={20} />
            </div>
            <div className="convlog-stat-content">
              <span className="convlog-stat-value">{totals.outgoing.toLocaleString()}</span>
              <span className="convlog-stat-label">Pesan Keluar</span>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Card Container */}
      <div className="convlog-card glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {/* Controls Toolbar: Search + Filter Pills + Sort Dropdown */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
          {/* Filter Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {FILTERS.map(({ key, label, icon: Icon }) => {
              const isActive = filter === key;
              const count = key === 'all' ? (totals?.customers ?? 0)
                : key === 'customer' ? (totals?.customerInitiated ?? 0)
                : (totals?.awaitingReply ?? 0);

              return (
                <button
                  key={key}
                  type="button"
                  className={`chat-pill ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => setFilter(key)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', fontSize: '0.85rem' }}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                  <span className="chat-pill-count">{count.toLocaleString()}</span>
                </button>
              );
            })}
          </div>

          {/* Right Toolbar: Search & Sort */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {/* Search Input */}
            <div className="search-input-wrapper" style={{ width: '260px' }}>
              <Search className="search-icon" size={15} />
              <input
                type="text"
                placeholder="Cari nama, nomor, agen..."
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', color: 'var(--text-dimmed)',
                    cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center',
                  }}
                  title="Hapus pencarian"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Sort Dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <ArrowUpDown size={14} style={{ color: 'var(--text-muted)' }} />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Urutkan percakapan"
                style={{
                  background: 'var(--bg-main)', color: 'var(--text-main)',
                  border: '1px solid var(--border-color)', padding: '7px 12px',
                  borderRadius: '8px', fontSize: '0.84rem', outline: 'none', cursor: 'pointer',
                  fontWeight: '600',
                }}
              >
                <option value="recent">Terbaru</option>
                <option value="messages">Paling Banyak Pesan</option>
                <option value="waiting">Paling Lama Menunggu</option>
              </select>
            </div>
          </div>
        </div>

        {/* Counter Info Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          <span>
            Menampilkan <strong>{visible.length}</strong> dari <strong>{filteredAndSortedRows.length}</strong> percakapan
            {searchQuery && <span> untuk pencarian "<em>{searchQuery}</em>"</span>}
          </span>
          {totals && totals.awaitingReply > 0 && filter !== 'awaiting' && (
            <button
              type="button"
              onClick={() => setFilter('awaiting')}
              style={{
                background: 'var(--warning-soft)', border: '1px solid var(--warning-border)',
                color: 'var(--warning)', padding: '3px 8px', borderRadius: '6px',
                fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
              }}
            >
              <Clock size={12} /> {totals.awaitingReply} pesan perlu respon
            </button>
          )}
        </div>

        {/* Conversation List */}
        <div className="view-content convlog-content" style={{ margin: 0, padding: 0 }}>
          {list}

          {/* Unattributed messages note */}
          {totals && totals.unattributedOutgoing > 0 && (
            <div className="convlog-note" style={{ marginTop: '14px' }}>
              <Info size={15} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>
                {totals.unattributedOutgoing.toLocaleString()} pesan terkirim tidak terlacak ke agen spesifik —
                dikirim dari HP langsung, oleh bot/webhook, atau sebelum pencatatan agen aktif.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
