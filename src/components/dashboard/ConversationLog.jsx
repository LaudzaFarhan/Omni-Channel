import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MessageSquare, RefreshCw, ChevronRight, Loader2, Info, Inbox, ArrowDownLeft, ArrowUpRight,
  Search, X, Users, UserCheck, MessageCircle, Clock, ArrowUpDown, Filter, AlertTriangle,
  Calendar, CalendarRange, CheckCircle2, User, Zap, TrendingUp, ChevronDown, UserX,
} from 'lucide-react';
import { fetchConversationLog } from '../../utils/api.js';
import { getChatDisplayName, getInitials, avatarColor, isSelfChat } from '../../utils/displayName.js';
import { shortWhen, fullWhen, shortDuration } from '../../utils/timeFormat.js';
import { subscribeSocket } from '../../utils/socket.js';

// Main Filter Tabs
const FILTERS = [
  { key: 'all', label: 'Semua Percakapan', icon: Users },
  { key: 'team', label: 'Dimulai Tim (Sales)', icon: UserCheck },
  { key: 'customer', label: 'Dimulai Pelanggan', icon: MessageCircle },
  { key: 'awaiting', label: 'Belum Dibalas', icon: Clock },
  { key: 'over24h', label: '> 24 Jam Inaktif', icon: AlertTriangle },
];

