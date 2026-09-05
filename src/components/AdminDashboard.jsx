import React, { useState, useEffect, useCallback } from 'react';
import { adminListUsers, fetchPlans, adminListFeatures, fetchSystemAnnouncement } from '../utils/api.js';
import { subscribeSocket } from '../utils/socket.js';
import { LogOut, Users, Layers, Activity, CreditCard, ToggleLeft, Megaphone } from 'lucide-react';
import { BrandLockup } from './BrandMark.jsx';
import { normalizePlan, sortPlans } from '../utils/plans.js';
import VersionBadge from './VersionBadge.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import UsersTab from './admin/UsersTab.jsx';
import PlansTab from './admin/PlansTab.jsx';
import SessionsTab from './admin/SessionsTab.jsx';
import TransactionsTab from './admin/TransactionsTab.jsx';
import FeaturesTab from './admin/FeaturesTab.jsx';
import BroadcastUpdateModal from './admin/BroadcastUpdateModal.jsx';

const TABS = [
  { id: 'users', label: 'Customers', icon: Users },
  { id: 'plans', label: 'Plans', icon: Layers },
  { id: 'features', label: 'Feature Control', icon: ToggleLeft },
  { id: 'sessions', label: 'Live Sessions', icon: Activity },
  { id: 'transactions', label: 'Transactions', icon: CreditCard },
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

  // The feature catalogue and its rollout state. Owned here rather than in the tab for the
  // same reason as the other two: the socket listener below keeps it current whether or not
  // that tab happens to be open.
  const [features, setFeatures] = useState([]);
  const [loadingFeatures, setLoadingFeatures] = useState(true);
  const [featuresError, setFeaturesError] = useState(null);

  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [systemAnnouncement, setSystemAnnouncement] = useState(null);

  const refreshAnnouncement = useCallback(async () => {
    try {
      const ann = await fetchSystemAnnouncement();
      setSystemAnnouncement(ann);
    } catch (err) {
      console.error('[Admin] Error fetching announcement:', err);
    }
  }, []);

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

  const refreshFeatures = useCallback(async () => {
    try {
      setFeatures(await adminListFeatures());
      setFeaturesError(null);
    } catch (err) {
      console.error('[Admin] Error fetching features:', err);
      setFeaturesError(err.message || 'Could not read the feature list.');
    } finally {
      setLoadingFeatures(false);
    }
  }, []);

  useEffect(() => {
    refreshUsers();
    refreshPlans();
    refreshFeatures();
    refreshAnnouncement();
  }, [refreshUsers, refreshPlans, refreshFeatures, refreshAnnouncement]);

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

    // A bare signal: the effective map differs per account once exceptions exist, so the
    // server sends no payload and every listener re-reads what it needs. Here that is the
    // admin catalogue, so a second admin's change lands on this screen too.
    const handleFeatures = () => { refreshFeatures(); };

    const handleSystemUpdate = (ann) => {
      setSystemAnnouncement(ann);
    };

    let attached = null;
    const unsubscribe = subscribeSocket((socket) => {
      if (attached) {
        attached.off('plans-updated', handlePlans);
        attached.off('profile-updated', handleProfile);
        attached.off('features-updated', handleFeatures);
        attached.off('system-update', handleSystemUpdate);
        attached = null;
      }
      if (socket) {
        socket.on('plans-updated', handlePlans);
        socket.on('profile-updated', handleProfile);
        socket.on('features-updated', handleFeatures);
        socket.on('system-update', handleSystemUpdate);
        attached = socket;
      }
    });

    return () => {
      unsubscribe();
      if (attached) {
        attached.off('plans-updated', handlePlans);
        attached.off('profile-updated', handleProfile);
        attached.off('features-updated', handleFeatures);
        attached.off('system-update', handleSystemUpdate);
      }
    };
  }, [refreshFeatures]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: 'var(--bg-main)' }}>
      {/* Admin Header */}
      <nav className="landing-nav admin-navbar">
        <div className="admin-brand">
          <BrandLockup markSize={29} />
          <span className="admin-console-badge">Admin Console</span>
        </div>
        <div className="admin-navbar-actions">
          <button
            type="button"
            className="admin-broadcast-btn"
            onClick={() => setShowBroadcastModal(true)}
            title="Kirim pengumuman pembaruan sistem ke semua pengguna"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 13px',
              borderRadius: '8px',
              border: systemAnnouncement?.active ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid var(--border-color)',
              background: systemAnnouncement?.active ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255,255,255,0.05)',
              color: systemAnnouncement?.active ? '#fbbf24' : 'var(--text-main)',
              fontSize: '0.82rem',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <Megaphone size={14} style={{ color: systemAnnouncement?.active ? '#f59e0b' : 'var(--primary)' }} />
            <span>Broadcast Update</span>
            {systemAnnouncement?.active && (
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 6px #22c55e',
                  display: 'inline-block',
                }}
              />
            )}
          </button>
          <VersionBadge />
          <ThemeToggle />
          <span className="admin-navbar-user">
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
            features={features}
            onFeaturesChanged={setFeatures}
            onRefreshFeatures={refreshFeatures}
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

        {activeTab === 'features' && (
          <FeaturesTab
            features={features}
            loading={loadingFeatures}
            error={featuresError}
            users={users}
            onFeaturesChanged={setFeatures}
            onRefresh={refreshFeatures}
          />
        )}

        {activeTab === 'sessions' && <SessionsTab users={users} />}

        {activeTab === 'transactions' && <TransactionsTab users={users} />}
      </div>

      <BroadcastUpdateModal
        isOpen={showBroadcastModal}
        onClose={() => setShowBroadcastModal(false)}
        activeAnnouncement={systemAnnouncement}
        onAnnouncementChanged={setSystemAnnouncement}
      />
    </div>
  );
}

