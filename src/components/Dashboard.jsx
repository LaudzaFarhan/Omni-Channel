import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Send, MailOpen, Users, Phone, BookUser, Clock3, TrendingUp, Clock, MessageSquare, X, Search, ArrowRight, CheckCheck,
} from 'lucide-react';
import {
  getChatDisplayName, getInitials, avatarColor, isSelfChat,
} from '../utils/displayName.js';
import { relativeWhen, fullWhen } from '../utils/timeFormat.js';
import { fetchChatStatuses, fetchTeam } from '../utils/api.js';
import { subscribeSocket } from '../utils/socket.js';
import { isReleased, isVisible } from '../utils/features.js';
import { jidToPhone, formatPhone } from '../utils/phone.js';
import InteractionHeatmap from './dashboard/InteractionHeatmap.jsx';
import CustomerList from './dashboard/CustomerList.jsx';
import ConversationLog from './dashboard/ConversationLog.jsx';
import PipelinePanel from './dashboard/PipelinePanel.jsx';
import FeatureGrid from './dashboard/FeatureGrid.jsx';

const DAY_MS = 86400000;

/**
 * The home page.
 *
 * It used to show four counters, a heatmap and two charts, which left most of the product
 * undiscoverable from here — team oversight, the pipeline, contacts, quota and the
 * conversation history were all sidebar-only. Every feature area is now represented, and
 * the counters say what they actually count: two of them used to be labelled as things
 * they were not ("Pesan Masuk" was the unread total, "Total Kontak" was the chat count,
 * which includes groups and is unrelated to the saved address book).
 *
 * Supervisor-only panels are gated here as well as in the sidebar, because the endpoints
 * behind them are supervisor-gated on the server: rendering them for an invited member
 * would just show a 403.
 */