// Date range presets
const DATE_PRESETS = [
  { key: 'all', label: 'Semua Waktu' },
  { key: 'today', label: 'Hari Ini' },
  { key: 'yesterday', label: 'Kemarin' },
  { key: '7days', label: '7 Hari Terakhir' },
  { key: '30days', label: '30 Hari Terakhir' },
  { key: 'this_month', label: 'Bulan Ini' },
  { key: 'custom', label: 'Kustom Tanggal...' },
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
  
  // Page view mode: 'conversations' (list of chats) | 'agents' (sales team activity breakdown)
  const [activeTab, setActiveTab] = useState('conversations');

  // Filters
  const [filter, setFilter] = useState('all');
  const [selectedAgent, setSelectedAgent] = useState('all'); // 'all' | agent name/uid
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'messages' | 'waiting'
  const [displayCount, setDisplayCount] = useState(30);

  // Calendar / Date filter states
  const [datePreset, setDatePreset] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

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

  // Keep the log current without a manual refresh
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

  // Compute base conversation rows
  const allRows = useMemo(() => {
    const now = Date.now();
    return (data?.conversations || [])
      .filter(c => !c.isGroup)
      .map((c) => {
        const chat = chatById.get(c.jid)
          || { id: c.jid, name: c.name, phoneNumber: c.phoneNumber };
        const lastTime = c.lastTs ? new Date(c.lastTs).getTime() : 0;
        const isOver24h = lastTime > 0 && (now - lastTime > 24 * 60 * 60 * 1000);

        return {
          ...c,
          chat,
          label: getChatDisplayName(chat, userInfo, savedNames[c.jid]),
          awaiting: c.incoming > 0 && c.outgoing === 0,
          isOver24h,
        };
      })
      .filter(c => !isSelfChat(c.chat, userInfo));
  }, [data, chatById, userInfo, savedNames]);

  // Extract all distinct sales team members / agents seen in data
  const availableAgents = useMemo(() => {
    const map = new Map();
    (data?.agents || []).forEach(a => {
      if (a.name) map.set(a.name, a);
    });
    allRows.forEach(row => {
      (row.agents || []).forEach(a => {
        if (a.name && !map.has(a.name)) {
          map.set(a.name, a);
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => (b.count || 0) - (a.count || 0));
  }, [data, allRows]);

  // Helper: check if a timestamp matches the selected date range
  const matchesDateRange = useCallback((ts) => {
    if (!ts) return false;
    if (datePreset === 'all') return true;

    const date = new Date(ts);
    const now = new Date();

    if (datePreset === 'today') {
      return date.toDateString() === now.toDateString();
    }
    if (datePreset === 'yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      return date.toDateString() === yesterday.toDateString();
    }
    if (datePreset === '7days') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return date >= sevenDaysAgo;
    }
    if (datePreset === '30days') {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return date >= thirtyDaysAgo;
    }
    if (datePreset === 'this_month') {
      return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
    }
    if (datePreset === 'custom') {
      if (customStartDate) {
        const start = new Date(customStartDate);
        start.setHours(0, 0, 0, 0);
        if (date < start) return false;
      }
      if (customEndDate) {
        const end = new Date(customEndDate);
        end.setHours(23, 59, 59, 999);
        if (date > end) return false;
      }
      return true;
    }
    return true;
  }, [datePreset, customStartDate, customEndDate]);

  // Filter & Search & Sort Rows
  const filteredAndSortedRows = useMemo(() => {
    let result = allRows;

    // 1. Date Range Filter
    if (datePreset !== 'all') {
      result = result.filter(c => matchesDateRange(c.lastTs) || matchesDateRange(c.firstTs));
    }

    // 2. Sales User / Agent Filter
    if (selectedAgent !== 'all') {
      result = result.filter(c => {
        return (c.agents || []).some(a => a.name === selectedAgent || a.uid === selectedAgent);
      });
    }

    // 3. Category / Initiation Filter
    if (filter === 'customer') {
      result = result.filter(c => c.initiatedBy === 'customer');
    } else if (filter === 'team') {
      result = result.filter(c => c.initiatedBy === 'us');
    } else if (filter === 'awaiting') {
      result = result.filter(c => c.awaiting);
    } else if (filter === 'over24h') {
      result = result.filter(c => c.isOver24h);
    }

    // 4. Search query
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

    // 5. Sort
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
  }, [allRows, datePreset, matchesDateRange, selectedAgent, filter, searchQuery, sortBy]);

  // Agent Performance / Analytics within the active date range
  const agentPerformanceData = useMemo(() => {
    const dateFiltered = datePreset === 'all'
      ? allRows
      : allRows.filter(c => matchesDateRange(c.lastTs) || matchesDateRange(c.firstTs));

    const agentStats = new Map();

    availableAgents.forEach(a => {
      agentStats.set(a.name, {
        name: a.name,
        uid: a.uid,
        conversationsCount: 0,
        initiatedCount: 0,
        messagesSent: 0,
        responseTimes: [],
        lastActiveTs: null,
      });
    });

    dateFiltered.forEach(row => {
      (row.agents || []).forEach(ag => {
        if (!ag.name) return;
        let stat = agentStats.get(ag.name);
        if (!stat) {
          stat = {
            name: ag.name,
            uid: ag.uid,
            conversationsCount: 0,
            initiatedCount: 0,
            messagesSent: 0,
            responseTimes: [],
            lastActiveTs: null,
          };
          agentStats.set(ag.name, stat);
        }

        stat.conversationsCount++;
        stat.messagesSent += (ag.count || 0);
        if (ag.lastTs && (!stat.lastActiveTs || ag.lastTs > stat.lastActiveTs)) {
          stat.lastActiveTs = ag.lastTs;
        }

        if (row.initiatedBy === 'us' && row.agents[0]?.name === ag.name) {
          stat.initiatedCount++;
        }

        if (row.responseMs !== null && row.responseMs !== undefined) {
          stat.responseTimes.push(row.responseMs);
        }
      });
    });

    return Array.from(agentStats.values())
      .map(s => {
        const avgResp = s.responseTimes.length > 0
          ? s.responseTimes.reduce((a, b) => a + b, 0) / s.responseTimes.length
          : null;
        return { ...s, avgResponseMs: avgResp };
      })
      .sort((a, b) => b.messagesSent - a.messagesSent);
  }, [allRows, datePreset, matchesDateRange, availableAgents]);

  const visible = isPanel ? filteredAndSortedRows.slice(0, limit) : filteredAndSortedRows.slice(0, displayCount);
  const totals = data?.totals;

  // Hand the totals up after render
  useEffect(() => {
    if (totals) onTotals?.(totals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals]);

  const dateFilteredBaseRows = useMemo(() => {
    return datePreset === 'all'
      ? allRows
      : allRows.filter(c => matchesDateRange(c.lastTs) || matchesDateRange(c.firstTs));
  }, [allRows, datePreset, matchesDateRange]);

  const dateStats = useMemo(() => {
    const totalCust = dateFilteredBaseRows.length;
    const teamInit = dateFilteredBaseRows.filter(c => c.initiatedBy === 'us').length;
    const custInit = dateFilteredBaseRows.filter(c => c.initiatedBy === 'customer').length;
    const awaitingCount = dateFilteredBaseRows.filter(c => c.awaiting).length;
    const over24hCount = dateFilteredBaseRows.filter(c => c.isOver24h).length;
    const totalIncoming = dateFilteredBaseRows.reduce((sum, c) => sum + (c.incoming || 0), 0);
    const totalOutgoing = dateFilteredBaseRows.reduce((sum, c) => sum + (c.outgoing || 0), 0);

    return {
      totalCust,
      teamInit,
      custInit,
      awaitingCount,
      over24hCount,
      totalIncoming,
      totalOutgoing,
    };
  }, [dateFilteredBaseRows]);

  const emptyMessage = () => {
    if (searchQuery) return `Tidak ada percakapan yang cocok dengan "${searchQuery}".`;
    if (selectedAgent !== 'all') return `Tidak ada percakapan untuk agen "${selectedAgent}".`;
    if (filter === 'team') return 'Belum ada percakapan yang diinisiasi oleh tim / sales.';
    if (filter === 'over24h') return 'Tidak ada percakapan yang inaktif atau belum direspon lebih dari 24 jam.';
    if (filter === 'awaiting') return 'Semua pesan pelanggan sudah dibalas.';
    if (filter === 'customer') return 'Belum ada percakapan yang dimulai oleh pelanggan.';
    return 'Belum ada percakapan pelanggan yang tercatat untuk periode ini.';
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
          {(searchQuery || filter !== 'all' || selectedAgent !== 'all' || datePreset !== 'all') && (
            <button
              type="button"
              className="chat-pill active"
              onClick={() => { setSearchQuery(''); setFilter('all'); setSelectedAgent('all'); setDatePreset('all'); }}
              style={{ margin: '0 auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <X size={14} /> Reset Semua Filter
            </button>
          )}
        </div>
      )}

      {visible.length > 0 && (
        <ul className="convlog-list">
          {visible.map((row) => {
            const startedTs = row.firstCustomerTs || row.firstTs;
            let rawPhone = row.chat?.phoneNumber || (row.jid?.includes('@') ? row.jid.split('@')[0] : '');
            if (rawPhone.startsWith('+')) rawPhone = rawPhone.slice(1);
            const formattedPhone = rawPhone ? `+${rawPhone}` : '';

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

                      {formattedPhone && formattedPhone !== row.label && (
                        <span className="convlog-phone">
                          {formattedPhone}
                        </span>
                      )}

                      {row.awaiting && (
                        <span className="convlog-tag is-awaiting">
                          <span className="pulsing-dot" /> Belum dibalas
                        </span>
                      )}

                      {row.isOver24h && (
                        <span className="convlog-tag is-expired" title="Tidak ada respon atau pesan baru dalam 24 jam terakhir">
                          &gt; 24 Jam Inaktif
                        </span>
                      )}

                      {row.initiatedBy === 'customer' && (
                        <span className="convlog-tag is-customer">Pelanggan mulai</span>
                      )}
                      {row.initiatedBy === 'us' && (
                        <span className="convlog-tag is-team" style={{ borderColor: 'rgba(59, 130, 246, 0.35)', background: 'rgba(59, 130, 246, 0.12)', color: '#3b82f6' }}>
                          Tim Sales mulai
                        </span>
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
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAgent(agent.name);
                            }}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="panel-header-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
              <MessageSquare size={16} />
            </div>
            <span>Riwayat Percakapan Pelanggan</span>
          </div>
          {totals && (
            <span className="customer-count" title="Percakapan pelanggan yang tercatat">
              {totals.customers.toLocaleString()}
            </span>
          )}
        </div>

        {totals && totals.awaitingReply > 0 && (
          <div className="convlog-alert-banner">
            <div className="pulsing-dot" />
            <span><strong>{totals.awaitingReply}</strong> pelanggan menunggu balasan pertama</span>
          </div>
        )}

        <div className="convlog-scroll">{list}</div>

        {onSeeAll && (
          <button type="button" className="convlog-seeall" onClick={onSeeAll}>
            Lihat semua {allRows.length.toLocaleString()} percakapan <ChevronRight size={14} />
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
      {/* Top Banner Header with Date Range Filter */}
      <div className="convlog-header glass" style={{ padding: '24px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
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
                <h2 style={{ fontSize: '1.4rem', fontWeight: '700', margin: 0 }}>Riwayat & Log Tim Sales</h2>
                <span style={{ fontSize: '0.8rem', fontWeight: '700', padding: '2px 10px', borderRadius: '12px', background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
                  {dateStats.totalCust} Kontak ({datePreset === 'all' ? 'Semua Waktu' : DATE_PRESETS.find(p => p.key === datePreset)?.label})
                </span>
              </div>
              <p style={{ margin: '6px 0 0 0', color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '680px', lineHeight: '1.5' }}>
                Pantau seluruh inisiasi chat tim sales manual, riwayat balasan tiap user agen, performa waktu respon, serta filter tanggal kalender.
              </p>
            </div>
          </div>

          {/* Top Actions: Calendar Filter & Refresh */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            {/* Calendar / Date Preset Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '4px 10px' }}>
              <Calendar size={15} style={{ color: 'var(--primary)' }} />
              <select
                value={datePreset}
                onChange={(e) => {
                  const val = e.target.value;
                  setDatePreset(val);
                  if (val === 'custom') setShowDatePicker(true);
                  else setShowDatePicker(false);
                }}
                aria-label="Filter Kalender / Tanggal"
                style={{
                  background: 'transparent', border: 'none', color: 'var(--text-main)',
                  fontWeight: '600', fontSize: '0.85rem', outline: 'none', cursor: 'pointer',
                }}
              >
                {DATE_PRESETS.map(preset => (
                  <option key={preset.key} value={preset.key} style={{ background: 'var(--card-bg)', color: 'var(--text-main)' }}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <button onClick={load} disabled={loading} className="convlog-refresh" title="Muat ulang data">
              <RefreshCw size={15} className={loading ? 'spin-icon' : ''} /> Segarkan
            </button>
          </div>
        </div>

        {/* Custom Calendar Date Inputs Bar */}
        {(datePreset === 'custom' || showDatePicker) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '12px 16px', borderRadius: '10px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)' }}>
            <CalendarRange size={16} style={{ color: 'var(--primary)' }} />
            <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-main)' }}>Pilih Rentang Kalender:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>Dari:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => { setCustomStartDate(e.target.value); setDatePreset('custom'); }}
                style={{ background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.82rem' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>Sampai:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => { setCustomEndDate(e.target.value); setDatePreset('custom'); }}
                style={{ background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.82rem' }}
              />
            </div>
            {(customStartDate || customEndDate) && (
              <button
                type="button"
                onClick={() => { setCustomStartDate(''); setCustomEndDate(''); setDatePreset('all'); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-dimmed)', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <X size={13} /> Reset Tanggal
              </button>
            )}
          </div>
        )}

        {/* View Switcher Segmented Tabs */}
        <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
          <button
            type="button"
            className={`chat-pill ${activeTab === 'conversations' ? 'active' : ''}`}
            onClick={() => setActiveTab('conversations')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '0.88rem', fontWeight: '700' }}
          >
            <MessageSquare size={16} />
            <span>Riwayat Percakapan ({dateStats.totalCust})</span>
          </button>

          <button
            type="button"
            className={`chat-pill ${activeTab === 'agents' ? 'active' : ''}`}
            onClick={() => setActiveTab('agents')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '0.88rem', fontWeight: '700' }}
          >
            <Users size={16} />
            <span>Aktivitas & Performa Tim Sales ({availableAgents.length})</span>
          </button>
        </div>
      </div>

      {/* Modern Interactive Stat Cards Grid (Date Filtered) */}
      <div className="convlog-summary">
        {/* 1. Total Pelanggan */}
        <button
          type="button"
          className={`convlog-stat ${filter === 'all' && !searchQuery && selectedAgent === 'all' ? 'is-active' : ''}`}
          onClick={() => { setFilter('all'); setSearchQuery(''); setSelectedAgent('all'); setActiveTab('conversations'); }}
        >
          <div className="convlog-stat-icon-wrapper" style={{ color: 'var(--primary)', background: 'var(--primary-soft)', borderColor: 'var(--primary-border)' }}>
            <Users size={20} />
          </div>
          <div className="convlog-stat-content">
            <span className="convlog-stat-value">{dateStats.totalCust.toLocaleString()}</span>
            <span className="convlog-stat-label">Total Pelanggan</span>
          </div>
        </button>

        {/* 2. Dimulai Tim Sales */}
        <button
          type="button"
          className={`convlog-stat ${filter === 'team' ? 'is-active' : ''}`}
          onClick={() => { setFilter('team'); setActiveTab('conversations'); }}
        >
          <div className="convlog-stat-icon-wrapper" style={{ color: '#3b82f6', background: 'rgba(59, 130, 246, 0.12)', borderColor: 'rgba(59, 130, 246, 0.25)' }}>
            <UserCheck size={20} />
          </div>
          <div className="convlog-stat-content">
            <span className="convlog-stat-value" style={{ color: '#3b82f6' }}>
              {dateStats.teamInit.toLocaleString()}
            </span>
            <span className="convlog-stat-label">Dimulai Tim Sales</span>
          </div>
        </button>

        {/* 3. Dimulai Pelanggan */}
        <button
          type="button"
          className={`convlog-stat ${filter === 'customer' ? 'is-active' : ''}`}
          onClick={() => { setFilter('customer'); setActiveTab('conversations'); }}
        >
          <div className="convlog-stat-icon-wrapper" style={{ color: 'var(--success)', background: 'var(--success-soft)', borderColor: 'var(--success-border)' }}>
            <MessageCircle size={20} />
          </div>
          <div className="convlog-stat-content">
            <span className="convlog-stat-value" style={{ color: 'var(--success)' }}>
              {dateStats.custInit.toLocaleString()}
            </span>
            <span className="convlog-stat-label">Dimulai Pelanggan</span>
          </div>
        </button>

        {/* 4. Belum Dibalas */}
        <button
          type="button"
          className={`convlog-stat ${dateStats.awaitingCount > 0 ? 'is-awaiting' : ''} ${filter === 'awaiting' ? 'is-active' : ''}`}
          onClick={() => { setFilter('awaiting'); setActiveTab('conversations'); }}
        >
          <div className="convlog-stat-icon-wrapper" style={{ color: dateStats.awaitingCount > 0 ? 'var(--warning)' : 'var(--text-dimmed)', background: dateStats.awaitingCount > 0 ? 'var(--warning-soft)' : 'rgba(255,255,255,0.04)', borderColor: dateStats.awaitingCount > 0 ? 'var(--warning-border)' : 'var(--border-color)' }}>
            <Clock size={20} />
          </div>
          <div className="convlog-stat-content">
            <span className="convlog-stat-value" style={{ color: dateStats.awaitingCount > 0 ? 'var(--warning)' : 'inherit' }}>
              {dateStats.awaitingCount.toLocaleString()}
            </span>
            <span className="convlog-stat-label">Belum Dibalas</span>
          </div>
        </button>

        {/* 5. Inaktif > 24 Jam */}
        <button
          type="button"
          className={`convlog-stat ${dateStats.over24hCount > 0 ? 'is-expired-stat' : ''} ${filter === 'over24h' ? 'is-active' : ''}`}
          onClick={() => { setFilter('over24h'); setActiveTab('conversations'); }}
        >
          <div className="convlog-stat-icon-wrapper" style={{ color: dateStats.over24hCount > 0 ? '#ef4444' : 'var(--text-dimmed)', background: dateStats.over24hCount > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255,255,255,0.04)', borderColor: dateStats.over24hCount > 0 ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)' }}>
            <AlertTriangle size={20} />
          </div>
          <div className="convlog-stat-content">
            <span className="convlog-stat-value" style={{ color: dateStats.over24hCount > 0 ? '#ef4444' : 'inherit' }}>
              {dateStats.over24hCount.toLocaleString()}
            </span>
            <span className="convlog-stat-label">&gt; 24 Jam Inaktif</span>
          </div>
        </button>

        {/* 6. Pesan Keluar */}
        <div className="convlog-stat">
          <div className="convlog-stat-icon-wrapper" style={{ color: '#a855f7', background: 'rgba(168, 85, 247, 0.12)', borderColor: 'rgba(168, 85, 247, 0.25)' }}>
            <ArrowUpRight size={20} />
          </div>
          <div className="convlog-stat-content">
            <span className="convlog-stat-value">{dateStats.totalOutgoing.toLocaleString()}</span>
            <span className="convlog-stat-label">Pesan Keluar Tim</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'conversations' ? (
        /* TAB 1: CONVERSATIONS LIST */
        <div className="convlog-card glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Controls Toolbar: Search + Filter Pills + Agent Selector + Sort Dropdown */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
            {/* Filter Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {FILTERS.map(({ key, label, icon: Icon }) => {
                const isActive = filter === key;
                const count = key === 'all' ? dateStats.totalCust
                  : key === 'team' ? dateStats.teamInit
                  : key === 'customer' ? dateStats.custInit
                  : key === 'awaiting' ? dateStats.awaitingCount
                  : dateStats.over24hCount;

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

            {/* Right Toolbar: Agent Selector + Search + Sort */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Sales Agent Filter Dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <User size={14} style={{ color: 'var(--text-muted)' }} />
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  aria-label="Filter berdasarkan Agen Sales"
                  style={{
                    background: 'var(--bg-main)', color: 'var(--text-main)',
                    border: '1px solid var(--border-color)', padding: '7px 12px',
                    borderRadius: '8px', fontSize: '0.84rem', outline: 'none', cursor: 'pointer',
                    fontWeight: '600',
                  }}
                >
                  <option value="all">Semua Agen Sales</option>
                  {availableAgents.map(ag => (
                    <option key={ag.name} value={ag.name}>
                      👤 {ag.name} ({ag.messages || ag.count || 0} pesan)
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Input */}
              <div className="search-input-wrapper" style={{ width: '220px' }}>
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

          {/* Active Filter Badges Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', color: 'var(--text-muted)', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span>
                Menampilkan <strong>{visible.length}</strong> dari <strong>{filteredAndSortedRows.length}</strong> percakapan
              </span>

              {selectedAgent !== 'all' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 8px', borderRadius: '6px', background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)', fontWeight: '600' }}>
                  👤 Agen: {selectedAgent}
                  <button type="button" onClick={() => setSelectedAgent('all')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}><X size={12} /></button>
                </span>
              )}

              {datePreset !== 'all' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '2px 8px', borderRadius: '6px', background: 'var(--overlay-medium)', color: 'var(--text-main)', border: '1px solid var(--border-color)', fontWeight: '600' }}>
                  📅 Rentang: {DATE_PRESETS.find(p => p.key === datePreset)?.label || `${customStartDate} s/d ${customEndDate}`}
                  <button type="button" onClick={() => setDatePreset('all')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}><X size={12} /></button>
                </span>
              )}
            </div>

            {dateStats.awaitingCount > 0 && filter !== 'awaiting' && (
              <button
                type="button"
                onClick={() => setFilter('awaiting')}
                style={{
                  background: 'var(--warning-soft)', border: '1px solid var(--warning-border)',
                  color: 'var(--warning)', padding: '3px 8px', borderRadius: '6px',
                  fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                }}
              >
                <Clock size={12} /> {dateStats.awaitingCount} pesan perlu respon
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
      ) : (
        /* TAB 2: AGENT & SALES TEAM PERFORMANCE BREAKDOWN */
        <div className="convlog-card glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '700', margin: 0 }}>Performa & Aktivitas Tim Sales</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Statistik chat yang ditangani, inisiasi pesan, jumlah balasan, dan rata-rata kecepatan respon per anggota tim ({datePreset === 'all' ? 'Semua Waktu' : DATE_PRESETS.find(p => p.key === datePreset)?.label}).
              </p>
            </div>
            <span style={{ fontSize: '0.82rem', fontWeight: '700', padding: '4px 12px', borderRadius: '8px', background: 'var(--primary-soft)', color: 'var(--primary)' }}>
              {agentPerformanceData.length} Anggota Tim Aktif
            </span>
          </div>

          {agentPerformanceData.length === 0 ? (
            <div className="dashboard-empty-state" style={{ padding: '40px 20px' }}>
              <Users size={36} style={{ color: 'var(--text-dimmed)' }} />
              <p style={{ color: 'var(--text-muted)' }}>Belum ada aktivitas tim yang tercatat untuk periode ini.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
              {agentPerformanceData.map((agent) => (
                <div
                  key={agent.name}
                  style={{
                    padding: '18px 20px', borderRadius: '14px', background: 'var(--overlay-subtle)',
                    border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '14px',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {/* Agent Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span className="convlog-avatar" style={{ background: avatarColor(agent.uid || agent.name), width: '42px', height: '42px', fontSize: '0.9rem' }}>
                        {getInitials(agent.name)}
                      </span>
                      <div>
                        <div style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--text-main)' }}>{agent.name}</div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-dimmed)' }}>
                          {agent.lastActiveTs ? `Aktif ${shortWhen(agent.lastActiveTs)}` : 'Belum aktif'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Agent Stats Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)', fontWeight: '600' }}>Chat Ditangani</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--primary)' }}>{agent.conversationsCount.toLocaleString()}</div>
                    </div>

                    <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)', fontWeight: '600' }}>Pesan Terkirim</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#a855f7' }}>{agent.messagesSent.toLocaleString()}</div>
                    </div>

                    <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)', fontWeight: '600' }}>Inisiasi Manual</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#3b82f6' }}>{agent.initiatedCount.toLocaleString()}</div>
                    </div>

                    <div style={{ padding: '8px 10px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)', fontWeight: '600' }}>Avg. Kecepatan Balas</div>
                      <div style={{ fontSize: '0.95rem', fontWeight: '800', color: 'var(--success)' }}>
                        {agent.avgResponseMs ? `⚡ ${shortDuration(agent.avgResponseMs)}` : '-'}
                      </div>
                    </div>
                  </div>

                  {/* Quick Action */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAgent(agent.name);
                      setActiveTab('conversations');
                    }}
                    style={{
                      width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--primary-border)',
                      background: 'var(--primary-soft)', color: 'var(--primary)', fontWeight: '700', fontSize: '0.82rem',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Lihat Riwayat Chat {agent.name} <ChevronRight size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
