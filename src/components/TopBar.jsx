import React, { useState, useRef, useEffect } from 'react';
import { Bell, MessageCircle, Columns, ChevronDown, Plus, Phone, Trash2, Check, Loader2, QrCode, RefreshCw } from 'lucide-react';
import VersionBadge from './VersionBadge.jsx';
import ThemeToggle from './ThemeToggle.jsx';

export default function TopBar({ 
  user, userProfile, connectionStatus, userInfo, onWhatsAppLogout,
  waSessions = [], activeSessionId, onSwitchSession, onAddSession, onRemoveSession,
  sidebarCollapsed, onToggleSidebar, syncing, onSyncHistory,
  notifications = [], onToggleNotifications
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Format avatar initials
  const getInitials = () => {
    const name = userProfile?.name || user?.email || 'U';
    const clean = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    if (!clean) return 'U';
    const parts = clean.split(' ');
    if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  };

  const formatPhoneNumber = (jid) => {
    if (!jid) return '';
    const rawNumber = jid.split('@')[0].split(':')[0];
    return `+${rawNumber}`;
  };

  const getSessionLabel = (session) => {
    if (session.user?.id) {
      return formatPhoneNumber(session.user.id);
    }
    if (session.status === 'connected') return 'Connected';
    if (session.status === 'qr') return 'Scan QR';
    if (session.status === 'connecting') return 'Connecting...';
    return 'Disconnected';
  };

  const getStatusIcon = (status) => {
    if (status === 'connected') return <Check size={14} style={{ color: '#10b981' }} />;
    if (status === 'qr') return <QrCode size={14} style={{ color: '#f59e0b' }} />;
    if (status === 'connecting') return <Loader2 size={14} className="spin-icon" style={{ color: '#3b82f6' }} />;
    return <Phone size={14} style={{ color: 'var(--text-muted)' }} />;
  };

  // Find the active session from the list
  const activeSession = waSessions.find(s => s.sessionId === activeSessionId);
  const activeLabel = activeSession ? getSessionLabel(activeSession) : 'No Session';
  const activeStatus = activeSession?.status || 'disconnected';

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className={`topbar-icon-btn ${sidebarCollapsed ? 'active' : ''}`} title="Toggle Sidebar" onClick={onToggleSidebar}>
          <Columns size={20} />
        </button>

        {activeStatus === 'connected' && (
          <button 
            className="topbar-icon-btn" 
            onClick={onSyncHistory} 
            title="Sync Chat History"
            disabled={syncing}
            style={{ marginLeft: '4px' }}
          >
            <RefreshCw size={18} className={syncing ? 'spin-icon' : ''} />
          </button>
        )}

        {/* Session Dropdown */}
        <div className="session-dropdown-wrapper" ref={dropdownRef}>
          <button 
            className="session-dropdown-trigger"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            <span className={`status-dot-sm ${activeStatus}`}></span>
            <Phone size={16} />
            <span className="session-dropdown-label">{activeLabel}</span>
            <ChevronDown size={16} className={`chevron-icon ${dropdownOpen ? 'rotated' : ''}`} />
          </button>

          {dropdownOpen && (
            <div className="session-dropdown-menu">
              <div className="session-dropdown-header">
                <span>WhatsApp Numbers</span>
                <span className="session-count-badge">{waSessions.length}</span>
              </div>

              <div className="session-dropdown-list">
                {waSessions.map((session) => {
                  const isActive = session.sessionId === activeSessionId;
                  const label = getSessionLabel(session);
                  
                  return (
                    <div 
                      key={session.sessionId}
                      className={`session-dropdown-item ${isActive ? 'active' : ''}`}
                      onClick={() => {
                        onSwitchSession(session.sessionId);
                        setDropdownOpen(false);
                      }}
                    >
                      <div className="session-item-left">
                        {getStatusIcon(session.status)}
                        <div className="session-item-info">
                          <span className="session-item-label">{label}</span>
                          <span className="session-item-status">{session.status}</span>
                        </div>
                      </div>
                      
                      <div className="session-item-right">
                        {isActive && <span className="session-active-badge">Active</span>}
                        {waSessions.length > 1 && (
                          <button 
                            className="session-remove-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveSession(session.sessionId);
                            }}
                            title="Remove this number"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button 
                className="session-add-btn"
                onClick={() => {
                  onAddSession();
                  setDropdownOpen(false);
                }}
              >
                <Plus size={16} />
                <span>Add New Number</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="topbar-right">
        {/* Which commit this bundle came from; warns on a server mismatch. */}
        <VersionBadge />

        <ThemeToggle className="topbar-icon-btn" />

        <button className="live-support-btn">
          <MessageCircle size={16} />
          <span>Live Support</span>
        </button>

        <div className="notification-bell-wrapper">
          <button 
            className="topbar-icon-btn" 
            title="Notifications"
            onClick={onToggleNotifications}
          >
            <Bell size={20} />
          </button>
          {notifications.filter(n => !n.read).length > 0 && (
            <span className="bell-badge">
              {notifications.filter(n => !n.read).length}
            </span>
          )}
        </div>

        <div className="topbar-user-profile">
          <div className="topbar-avatar">
            {getInitials()}
          </div>
          <div className="topbar-user-info">
            <span className="topbar-username">{userProfile?.name || 'User Account'}</span>
            <span className="topbar-email">{user?.email || ''}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
