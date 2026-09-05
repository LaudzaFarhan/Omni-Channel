import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Users, ChevronDown, Circle, Crown, ShieldCheck, Clock, Moon, Check, Search, ExternalLink } from 'lucide-react';
import { fetchTeamPresence, updateTeamPresence } from '../utils/api.js';
import { subscribeSocket, getSocket } from '../utils/socket.js';

const STATUS_CONFIG = {
  online: {
    label: 'Online',
    color: 'var(--success, #10b981)',
    bg: 'var(--success-soft, rgba(16, 185, 129, 0.12))',
    border: 'var(--success-border, rgba(16, 185, 129, 0.25))',
    dotClass: 'status-dot-online',
    description: 'Active & available',
  },
  away: {
    label: 'Away',
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.25)',
    dotClass: 'status-dot-away',
    description: 'Stepped away / idle',
  },
  off: {
    label: 'Off',
    color: 'var(--text-muted, #94a3b8)',
    bg: 'rgba(148, 163, 184, 0.12)',
    border: 'rgba(148, 163, 184, 0.25)',
    dotClass: 'status-dot-off',
    description: 'Offline / away',
  },
};

function formatLastActive(timestamp, status) {
  if (status === 'online') return 'Active now';
  if (!timestamp) return 'Offline';
  
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Offline';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function getInitials(name, email) {
  const str = name || email || 'U';
  const clean = str.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  if (!clean) return 'U';
  const parts = clean.split(' ');
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return parts[0].substring(0, 2).toUpperCase();
}

