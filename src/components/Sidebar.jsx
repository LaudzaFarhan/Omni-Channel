import React from 'react';
import { LayoutDashboard, MessageSquare, BookUser, Users, CreditCard, User, Settings, LogOut, Bell, History, Code2, Megaphone } from 'lucide-react';
import { BrandLockup } from './BrandMark.jsx';
import { isVisible, isComingSoon } from '../utils/features.js';

export default function Sidebar({
  activeTab, setActiveTab, onLogout, collapsed, notifications = [], isSupervisor = true,
  // Effective feature map for this account, from the server. Absent or incomplete reads as
  // everything released — see src/utils/features.js for why it fails open.
  features = {},
}) {
  const unreadCount = notifications.filter(n => !n.read).length;

  // One nav item.
  //
  // Two feature states matter here and they are handled differently. A hidden feature
  // renders nothing at all: the point is that the customer cannot tell it exists, so a
  // greyed-out row would defeat it. A coming-soon feature stays clickable and keeps its
  // badge, because announcing it is the point — the view it opens says it is not ready.
  const NavItem = ({ tab, icon: Icon, label, feature, children }) => {
    const key = feature || tab;
    if (!isVisible(features, key)) return null;

    const soon = isComingSoon(features, key);

    return (
      <button
        className={`nav-item ${activeTab === tab ? 'active' : ''}`}
        onClick={() => setActiveTab(tab)}
        title={soon ? `${label} — coming soon` : label}
      >
        {children || <Icon size={22} />}
        {!collapsed && (
          <span className="nav-label">
            {label}
            {soon && <span className="nav-soon">Soon</span>}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className={`nav-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="nav-top">
        <div className="sidebar-brand">
          <BrandLockup markSize={32} showName={!collapsed} />
        </div>

        <NavItem tab="dashboard" icon={LayoutDashboard} label="Dashboard" />

        <NavItem tab="messages" icon={MessageSquare} label="Messages" />

        <NavItem tab="contacts" icon={BookUser} label="Contacts" />

        <NavItem tab="broadcast" icon={Megaphone} label="Broadcast" />

        <NavItem tab="notifications" label="Notifications">
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
        </NavItem>

        {/* Team and Subscription belong to whoever owns the account. An invited
            agent has no business seeing the billing or managing colleagues, and the
            server refuses those endpoints for them anyway (the `supervisor`
            middleware chain) — hiding them keeps the UI honest about it rather than
            offering buttons that 403. */}
        {isSupervisor && <NavItem tab="team" icon={Users} label="Team" />}

        {/* Oversight of the whole team, so it belongs to the owner alongside Team.
            An invited agent has no business auditing colleagues, and the endpoint
            behind it is supervisor-gated anyway.

            Labelled for what it lists — the history of customer conversations — rather
            than the old "Activity", which read as a system log. */}
        {isSupervisor && <NavItem tab="activity" icon={History} label="Chat History" />}

        {isSupervisor && <NavItem tab="subscription" icon={CreditCard} label="Subscription" />}

        {isSupervisor && <NavItem tab="developer" icon={Code2} label="API & Webhooks" />}

        <NavItem tab="profile" icon={User} label="Profile" />

        <NavItem tab="settings" icon={Settings} label="Settings" />
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
