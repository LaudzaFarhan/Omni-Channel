import React from 'react';
import { LayoutDashboard, MessageSquare, BookUser, Users, CreditCard, User, Settings, LogOut, Bell, Activity } from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab, onLogout, collapsed, notifications = [], isSupervisor = true }) {
  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className={`nav-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="nav-top">
        <div className="nav-logo">
          <div className="logo-circle">W</div>
          {!collapsed && <span className="logo-text">WhatsApp</span>}
        </div>

        <button 
          className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
          title="Dashboard"
        >
          <LayoutDashboard size={22} />
          {!collapsed && <span className="nav-label">Dashboard</span>}
        </button>
        
        <button 
          className={`nav-item ${activeTab === 'messages' ? 'active' : ''}`}
          onClick={() => setActiveTab('messages')}
          title="Messages"
        >
          <MessageSquare size={22} />
          {!collapsed && <span className="nav-label">Messages</span>}
        </button>

        <button 
          className={`nav-item ${activeTab === 'contacts' ? 'active' : ''}`}
          onClick={() => setActiveTab('contacts')}
          title="Contacts"
        >
          <BookUser size={22} />
          {!collapsed && <span className="nav-label">Contacts</span>}
        </button>

        <button 
          className={`nav-item ${activeTab === 'notifications' ? 'active' : ''}`}
          onClick={() => setActiveTab('notifications')}
          title="Notifications"
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Bell size={22} />
            {unreadCount > 0 && (
              <span 
                style={{ 
                  position: 'absolute', 
                  top: '-4px', 
                  right: '-4px', 
                  backgroundColor: '#ef4444', 
                  color: 'white', 
                  borderRadius: '50%', 
                  width: '15px', 
                  height: '15px', 
                  fontSize: '9px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  fontWeight: '700'
                }}
              >
                {unreadCount}
              </span>
            )}
          </div>
          {!collapsed && <span className="nav-label">Notifications</span>}
        </button>

        {/* Team and Subscription belong to whoever owns the account. An invited
            agent has no business seeing the billing or managing colleagues, and the
            server refuses those endpoints for them anyway (the `supervisor`
            middleware chain) — hiding them keeps the UI honest about it rather than
            offering buttons that 403. */}
        {isSupervisor && (
          <button 
            className={`nav-item ${activeTab === 'team' ? 'active' : ''}`}
            onClick={() => setActiveTab('team')}
            title="Team"
          >
            <Users size={22} />
            {!collapsed && <span className="nav-label">Team</span>}
          </button>
        )}

        {/* Oversight of the whole team, so it belongs to the owner alongside Team.
            An invited agent has no business auditing colleagues, and the endpoint
            behind it is supervisor-gated anyway. */}
        {isSupervisor && (
          <button 
            className={`nav-item ${activeTab === 'activity' ? 'active' : ''}`}
            onClick={() => setActiveTab('activity')}
            title="Activity"
          >
            <Activity size={22} />
            {!collapsed && <span className="nav-label">Activity</span>}
          </button>
        )}

        {isSupervisor && (
          <button 
            className={`nav-item ${activeTab === 'subscription' ? 'active' : ''}`}
            onClick={() => setActiveTab('subscription')}
            title="Subscription"
          >
            <CreditCard size={22} />
            {!collapsed && <span className="nav-label">Subscription</span>}
          </button>
        )}

        <button 
          className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
          title="Profile"
        >
          <User size={22} />
          {!collapsed && <span className="nav-label">Profile</span>}
        </button>

        <button 
          className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
          title="Settings"
        >
          <Settings size={22} />
          {!collapsed && <span className="nav-label">Settings</span>}
        </button>
      </div>

      <div className="nav-bottom">
        <button className="nav-item logout-nav" onClick={onLogout} title="Sign Out">
          <LogOut size={22} />
          {!collapsed && <span className="nav-label">Sign Out</span>}
        </button>
      </div>
    </div>
  );
}
