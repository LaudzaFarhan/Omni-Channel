import React, { useState, useEffect, useCallback } from 'react';
import { adminListUsers, fetchPlans } from '../utils/api.js';
import { subscribeSocket } from '../utils/socket.js';
import { Shield, LogOut, Users, Layers, Activity } from 'lucide-react';
import { normalizePlan, sortPlans } from '../utils/plans.js';
import VersionBadge from './VersionBadge.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import UsersTab from './admin/UsersTab.jsx';
import PlansTab from './admin/PlansTab.jsx';
import SessionsTab from './admin/SessionsTab.jsx';

const TABS = [
  { id: 'users', label: 'Customers', icon: Users },
  { id: 'plans', label: 'Plans', icon: Layers },
  { id: 'sessions', label: 'Live Sessions', icon: Activity },
];

// Admin console shell.
//
// Owns the two Firestore subscriptions that more than one tab needs (the user
// registry and the plan catalogue) so switching tabs doesn't re-open listeners,
// and so a plan edited on the Plans tab is immediately reflected in the quota
// columns on the Customers tab.
export default function AdminDashboard({ user, onLogout }) {
  const [activeTab, setActiveTab] = useState('users');

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  // Distinguishes "the query failed" from "there are no users", which the
  // previous version rendered identically as an empty-state message.
  const [usersError, setUsersError] = useState(null);

  const [plans, setPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [plansError, setPlansError] = useState(null);

  // The registry is fetched rather than subscribed to. The tabs call
  // refreshUsers() after a mutation, and the socket events below cover changes
  // made by another admin in a different browser.
  const refreshUsers = useCallback(async () => {
    try {
      const list = await adminListUsers();
      // The API already orders by created_at DESC.
      setUsers(list);
      setUsersError(null);
    } catch (err) {
      console.error('[Admin] Error fetching users:', err);
      setUsersError(
        err.status === 403
          ? 'This account is not an administrator. Ask an existing admin to promote it.'
          : err.message || 'Could not read the user registry.'
      );
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const refreshPlans = useCallback(async () => {
    try {
      const list = await fetchPlans();
      setPlans(sortPlans(list.map(plan => normalizePlan(plan.id, plan))));
      setPlansError(null);
    } catch (err) {
      console.error('[Admin] Error fetching plans:', err);
      setPlansError(err.message || 'Could not read the plan catalogue.');
    } finally {
      setLoadingPlans(false);
    }
  }, []);

  useEffect(() => {
    refreshUsers();
    refreshPlans();
  }, [refreshUsers, refreshPlans]);

  // Keep the console live without polling: the server broadcasts plan changes and
  // pushes a profile update to the affected user, and an admin watching this
  // screen wants to see both.
  useEffect(() => {
    const handlePlans = (nextPlans) => {
      setPlans(sortPlans((nextPlans || []).map(plan => normalizePlan(plan.id, plan))));
    };

    const handleProfile = (profile) => {
      setUsers(prev => prev.map(u => (u.uid === profile.uid ? { ...u, ...profile } : u)));
    };

    let attached = null;
    const unsubscribe = subscribeSocket((socket) => {
      if (attached) {
        attached.off('plans-updated', handlePlans);
        attached.off('profile-updated', handleProfile);
        attached = null;
      }
      if (socket) {
        socket.on('plans-updated', handlePlans);
        socket.on('profile-updated', handleProfile);
        attached = socket;
      }
    });

    return () => {
      unsubscribe();
      if (attached) {
        attached.off('plans-updated', handlePlans);
        attached.off('profile-updated', handleProfile);
      }
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: 'var(--bg-main)' }}>
      {/* Admin Header */}
      <nav className="landing-nav" style={{ padding: '16px 8%' }}>
        <div className="nav-logo">
          <Shield size={24} style={{ color: 'var(--primary)' }} />
          <span>
            WAgateway
            <span style={{ fontSize: '0.8rem', verticalAlign: 'middle', padding: '2px 8px', borderRadius: '12px', background: 'rgba(0,168,132,0.1)', color: 'var(--primary)', marginLeft: '10px' }}>
              Admin Console
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <VersionBadge />
          <ThemeToggle />
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Logged in as: <strong>{user.email}</strong>
          </span>
          <button className="logout-button" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </nav>

      {/* Tab navigation */}
      <div style={{ padding: '0 8%', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '4px' }}>
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              style={{
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                padding: '14px 18px',
                fontSize: '0.9rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'color 0.2s, border-color 0.2s',
              }}
            >
              <Icon size={16} /> {tab.label}
              {tab.id === 'users' && users.length > 0 && (
                <span style={{ fontSize: '0.75rem', padding: '1px 7px', borderRadius: '10px', background: 'rgba(255,255,255,0.07)', color: 'var(--text-dimmed)' }}>
                  {users.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab */}
      <div style={{ flex: 1, padding: '32px 8%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {activeTab === 'users' && (
          <UsersTab
            currentUser={user}
            users={users}
            loading={loadingUsers}
            error={usersError}
            plans={plans}
            plansLoading={loadingPlans}
            onRefresh={refreshUsers}
          />
        )}

        {activeTab === 'plans' && (
          <PlansTab
            plans={plans}
            loading={loadingPlans}
            error={plansError}
            users={users}
            onPlansChanged={setPlans}
            onRefresh={refreshPlans}
          />
        )}

        {activeTab === 'sessions' && <SessionsTab users={users} />}
      </div>
    </div>
  );
}
