import React, { useState, useEffect } from 'react';
import { db } from '../utils/firebase.js';
import { collection, onSnapshot } from 'firebase/firestore';
import { Shield, LogOut, Users, Layers, Activity } from 'lucide-react';
import { PLANS_COLLECTION, normalizePlan, sortPlans } from '../utils/plans.js';
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

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        const userList = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() || {};
          userList.push({ uid: data.uid || docSnap.id, ...data, docId: docSnap.id });
        });

        const toMillis = (value) => {
          if (!value) return 0;
          if (typeof value.toMillis === 'function') return value.toMillis();
          if (typeof value.seconds === 'number') return value.seconds * 1000;
          const parsed = new Date(value).getTime();
          return Number.isFinite(parsed) ? parsed : 0;
        };

        userList.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

        setUsers(userList);
        setUsersError(null);
        setLoadingUsers(false);
      },
      (error) => {
        console.error('[Admin] Error fetching users:', error);
        setUsersError(error.message || 'Could not read the user registry.');
        setLoadingUsers(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, PLANS_COLLECTION),
      (snapshot) => {
        const list = [];
        snapshot.forEach((docSnap) => {
          list.push(normalizePlan(docSnap.id, docSnap.data() || {}));
        });
        setPlans(sortPlans(list));
        setPlansError(null);
        setLoadingPlans(false);
      },
      (error) => {
        console.error('[Admin] Error fetching plans:', error);
        setPlansError(error.message || 'Could not read the plan catalogue.');
        setLoadingPlans(false);
      }
    );

    return () => unsubscribe();
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
          />
        )}

        {activeTab === 'plans' && (
          <PlansTab
            plans={plans}
            loading={loadingPlans}
            error={plansError}
            users={users}
          />
        )}

        {activeTab === 'sessions' && <SessionsTab users={users} />}
      </div>
    </div>
  );
}