export default function Dashboard({
  chats, userProfile, userInfo, waSessions, savedNames = {},
  activeSessionId = 'default', connectionStatus, onOpenChat,
  // Saved address book size, notification state and navigation, so the page can report
  // on features it does not itself own.
  contactCount = 0, notifications = [], isSupervisor = true, onNavigate,
  // Effective feature map for this account. Panels an admin has hidden are not rendered,
  // and their data is not fetched.
  features = {},
}) {
  // Which heatmap cell is drilled into, and the conversations behind it. Held here rather
  // than in either panel because it is produced by one and consumed by the other.
  const [cellSelection, setCellSelection] = useState(null);

  // Commercial state per chat JID, for the pipeline panel. Absent means 'prospect'.
  const [chatStatuses, setChatStatuses] = useState({});

  // Seat usage, for the Team card. Null until the request lands, so the card can say
  // "—" instead of showing a zero that reads as "no agents".
  const [seats, setSeats] = useState(null);

  // Totals reported by the conversation log, reused by the feature grid so the two do not
  // make the same request twice.
  const [logTotals, setLogTotals] = useState(null);

  // Unread conversations modal state
  const [showUnreadModal, setShowUnreadModal] = useState(false);
  const [unreadSearchQuery, setUnreadSearchQuery] = useState('');

  const chatList = Array.isArray(chats) ? chats : [];

  // Which panels this account gets. The conversation log is supervisor-only on top of its
  // flag, because its endpoint is.
  const showHeatmap = isVisible(features, 'heatmap');
  const showPipeline = isVisible(features, 'pipeline');
  const showLog = isSupervisor && isReleased(features, 'activity');

  // ---------------------------------------------------------------------------
  // pipeline statuses: same source and same live updates as the chat list
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Nothing consumes the statuses when the pipeline is hidden, so do not ask for them.
    if (!showPipeline) return;

    let cancelled = false;

    const load = async () => {
      try {
        const list = await fetchChatStatuses(activeSessionId);
        if (cancelled) return;
        const map = {};
        list.forEach(({ chatJid, status }) => { map[chatJid] = status; });
        setChatStatuses(map);
      } catch (err) {
        // Degrades to "everything is a prospect", which is the default anyway, so a
        // missing status map must not take the dashboard down.
        console.info('[Dashboard] Could not load chat statuses:', err.message);
      }
    };
    load();

    const handleStatus = (settings) => {
      if (!settings?.chatJid) return;
      setChatStatuses(prev => ({ ...prev, [settings.chatJid]: settings.status }));
    };

    let attached = null;
    const unsubscribe = subscribeSocket((socket) => {
      if (attached) attached.off('chat-status-updated', handleStatus);
      attached = null;
      if (socket) {
        socket.on('chat-status-updated', handleStatus);
        attached = socket;
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (attached) attached.off('chat-status-updated', handleStatus);
    };
  }, [activeSessionId, showPipeline]);

  // ---------------------------------------------------------------------------
  // seats: supervisor-only, because /api/team is
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isSupervisor) {
      setSeats(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTeam();
        if (!cancelled) setSeats(data?.seats || null);
      } catch (err) {
        console.info('[Dashboard] Could not load team seats:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [isSupervisor]);

  // ---------------------------------------------------------------------------
  // derived counters
  // ---------------------------------------------------------------------------
  const messagesSent = userProfile?.messagesSent || 0;
  const messageLimit = userProfile?.messageLimit || 0;
  const sessionLimit = userProfile?.sessionLimit || 0;
  const unlimitedAgents = Boolean(userProfile?.unlimitedAgents);

  const activeNumbers = Array.isArray(waSessions)
    ? waSessions.filter(s => s.status === 'connected').length
    : 0;

  // Unread calculations:
  // 1. unreadConversations: List of customer chats where unreadCount > 0
  // 2. unreadMessagesTotal: Total number of unread messages across all chats
  // 3. unreadChatsCount: Number of distinct chats with unread messages
  const unreadConversations = useMemo(
    () => chatList
      .filter(c => (c.unreadCount || 0) > 0 && !isSelfChat(c, userInfo))
      .sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0)),
    [chatList, userInfo]
  );
  const unreadMessagesTotal = useMemo(
    () => unreadConversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    [unreadConversations]
  );
  const unreadChatsCount = unreadConversations.length;

  const filteredUnreadList = useMemo(() => {
    const q = unreadSearchQuery.trim().toLowerCase();
    if (!q) return unreadConversations;
    return unreadConversations.filter(chat => {
      const name = (getChatDisplayName(chat, userInfo, savedNames[chat.id]) || '').toLowerCase();
      const phone = (jidToPhone(chat.phoneNumber) || jidToPhone(chat.id) || '').toLowerCase();
      const lastMsg = (chat.lastMessage || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
    });
  }, [unreadConversations, unreadSearchQuery, userInfo, savedNames]);

  // Conversations with actual customers: the same exclusions the customer list applies, so
  // the card and the panel beside it cannot report different numbers. A group is not a
  // customer and the self-chat is not a conversation.
  const customerConversations = useMemo(
    () => chatList.filter(c => c?.id && !c.id.endsWith('@g.us') && !isSelfChat(c, userInfo)).length,
    [chatList, userInfo]
  );

  const unreadNotifications = notifications.filter(n => !n.read).length;

  // Six most recently active conversations.
  const recentChats = useMemo(() => (
    [...chatList]
      .filter(c => c.lastMessageTimestamp)
      .sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
      .slice(0, 6)
  ), [chatList]);

  // Conversations active on each of the last 7 days, from each chat's most recent message.
  const activityData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));

      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayEnd = dayStart + DAY_MS;

      return {
        label: d.toLocaleDateString('id-ID', { weekday: 'short' }),
        count: chatList.filter((c) => {
          const ts = c.lastMessageTimestamp;
          return ts && ts >= dayStart && ts < dayEnd;
        }).length,
      };
    });
  }, [chatList]);

  const maxCount = Math.max(1, ...activityData.map(d => d.count));
  const maxBarHeight = 120;
  const hasActivity = activityData.some(d => d.count > 0);

  const getDisplayName = (chat) => getChatDisplayName(chat, userInfo, savedNames[chat.id]);

  const handleTotals = useCallback((totals) => setLogTotals(totals), []);

  // ---------------------------------------------------------------------------
  // stat cards
  // ---------------------------------------------------------------------------
  // `tone` selects a gradient and its foreground together, so a card can never end up
  // with dark text on a dark fill.
  const TONES = {
    neutral: {
      gradient: 'linear-gradient(135deg, #f8fafc, #e2e8f0)',
      iconBg: 'rgba(100, 116, 139, 0.08)', iconColor: '#64748b',
      textColor: '#334155', valueColor: '#1e293b', bgIconColor: 'rgba(100, 116, 139, 0.06)',
    },
    // Follows the theme rather than a literal, so the brand card tracks light/dark.
    brand: {
      gradient: 'var(--brand-gradient)',
      iconBg: 'rgba(255,255,255,0.25)', iconColor: '#ffffff',
      textColor: 'rgba(255,255,255,0.9)', valueColor: '#ffffff', bgIconColor: 'rgba(255,255,255,0.1)',
    },
    violet: {
      gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
      iconBg: 'rgba(255,255,255,0.25)', iconColor: '#ffffff',
      textColor: 'rgba(255,255,255,0.9)', valueColor: '#ffffff', bgIconColor: 'rgba(255,255,255,0.1)',
    },
    cyan: {
      gradient: 'linear-gradient(135deg, #0891b2, #0e7490)',
      iconBg: 'rgba(255,255,255,0.25)', iconColor: '#ffffff',
      textColor: 'rgba(255,255,255,0.9)', valueColor: '#ffffff', bgIconColor: 'rgba(255,255,255,0.1)',
    },
    amber: {
      gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
      iconBg: 'rgba(255,255,255,0.25)', iconColor: '#ffffff',
      textColor: 'rgba(255,255,255,0.9)', valueColor: '#ffffff', bgIconColor: 'rgba(255,255,255,0.1)',
    },
    alert: {
      gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)',
      iconBg: 'rgba(255,255,255,0.25)', iconColor: '#ffffff',
      textColor: 'rgba(255,255,255,0.9)', valueColor: '#ffffff', bgIconColor: 'rgba(255,255,255,0.1)',
    },
  };

  const stats = [
    {
      label: 'Pesan Terkirim',
      value: messagesSent,
      sub: messageLimit > 0 ? `dari kuota ${messageLimit.toLocaleString('id-ID')}` : null,
      icon: Send,
      tone: 'neutral',
    },
    {
      label: 'Belum Dibaca',
      value: unreadMessagesTotal,
      sub: unreadChatsCount > 0 ? `${unreadChatsCount} percakapan menunggu dibuka` : 'kotak masuk bersih',
      icon: MailOpen,
      tone: 'brand',
      clickable: true,
      onClick: () => setShowUnreadModal(true),
    },
    {
      label: 'Percakapan Pelanggan',
      value: customerConversations,
      sub: 'tanpa grup',
      icon: Users,
      tone: 'violet',
      clickable: true,
      onClick: () => onNavigate?.('messages'),
    },
    {
      label: 'Kontak Tersimpan',
      value: contactCount,
      sub: 'di buku alamat',
      icon: BookUser,
      tone: 'cyan',
      clickable: true,
      onClick: () => onNavigate?.('contacts'),
    },
    {
      label: 'Nomor Aktif',
      value: activeNumbers,
      sub: unlimitedAgents
        ? 'perangkat tanpa batas'
        : sessionLimit > 0 ? `dari ${sessionLimit} perangkat` : null,
      icon: Phone,
      tone: 'amber',
    },
  ];

  // Supervisor-only, and only from the log's own data — so it appears once that request
  // has landed rather than flashing a zero first.
  if (isSupervisor && logTotals) {
    stats.push({
      label: 'Menunggu Balasan',
      value: logTotals.awaitingReply,
      sub: logTotals.awaitingReply > 0 ? 'belum dijawab tim' : 'semua sudah dibalas',
      icon: Clock3,
      tone: logTotals.awaitingReply > 0 ? 'alert' : 'neutral',
    });
  }

  return (
    <div className="dashboard-view">
      {/* Stats Cards Row */}
      <div className="dashboard-stats-row">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const tone = TONES[stat.tone] || TONES.neutral;
          const isClickable = Boolean(stat.clickable || stat.onClick);
          return (
            <div
              key={stat.label}
              className={`dashboard-stat-card ${isClickable ? 'is-clickable' : ''}`}
              style={{
                background: tone.gradient,
                cursor: isClickable ? 'pointer' : 'default',
              }}
              onClick={stat.onClick}
              title={isClickable ? `Klik untuk melihat detail ${stat.label}` : undefined}
            >
              <div className="stat-card-header">
                <div className="stat-card-icon" style={{ background: tone.iconBg }}>
                  <Icon size={18} style={{ color: tone.iconColor }} />
                </div>
                <span className="stat-card-label" style={{ color: tone.textColor }}>{stat.label}</span>
              </div>
              <div className="stat-card-value" style={{ color: tone.valueColor }}>
                {typeof stat.value === 'number' ? stat.value.toLocaleString('id-ID') : stat.value}
              </div>
              {stat.sub && (
                <div className="stat-card-sub" style={{ color: tone.textColor }}>{stat.sub}</div>
              )}
              <div className="stat-card-bg-icon" style={{ color: tone.bgIconColor }}>
                <Icon size={80} />
              </div>
            </div>
          );
        })}
      </div>

      {/* "When are we busy" beside "who was that". The heatmap needs the room for 24
          hourly columns, so the customer list gets a fixed narrow column and the
          heatmap takes the rest; below ~1100px they stack. The list's height is
          driven entirely by the heatmap (see .customer-panel-cell) so the two panels
          always line up however many customers there are. */}
      {/* With the heat map hidden the customer list takes the whole row rather than leaving
          a gap where the grid was. It is the panel that still works without the other. */}
      <div className={`dashboard-insight-row ${showHeatmap ? '' : 'is-single'}`}>
        {showHeatmap && (
          <InteractionHeatmap
            activeSessionId={activeSessionId}
            connected={connectionStatus === 'connected'}
            onCellSelect={setCellSelection}
          />
        )}

        <div className="customer-panel-cell">
          <CustomerList
            chats={chatList}
            userInfo={userInfo}
            savedNames={savedNames}
            onOpenChat={onOpenChat}
            cellSelection={cellSelection}
            onClearCellSelection={() => setCellSelection(null)}
          />
        </div>
      </div>

      {/* The team's conversation history beside where those conversations stand
          commercially. Members get the pipeline alone: the log's endpoint is
          supervisor-only. */}
      {(showLog || showPipeline) && (
        <div className={`dashboard-log-row ${showLog && showPipeline ? '' : 'is-single'}`}>
          {showLog && (
            <ConversationLog
              variant="panel"
              activeSessionId={activeSessionId}
              chats={chatList}
              userInfo={userInfo}
              savedNames={savedNames}
              onOpenChat={onOpenChat}
              onTotals={handleTotals}
              onSeeAll={() => onNavigate?.('activity')}
            />
          )}

          {showPipeline && (
            <PipelinePanel
              chats={chatList}
              chatStatuses={chatStatuses}
              onOpenInbox={() => onNavigate?.('messages')}
            />
          )}
        </div>
      )}

      {/* Bottom Section */}
      <div className="dashboard-bottom-row">
        {/* Activity Chart */}
        <div className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div className="dashboard-panel-header-left">
              <div className="panel-header-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
                <TrendingUp size={16} />
              </div>
              <span>Percakapan Aktif per Hari</span>
            </div>
          </div>
          <div className="dashboard-panel-body" style={{ alignItems: 'flex-end', padding: '16px 20px 12px' }}>
            {hasActivity ? (
              <div className="activity-chart">
                {activityData.map((day, i) => {
                  const height = Math.max(8, (day.count / maxCount) * maxBarHeight);
                  return (
                    <div key={i} className="chart-bar-wrapper">
                      <span className="chart-bar-count">{day.count}</span>
                      <div
                        className="chart-bar"
                        style={{ height: `${height}px` }}
                        title={`${day.label}: ${day.count} percakapan`}
                      />
                      <span className="chart-bar-label">{day.label}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="dashboard-empty-state">
                <div className="dashboard-empty-icon">
                  <MessageSquare size={40} />
                </div>
                <p>Grafik akan muncul setelah ada percakapan dalam 7 hari terakhir</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Messages */}
        <div className="dashboard-panel">
          <div className="dashboard-panel-header">
            <div className="dashboard-panel-header-left">
              <div className="panel-header-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
                <Clock size={16} />
              </div>
              <span>Pesan Terbaru</span>
            </div>
          </div>
          <div className="dashboard-panel-body" style={{ padding: '8px 12px', overflowY: 'auto', display: 'block' }}>
            {recentChats.length > 0 ? (
              <div className="recent-messages-list">
                {recentChats.map((chat) => {
                  const displayName = getDisplayName(chat);
                  return (
                    // A button, not a styled div: the rows already looked clickable
                    // (cursor and hover) but did nothing, and the same row in the
                    // customer list opens the conversation.
                    <button
                      type="button"
                      key={chat.id}
                      className="recent-message-item"
                      onClick={() => onOpenChat?.(chat.id)}
                      title={`Buka riwayat chat ${displayName}`}
                    >
                      <span className="recent-msg-avatar" style={{ background: avatarColor(chat.id) }}>
                        {getInitials(displayName)}
                      </span>
                      <span className="recent-msg-content">
                        <span className="recent-msg-top">
                          <span className="recent-msg-name">{displayName}</span>
                          <span
                            className="recent-msg-time"
                            title={fullWhen(chat.lastMessageTimestamp)}
                          >
                            {relativeWhen(chat.lastMessageTimestamp)}
                          </span>
                        </span>
                        <span className="recent-msg-text">
                          {chat.lastMessageFromMe && <span className="customer-you">Anda: </span>}
                          {chat.lastMessage || 'Belum ada pesan'}
                        </span>
                      </span>
                      {chat.unreadCount > 0 && (
                        <span className="recent-msg-badge">{chat.unreadCount}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="dashboard-empty-state">
                <div className="dashboard-empty-icon">
                  <MessageSquare size={40} />
                </div>
                <p>Belum ada pesan masuk</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The index of everything else the product does, so no feature is sidebar-only. */}
      <FeatureGrid
        isSupervisor={isSupervisor}
        onNavigate={onNavigate}
        features={features}
        metrics={{
          unreadChats: unreadMessagesTotal,
          conversations: customerConversations,
          contacts: contactCount,
          awaitingReply: logTotals?.awaitingReply || 0,
          seatsUsed: seats?.used ?? null,
          seatsLimit: seats?.limit ?? null,
          unreadNotifications,
          planName: userProfile?.planName || null,
          messagesSent,
          messageLimit,
          unlimitedAgents,
        }}
      />

      {/* Unread Conversations Modal / Dialog */}
      {showUnreadModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
            padding: '20px',
            animation: 'fadeIn 0.2s ease',
          }}
          onClick={() => setShowUnreadModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '560px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: '16px',
              overflow: 'hidden',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-panel, var(--bg-sidebar))',
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.35)',
              animation: 'profileFadeScale 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '18px 22px',
                borderBottom: '1px solid var(--border-color)',
                background: 'var(--overlay-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: 'var(--primary-soft)',
                    color: 'var(--primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MailOpen size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-main)' }}>
                    Pesan Belum Dibaca
                  </h3>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)', marginTop: '2px' }}>
                    {unreadMessagesTotal} pesan baru di {unreadChatsCount} percakapan
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUnreadModal(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: '8px',
                  display: 'flex',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Search Input if more than 3 unread */}
            {unreadConversations.length > 3 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 18px',
                  borderBottom: '1px solid var(--border-color)',
                  background: 'var(--bg-main)',
                }}
              >
                <Search size={15} style={{ color: 'var(--text-dimmed)' }} />
                <input
                  type="text"
                  placeholder="Cari percakapan belum dibaca..."
                  value={unreadSearchQuery}
                  onChange={(e) => setUnreadSearchQuery(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--text-main)',
                    fontSize: '0.84rem',
                    outline: 'none',
                  }}
                />
                {unreadSearchQuery && (
                  <button
                    onClick={() => setUnreadSearchQuery('')}
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Unread Chats List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              {filteredUnreadList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dimmed)' }}>
                  <MailOpen size={36} style={{ color: 'var(--text-muted)', opacity: 0.4, marginBottom: '12px' }} />
                  <div style={{ fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-main)', marginBottom: '4px' }}>
                    {unreadSearchQuery ? 'Tidak ada percakapan yang cocok' : 'Kotak masuk bersih!'}
                  </div>
                  <div style={{ fontSize: '0.82rem' }}>
                    {unreadSearchQuery ? 'Coba cari dengan kata kunci lain.' : 'Semua pesan masuk telah dibuka dan dibaca.'}
                  </div>
                </div>
              ) : (
                filteredUnreadList.map((chat) => {
                  const name = getDisplayName(chat);
                  const phone = jidToPhone(chat.phoneNumber) || jidToPhone(chat.id);
                  const formattedPhone = phone ? formatPhone(phone) : null;
                  return (
                    <div
                      key={chat.id}
                      onClick={() => {
                        onOpenChat?.(chat.id);
                        setShowUnreadModal(false);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px 14px',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        transition: 'background 0.15s ease',
                        borderBottom: '1px solid var(--border-color)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--overlay-subtle)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {/* Avatar */}
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          borderRadius: '12px',
                          background: avatarColor(chat.id),
                          color: '#fff',
                          fontWeight: '800',
                          fontSize: '0.95rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {getInitials(name)}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                          <div style={{ fontWeight: '700', fontSize: '0.88rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)', flexShrink: 0 }}>
                            {chat.lastMessageTimestamp ? relativeWhen(chat.lastMessageTimestamp) : ''}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {chat.lastMessage || (formattedPhone ? formattedPhone : 'Pesan baru')}
                          </div>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '0.72rem',
                              fontWeight: '700',
                              background: 'var(--primary)',
                              color: 'var(--primary-contrast, #fff)',
                              flexShrink: 0,
                            }}
                          >
                            {chat.unreadCount} baru
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer Actions */}
            <div
              style={{
                padding: '12px 18px',
                borderTop: '1px solid var(--border-color)',
                background: 'var(--overlay-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <button
                type="button"
                onClick={() => setShowUnreadModal(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  color: 'var(--text-main)',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Tutup
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowUnreadModal(false);
                  onNavigate?.('messages');
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'var(--primary)',
                  color: 'var(--primary-contrast, #fff)',
                  fontSize: '0.82rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                <span>Buka di Chat Inbox</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
