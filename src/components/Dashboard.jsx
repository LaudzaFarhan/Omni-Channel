import React, { useMemo } from 'react';
import { Send, MessageCircle, Users, Phone, TrendingUp, Clock, MessageSquare } from 'lucide-react';
import { getChatDisplayName, getInitials } from '../utils/displayName.js';

export default function Dashboard({ chats, userProfile, userInfo, waSessions, messages, savedNames = {} }) {
  // Calculate stats from real data
  const totalContacts = Array.isArray(chats) ? chats.length : 0;
  const activeNumbers = Array.isArray(waSessions) 
    ? waSessions.filter(s => s.status === 'connected').length 
    : 0;
  const messagesSent = userProfile?.messagesSent || 0;
  
  // Count incoming messages from chats' unread counts
  const incomingMessages = Array.isArray(chats) 
    ? chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0) 
    : 0;

  // Get recent chats sorted by lastMessageTimestamp (already in ms)
  const recentChats = useMemo(() => {
    if (!Array.isArray(chats)) return [];
    return [...chats]
      .filter(c => c.lastMessageTimestamp)
      .sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
      .slice(0, 6);
  }, [chats]);

  // Build activity chart from real chat timestamps (last 7 days)
  const activityData = useMemo(() => {
    if (!Array.isArray(chats)) return [];
    
    const now = new Date();
    const dayLabels = [];
    const dayCounts = [];
    
    // Build last 7 days
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayLabels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
      
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const dayEnd = dayStart + 86400000;
      
      // Count chats that had their last message on this day
      const count = chats.filter(c => {
        const ts = c.lastMessageTimestamp;
        return ts && ts >= dayStart && ts < dayEnd;
      }).length;
      
      dayCounts.push(count);
    }
    
    return dayLabels.map((label, i) => ({ label, count: dayCounts[i] }));
  }, [chats]);

  const maxCount = Math.max(1, ...activityData.map(d => d.count));
  const maxBarHeight = 120;
  const hasActivity = activityData.some(d => d.count > 0);

  // Format timestamp (already in ms) to relative time
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    if (date.toDateString() === new Date(now - 86400000).toDateString()) return 'Yesterday';
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Naming/initials come from the shared helper so every view agrees. A saved
  // contact name beats the pushName WhatsApp reports.
  const getDisplayName = (chat) => getChatDisplayName(chat, userInfo, savedNames[chat.id]);

  // Stable avatar color per chat ID
  const getAvatarColor = (jid) => {
    const colors = [
      '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
      '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1'
    ];
    let hash = 0;
    for (let i = 0; i < (jid || '').length; i++) {
      hash = jid.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const stats = [
    {
      label: 'Pesan Terkirim',
      value: messagesSent,
      icon: Send,
      gradient: 'linear-gradient(135deg, #f8fafc, #e2e8f0)',
      iconBg: 'rgba(100, 116, 139, 0.08)',
      iconColor: '#64748b',
      textColor: '#334155',
      valueColor: '#1e293b',
      bgIconColor: 'rgba(100, 116, 139, 0.06)',
    },
    {
      label: 'Pesan Masuk',
      value: incomingMessages,
      icon: MessageCircle,
      gradient: 'linear-gradient(135deg, #10b981, #059669)',
      iconBg: 'rgba(255,255,255,0.25)',
      iconColor: '#ffffff',
      textColor: 'rgba(255,255,255,0.9)',
      valueColor: '#ffffff',
      bgIconColor: 'rgba(255,255,255,0.1)',
    },
    {
      label: 'Total Kontak',
      value: totalContacts,
      icon: Users,
      gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
      iconBg: 'rgba(255,255,255,0.25)',
      iconColor: '#ffffff',
      textColor: 'rgba(255,255,255,0.9)',
      valueColor: '#ffffff',
      bgIconColor: 'rgba(255,255,255,0.1)',
    },
    {
      label: 'Nomor Aktif',
      value: activeNumbers,
      icon: Phone,
      gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
      iconBg: 'rgba(255,255,255,0.25)',
      iconColor: '#ffffff',
      textColor: 'rgba(255,255,255,0.9)',
      valueColor: '#ffffff',
      bgIconColor: 'rgba(255,255,255,0.1)',
    },
  ];

  return (
    <div className="dashboard-view">
      {/* Stats Cards Row */}
      <div className="dashboard-stats-row">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div 
              key={i} 
              className="dashboard-stat-card"
              style={{ background: stat.gradient }}
            >
              <div className="stat-card-header">
                <div className="stat-card-icon" style={{ background: stat.iconBg }}>
                  <Icon size={18} style={{ color: stat.iconColor }} />
                </div>
                <span className="stat-card-label" style={{ color: stat.textColor }}>{stat.label}</span>
              </div>
              <div className="stat-card-value" style={{ color: stat.valueColor }}>
                {stat.value.toLocaleString()}
              </div>
              <div className="stat-card-bg-icon" style={{ color: stat.bgIconColor }}>
                <Icon size={80} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Section */}
      <div className="dashboard-bottom-row">
        {/* Activity Chart */}
        <div className="dashboard-panel">
          <div className="dashboard-panel-header">
            <TrendingUp size={18} />
            <span>Aktivitas Pengiriman</span>
          </div>
          <div className="dashboard-panel-body">
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
                        title={`${day.label}: ${day.count} messages`}
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
                <p>Grafik aktivitas akan muncul setelah Anda mengirim pesan</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Messages */}
        <div className="dashboard-panel">
          <div className="dashboard-panel-header">
            <Clock size={18} />
            <span>Pesan Terbaru</span>
          </div>
          <div className="dashboard-panel-body">
            {recentChats.length > 0 ? (
              <div className="recent-messages-list">
                {recentChats.map((chat, i) => {
                  const displayName = getDisplayName(chat);
                  return (
                    <div key={chat.id || i} className="recent-message-item">
                      <div 
                        className="recent-msg-avatar"
                        style={{ background: getAvatarColor(chat.id) }}
                      >
                        {getInitials(displayName)}
                      </div>
                      <div className="recent-msg-content">
                        <div className="recent-msg-top">
                          <span className="recent-msg-name">{displayName}</span>
                          <span className="recent-msg-time">{formatTime(chat.lastMessageTimestamp)}</span>
                        </div>
                        <p className="recent-msg-text">{chat.lastMessage || 'No messages yet'}</p>
                      </div>
                      {chat.unreadCount > 0 && (
                        <div className="recent-msg-badge">{chat.unreadCount}</div>
                      )}
                    </div>
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
    </div>
  );
}
