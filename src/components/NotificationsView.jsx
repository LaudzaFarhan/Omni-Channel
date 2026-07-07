import React, { useState } from 'react';
import { Bell, Check, Trash2, ShieldAlert, CheckCircle, Info, MessageSquare, Clock } from 'lucide-react';

export default function NotificationsView({ notifications = [], setNotifications }) {
  const [filter, setFilter] = useState('all'); // 'all' or 'unread'

  const handleMarkAsRead = (id) => {
    setNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
  };

  const handleMarkAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to delete all notifications?')) {
      setNotifications([]);
    }
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  const filtered = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    return true;
  });

  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return <CheckCircle size={18} style={{ color: '#10b981' }} />;
      case 'warning':
      case 'error':
        return <ShieldAlert size={18} style={{ color: '#ef4444' }} />;
      case 'message':
        return <MessageSquare size={18} style={{ color: '#8b5cf6' }} />;
      default:
        return <Info size={18} style={{ color: '#3b82f6' }} />;
    }
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    try {
      const date = new Date(timeStr);
      return date.toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
    } catch (e) {
      return timeStr;
    }
  };

  return (
    <div className="tab-container" style={{ padding: '24px', flex: 1, overflowY: 'auto', backgroundColor: 'var(--bg-main)', color: 'var(--text-main)' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Header Title */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
              <Bell size={24} style={{ color: 'var(--primary)' }} />
              Notifications
            </h2>
            <p style={{ color: 'var(--text-dimmed)', fontSize: '0.88rem', marginTop: '4px', margin: 0 }}>
              View and manage system alerts and message logs
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            {notifications.length > 0 && (
              <>
                <button 
                  onClick={handleMarkAllRead} 
                  className="btn-secondary" 
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '8px 12px' }}
                >
                  <Check size={16} /> Mark all read
                </button>
                <button 
                  onClick={handleClearAll} 
                  className="btn-danger-outline" 
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '8px 12px' }}
                >
                  <Trash2 size={16} /> Clear all
                </button>
              </>
            )}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '20px', gap: '16px' }}>
          <button 
            className={`tab-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
            style={{ 
              background: 'none', 
              border: 'none', 
              padding: '10px 14px', 
              color: filter === 'all' ? 'var(--primary)' : 'var(--text-dimmed)', 
              fontWeight: filter === 'all' ? '600' : '400',
              borderBottom: filter === 'all' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            All <span style={{ marginLeft: '4px', opacity: 0.6 }}>({notifications.length})</span>
          </button>
          <button 
            className={`tab-btn ${filter === 'unread' ? 'active' : ''}`}
            onClick={() => setFilter('unread')}
            style={{ 
              background: 'none', 
              border: 'none', 
              padding: '10px 14px', 
              color: filter === 'unread' ? 'var(--primary)' : 'var(--text-dimmed)', 
              fontWeight: filter === 'unread' ? '600' : '400',
              borderBottom: filter === 'unread' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            Unread <span style={{ marginLeft: '4px', opacity: 0.6 }}>({notifications.filter(n => !n.read).length})</span>
          </button>
        </div>

        {/* List */}
        {filtered.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filtered.map(notification => (
              <div 
                key={notification.id}
                onClick={() => handleMarkAsRead(notification.id)}
                style={{ 
                  display: 'flex', 
                  gap: '16px', 
                  padding: '16px', 
                  borderRadius: '12px', 
                  border: '1px solid var(--border-color)', 
                  backgroundColor: notification.read ? 'var(--bg-sidebar)' : 'rgba(16, 185, 129, 0.03)',
                  transition: 'all 0.2s',
                  cursor: 'pointer',
                  alignItems: 'flex-start',
                  position: 'relative'
                }}
                className="notification-item-card"
              >
                <div style={{ 
                  width: '36px', 
                  height: '36px', 
                  borderRadius: '8px', 
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {getIcon(notification.type)}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h4 style={{ fontWeight: notification.read ? '500' : '700', fontSize: '0.98rem', margin: 0 }}>
                      {notification.title}
                    </h4>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Clock size={12} />
                      {formatTime(notification.time)}
                    </span>
                  </div>
                  <p style={{ margin: '6px 0 0 0', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                    {notification.message}
                  </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', alignSelf: 'stretch' }}>
                  {!notification.read && (
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--primary)', flexShrink: 0 }} />
                  )}
                  <button 
                    onClick={(e) => handleDelete(notification.id, e)}
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      color: 'var(--text-dimmed)', 
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Delete notification"
                    className="delete-notification-btn"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed var(--border-color)', borderRadius: '12px', color: 'var(--text-dimmed)' }}>
            <Bell size={40} style={{ opacity: 0.2, marginBottom: '12px' }} />
            <p style={{ margin: 0, fontSize: '0.95rem' }}>No notifications found</p>
          </div>
        )}
      </div>
    </div>
  );
}