export default function TeamPresenceDropdown({ user, userProfile, isSupervisor, onNavigateTab }) {
  const [isOpen, setIsOpen] = useState(false);
  const [teamData, setTeamData] = useState({
    members: [],
    summary: { online: 0, away: 0, off: 0, total: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all' | 'online' | 'away' | 'off'
  const [searchQuery, setSearchQuery] = useState('');
  const [myStatus, setMyStatus] = useState('online');
  const [isManualStatus, setIsManualStatus] = useState(false);

  const dropdownRef = useRef(null);
  const idleTimerRef = useRef(null);

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Fetch initial presence
  const loadPresence = useCallback(async () => {
    try {
      const data = await fetchTeamPresence();
      if (data && Array.isArray(data.members)) {
        setTeamData(data);
        const me = data.members.find(m => m.uid === userProfile?.uid || m.email === user?.email);
        if (me && me.status) {
          setMyStatus(me.status);
        }
      }
    } catch (err) {
      console.warn('[TeamPresence] Could not load initial presence:', err.message);
    } finally {
      setLoading(false);
    }
  }, [userProfile?.uid, user?.email]);

  useEffect(() => {
    loadPresence();
  }, [loadPresence]);

  // Subscribe to real-time socket presence events
  useEffect(() => {
    let attached = null;

    const handlePresenceUpdate = (data) => {
      if (data && Array.isArray(data.members)) {
        setTeamData(data);
        const me = data.members.find(m => m.uid === userProfile?.uid || m.email === user?.email);
        if (me && me.status) {
          setMyStatus(me.status);
        }
      }
    };

    const unsubscribe = subscribeSocket((socket) => {
      if (attached) attached.off('team-presence-update', handlePresenceUpdate);
      attached = null;
      if (socket) {
        socket.on('team-presence-update', handlePresenceUpdate);
        attached = socket;
      }
    });

    return () => {
      unsubscribe();
      if (attached) attached.off('team-presence-update', handlePresenceUpdate);
    };
  }, [userProfile?.uid, user?.email]);

  // Change presence handler (only online or away can be set manually)
  const handleSetStatus = async (status, manual = true) => {
    if (!['online', 'away'].includes(status)) return;
    setMyStatus(status);
    if (manual) {
      setIsManualStatus(status === 'away');
    }

    try {
      const socket = getSocket();
      if (socket && socket.connected) {
        socket.emit('set-presence', { status });
      }
      await updateTeamPresence(status);
    } catch (err) {
      console.warn('[TeamPresence] Status update failed:', err);
    }
  };

  // Auto-Away detection:
  // - Tab switched or minimized (document.hidden) -> immediately Away
  // - Inactivity (no mouse movement / keyboard input) > 1 minute -> automatically Away
  // - Close tab -> automatically Offline on server via socket disconnect
  useEffect(() => {
    const IDLE_TIMEOUT_MS = 60 * 1000; // 1 minute (60 seconds)

    const switchToAway = () => {
      handleSetStatus('away', false);
    };

    const switchToOnline = () => {
      if (!document.hidden) {
        handleSetStatus('online', false);
      }
    };

    const resetIdleTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

      // Auto-restore to online on user interaction if tab is active and visible
      if (myStatus === 'away' && !isManualStatus && !document.hidden) {
        switchToOnline();
      }

      // Switch to away after 1 minute of inactivity
      idleTimerRef.current = setTimeout(() => {
        if (!document.hidden) {
          switchToAway();
        }
      }, IDLE_TIMEOUT_MS);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // User switched tabs or minimized window -> Away
        switchToAway();
      } else {
        // User switched back to this tab -> Online
        if (!isManualStatus) {
          switchToOnline();
        }
        resetIdleTimer();
      }
    };

    window.addEventListener('mousemove', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);
    window.addEventListener('click', resetIdleTimer);
    window.addEventListener('scroll', resetIdleTimer);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    resetIdleTimer();

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      window.removeEventListener('mousemove', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
      window.removeEventListener('click', resetIdleTimer);
      window.removeEventListener('scroll', resetIdleTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [myStatus, isManualStatus]);

  // Filtered members list
  const filteredMembers = useMemo(() => {
    let list = teamData.members || [];

    if (filter !== 'all') {
      list = list.filter(m => m.status === filter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(m => 
        (m.name && m.name.toLowerCase().includes(q)) || 
        (m.email && m.email.toLowerCase().includes(q))
      );
    }

    // Sort: Online first, then Away, then Off; self first within status
    return [...list].sort((a, b) => {
      const order = { online: 0, away: 1, off: 2 };
      const rankA = order[a.status] ?? 3;
      const rankB = order[b.status] ?? 3;
      if (rankA !== rankB) return rankA - rankB;
      const isSelfA = a.uid === userProfile?.uid || a.email === user?.email;
      const isSelfB = b.uid === userProfile?.uid || b.email === user?.email;
      if (isSelfA) return -1;
      if (isSelfB) return 1;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });
  }, [teamData.members, filter, searchQuery, userProfile?.uid, user?.email]);

  const summary = teamData.summary || { online: 0, away: 0, off: 0, total: 0 };
  const currentStatusConfig = STATUS_CONFIG[myStatus] || STATUS_CONFIG.online;

  return (
    <div className="team-presence-wrapper" ref={dropdownRef}>
      {/* TopBar Trigger Button */}
      <button
        className={`team-presence-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(prev => !prev)}
        title="Team Presence & Status"
        aria-expanded={isOpen}
      >
        <Users size={16} className="team-presence-icon" />
        <span className="team-presence-trigger-label">Team</span>
        <span className="team-presence-status-pill">
          <span className={`presence-dot ${currentStatusConfig.dotClass}`} />
          <span className="team-online-count">{summary.online} Online</span>
        </span>
        <ChevronDown size={14} className={`team-chevron ${isOpen ? 'rotated' : ''}`} />
      </button>

      {/* Dropdown Menu Popover */}
      {isOpen && (
        <div className="team-presence-popover">
          {/* Header */}
          <div className="team-presence-header">
            <div className="team-presence-header-top">
              <div className="team-presence-title-area">
                <Users size={16} className="team-title-icon" />
                <h4 className="team-presence-title">Team Presence</h4>
              </div>
              <span className="team-total-badge">{summary.total} {summary.total === 1 ? 'member' : 'members'}</span>
            </div>

            {/* Quick Summary Pill Bar */}
            <div className="team-summary-bar">
              <button 
                className={`summary-chip chip-online ${filter === 'online' ? 'selected' : ''}`}
                onClick={() => setFilter(filter === 'online' ? 'all' : 'online')}
              >
                <span className="presence-dot status-dot-online" />
                <span>{summary.online} Online</span>
              </button>
              <button 
                className={`summary-chip chip-away ${filter === 'away' ? 'selected' : ''}`}
                onClick={() => setFilter(filter === 'away' ? 'all' : 'away')}
              >
                <span className="presence-dot status-dot-away" />
                <span>{summary.away} Away</span>
              </button>
              <button 
                className={`summary-chip chip-off ${filter === 'off' ? 'selected' : ''}`}
                onClick={() => setFilter(filter === 'off' ? 'all' : 'off')}
              >
                <span className="presence-dot status-dot-off" />
                <span>{summary.off} Off</span>
              </button>
            </div>
          </div>

          {/* "My Status" Switcher */}
          <div className="team-presence-my-status-box">
            <div className="my-status-label-row">
              <span className="my-status-title">Your Status</span>
              <span className="my-status-desc">{currentStatusConfig.description}</span>
            </div>
            <div className="status-switcher-group">
              <button
                type="button"
                className={`status-switch-btn ${myStatus === 'online' ? 'active status-online-active' : ''}`}
                onClick={() => handleSetStatus('online', true)}
              >
                <span className="presence-dot status-dot-online" />
                <span>Online</span>
                {myStatus === 'online' && <Check size={12} className="status-check-icon" />}
              </button>

              <button
                type="button"
                className={`status-switch-btn ${myStatus === 'away' ? 'active status-away-active' : ''}`}
                onClick={() => handleSetStatus('away', true)}
              >
                <span className="presence-dot status-dot-away" />
                <span>Away</span>
                {myStatus === 'away' && <Check size={12} className="status-check-icon" />}
              </button>
            </div>
          </div>

          {/* Filter and Search Bar (if more than 3 members) */}
          {summary.total > 3 && (
            <div className="team-filter-bar">
              <div className="team-search-input-wrapper">
                <Search size={13} className="team-search-icon" />
                <input
                  type="text"
                  placeholder="Search team member..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="team-search-input"
                />
              </div>
            </div>
          )}

          {/* Members List */}
          <div className="team-members-list-wrapper">
            <div className="team-members-list-header">
              <span>Members ({filteredMembers.length})</span>
              {filter !== 'all' && (
                <button className="team-filter-clear-btn" onClick={() => setFilter('all')}>
                  Show all
                </button>
              )}
            </div>

            <div className="team-members-list">
              {filteredMembers.length === 0 ? (
                <div className="team-empty-state">
                  <p>No team members found {filter !== 'all' ? `matching "${filter}"` : ''}.</p>
                </div>
              ) : (
                filteredMembers.map((member) => {
                  const isSelf = member.uid === userProfile?.uid || member.email === user?.email;
                  const statusConf = STATUS_CONFIG[member.status] || STATUS_CONFIG.off;
                  const initials = getInitials(member.name, member.email);
                  const lastActiveText = formatLastActive(member.lastActive, member.status);

                  return (
                    <div key={member.uid} className={`team-member-item ${isSelf ? 'is-self' : ''}`}>
                      <div className="team-member-avatar-wrapper">
                        <div className="team-member-avatar">
                          {initials}
                        </div>
                        <span className={`team-avatar-dot ${statusConf.dotClass}`} />
                      </div>

                      <div className="team-member-info">
                        <div className="team-member-name-row">
                          <span className="team-member-name">{member.name || member.email}</span>
                          {isSelf && <span className="team-self-badge">You</span>}
                          {member.isSupervisor && (
                            <span className="team-role-badge owner" title="Account Owner / Supervisor">
                              <Crown size={10} /> Owner
                            </span>
                          )}
                        </div>
                        <div className="team-member-meta-row">
                          <span className="team-member-email">{member.email}</span>
                          <span className="meta-dot">•</span>
                          <span className="team-member-time">{lastActiveText}</span>
                        </div>
                      </div>

                      <div className="team-member-status-pill" style={{
                        color: statusConf.color,
                        background: statusConf.bg,
                        borderColor: statusConf.border,
                      }}>
                        <span className={`presence-dot-sm ${statusConf.dotClass}`} />
                        <span>{statusConf.label}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Footer for Supervisor to manage team */}
          {isSupervisor && (
            <div className="team-presence-footer">
              <button
                className="team-manage-link-btn"
                onClick={() => {
                  setIsOpen(false);
                  if (typeof onNavigateTab === 'function') {
                    onNavigateTab('team');
                  }
                }}
              >
                <span>Manage Team Members & Seats</span>
                <ExternalLink size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
