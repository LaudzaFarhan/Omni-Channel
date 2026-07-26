import React, { useState, useEffect } from 'react';
import { db, auth } from '../utils/firebase.js';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { Users, UserCheck, UserX, Shield, LogOut, Search, Clock } from 'lucide-react';

export default function AdminDashboard({ user, onLogout }) {
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to all user profile documents in real-time.
    //
    // Deliberately NOT using orderBy('createdAt'): a Firestore orderBy silently
    // excludes any document that is missing that field, which made legitimately
    // registered users disappear from this registry. Read everything and sort
    // client-side instead so no account is ever hidden.
    const unsubscribe = onSnapshot(collection(db, 'users'), (snapshot) => {
      const userList = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() || {};
        // Fall back to the document ID when a record predates the uid field.
        userList.push({ uid: data.uid || docSnap.id, ...data });
      });

      // Normalize createdAt (Firestore Timestamp | Date | string | missing) to
      // millis purely for sorting; newest first, undated records last.
      const toMillis = (value) => {
        if (!value) return 0;
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.seconds === 'number') return value.seconds * 1000;
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? parsed : 0;
      };

      userList.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

      setUsers(userList);
      setLoading(false);
    }, (error) => {
      console.error('Error fetching users:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Update user's approval status in Firestore
  const handleToggleApproval = async (targetUid, currentApproval) => {
    try {
      const userDocRef = doc(db, 'users', targetUid);
      await updateDoc(userDocRef, {
        isApproved: !currentApproval
      });
    } catch (err) {
      console.error('Error updating approval status:', err);
      alert('Failed to update status. Check permissions.');
    }
  };

  // Update user's role in Firestore
  const handleToggleRole = async (targetUid, currentRole) => {
    if (targetUid === user.uid) {
      alert("You cannot change your own admin role.");
      return;
    }
    const newRole = currentRole === 'admin' ? 'customer' : 'admin';
    const confirmChange = window.confirm(`Change role of this user to ${newRole}?`);
    if (!confirmChange) return;

    try {
      const userDocRef = doc(db, 'users', targetUid);
      await updateDoc(userDocRef, {
        role: newRole,
        // Auto-approve if promoted to admin
        isApproved: newRole === 'admin' ? true : false
      });
    } catch (err) {
      console.error('Error updating user role:', err);
      alert('Failed to update role.');
    }
  };

  // Update user's message limit
  const handleEditLimit = async (targetUid, currentLimit) => {
    const newLimitStr = prompt("Enter new message limit for this user:", currentLimit);
    if (newLimitStr === null) return;
    const newLimit = parseInt(newLimitStr, 10);
    if (isNaN(newLimit) || newLimit < 0) {
      alert("Please enter a valid positive number.");
      return;
    }
    try {
      const userDocRef = doc(db, 'users', targetUid);
      await updateDoc(userDocRef, {
        messageLimit: newLimit
      });
    } catch (err) {
      console.error('Error updating limit:', err);
      alert('Failed to update limit.');
    }
  };

  // Update user's session limit
  const handleEditSessionLimit = async (targetUid, currentLimit) => {
    const newLimitStr = prompt("Enter new device session limit for this user:", currentLimit);
    if (newLimitStr === null) return;
    const newLimit = parseInt(newLimitStr, 10);
    if (isNaN(newLimit) || newLimit < 1) {
      alert("Please enter a valid number (minimum 1).");
      return;
    }
    try {
      const userDocRef = doc(db, 'users', targetUid);
      await updateDoc(userDocRef, {
        sessionLimit: newLimit
      });
    } catch (err) {
      console.error('Error updating session limit:', err);
      alert('Failed to update session limit.');
    }
  };

  // Toggle user's tier between 'free' and 'premium'
  const handleToggleTier = async (targetUid, currentTier) => {
    const newTier = currentTier === 'premium' ? 'free' : 'premium';
    const confirmChange = window.confirm(`Change subscription tier of this user to ${newTier.toUpperCase()}?`);
    if (!confirmChange) return;

    try {
      const userDocRef = doc(db, 'users', targetUid);
      await updateDoc(userDocRef, {
        tier: newTier
      });
    } catch (err) {
      console.error('Error updating user tier:', err);
      alert('Failed to update tier.');
    }
  };

  // Toggle user's trial expiration manually
  const handleToggleTrialExpired = async (targetUid, currentExpired) => {
    try {
      const userDocRef = doc(db, 'users', targetUid);
      await updateDoc(userDocRef, {
        trialExpired: !currentExpired
      });
    } catch (err) {
      console.error('Error updating trial expiration:', err);
      alert('Failed to update trial status.');
    }
  };

  // Filter users by name or email JID
  const filteredUsers = users.filter(u => {
    const name = (u.name || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  const totalUsers = users.length;
  const pendingUsers = users.filter(u => !u.isApproved && u.role === 'customer').length;
  const approvedUsers = users.filter(u => u.isApproved && u.role === 'customer').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: 'var(--bg-main)' }}>
      {/* Admin Header */}
      <nav className="landing-nav" style={{ padding: '16px 8%' }}>
        <div className="nav-logo">
          <Shield size={24} style={{ color: 'var(--primary)' }} />
          <span>WAgateway <span style={{ fontSize: '0.8rem', verticalAlign: 'middle', padding: '2px 8px', borderRadius: '12px', background: 'rgba(0,168,132,0.1)', color: 'var(--primary)', marginLeft: '10px' }}>Admin Console</span></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Logged in as: <strong>{user.email}</strong></span>
          <button className="logout-button" onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </nav>

      {/* Main Stats Block */}
      <div style={{ flex: 1, padding: '40px 8%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
          <div className="glass" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="feature-card-icon" style={{ marginBottom: 0 }}><Users size={22} /></div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dimmed)' }}>Total Registrations</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '700' }}>{totalUsers}</div>
            </div>
          </div>
          
          <div className="glass" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '3px solid #f59e0b' }}>
            <div className="feature-card-icon" style={{ marginBottom: 0, color: '#f59e0b', background: 'rgba(245,158,11,0.1)' }}><Clock size={22} /></div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dimmed)' }}>Pending Verification</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '700', color: '#f59e0b' }}>{pendingUsers}</div>
            </div>
          </div>

          <div className="glass" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px', borderLeft: '3px solid var(--primary)' }}>
            <div className="feature-card-icon" style={{ marginBottom: 0 }}><UserCheck size={22} /></div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dimmed)' }}>Approved Customers</div>
              <div style={{ fontSize: '1.8rem', fontWeight: '700', color: 'var(--primary)' }}>{approvedUsers}</div>
            </div>
          </div>
        </div>

        {/* User Search & Table */}
        <div className="glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700' }}>Customer Registry</h3>
            <div className="search-input-wrapper" style={{ width: '300px' }}>
              <Search className="search-icon" />
              <input 
                type="text" 
                placeholder="Search by name or email..." 
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><div className="spinner"></div></div>
          ) : filteredUsers.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.95rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-dimmed)', fontWeight: '600' }}>
                    <th style={{ padding: '12px 16px' }}>Name</th>
                    <th style={{ padding: '12px 16px' }}>Email</th>
                    <th style={{ padding: '12px 16px' }}>Role</th>
                    <th style={{ padding: '12px 16px' }}>Approval Status</th>
                    <th style={{ padding: '12px 16px' }}>Subscription Tier</th>
                    <th style={{ padding: '12px 16px' }}>Trial Expired</th>
                    <th style={{ padding: '12px 16px' }}>Session Limit</th>
                    <th style={{ padding: '12px 16px' }}>Usage Limit</th>
                    <th style={{ padding: '12px 16px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => {
                    const isMe = u.uid === user.uid;
                    return (
                      <tr key={u.uid} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background-color 0.2s' }}>
                        <td style={{ padding: '16px', fontWeight: '600' }}>{u.name || 'N/A'}</td>
                        <td style={{ padding: '16px', color: 'var(--text-muted)' }}>{u.email}</td>
                        <td style={{ padding: '16px' }}>
                          <button 
                            onClick={() => handleToggleRole(u.uid, u.role)}
                            disabled={isMe}
                            style={{ 
                              background: u.role === 'admin' ? 'rgba(0,168,132,0.1)' : 'rgba(255,255,255,0.05)', 
                              border: '1px solid ' + (u.role === 'admin' ? 'rgba(0,168,132,0.2)' : 'var(--border-color)'),
                              color: u.role === 'admin' ? 'var(--primary)' : 'var(--text-muted)',
                              padding: '4px 10px',
                              borderRadius: '4px',
                              fontSize: '0.8rem',
                              fontWeight: '600',
                              cursor: isMe ? 'not-allowed' : 'pointer'
                            }}
                          >
                            {u.role.toUpperCase()}
                          </button>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <span 
                            className={`status-badge ${u.isApproved ? 'connected' : 'disconnected'}`} 
                            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                          >
                            <span className="status-dot"></span>
                            {u.isApproved ? 'Approved' : 'Pending Verification'}
                          </span>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <button 
                            onClick={() => handleToggleTier(u.uid, u.tier || 'free')}
                            style={{ 
                              background: (u.tier || 'free') === 'premium' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)', 
                              border: '1px solid ' + ((u.tier || 'free') === 'premium' ? 'rgba(16,185,129,0.2)' : 'var(--border-color)'),
                              color: (u.tier || 'free') === 'premium' ? 'var(--primary)' : 'var(--text-muted)',
                              padding: '4px 10px',
                              borderRadius: '4px',
                              fontSize: '0.8rem',
                              fontWeight: '600',
                              cursor: 'pointer'
                            }}
                          >
                            {(u.tier || 'free').toUpperCase()}
                          </button>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <label className="switch">
                            <input 
                              type="checkbox" 
                              checked={u.trialExpired || false} 
                              onChange={() => handleToggleTrialExpired(u.uid, u.trialExpired || false)}
                              disabled={u.role === 'admin'}
                            />
                            <span className="slider round"></span>
                          </label>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem' }}>
                              {u.sessionLimit || 1}
                            </span>
                            <button 
                              onClick={() => handleEditSessionLimit(u.uid, u.sessionLimit || 1)}
                              style={{
                                background: 'transparent',
                                border: '1px solid var(--border-color)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                color: 'var(--text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.85rem' }}>
                              {u.messagesSent || 0} / {u.messageLimit || 500}
                            </span>
                            <button 
                              onClick={() => handleEditLimit(u.uid, u.messageLimit || 500)}
                              style={{
                                background: 'transparent',
                                border: '1px solid var(--border-color)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                color: 'var(--text-muted)',
                                cursor: 'pointer'
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '16px' }}>
                          {isMe ? (
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-dimmed)' }}>(Current Admin)</span>
                          ) : (
                            <button 
                              onClick={() => handleToggleApproval(u.uid, u.isApproved)}
                              style={{ 
                                background: u.isApproved ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 168, 132, 0.1)', 
                                border: '1px solid ' + (u.isApproved ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0, 168, 132, 0.2)'),
                                color: u.isApproved ? '#ef4444' : 'var(--primary)',
                                padding: '6px 12px',
                                borderRadius: '6px',
                                fontSize: '0.85rem',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}
                            >
                              {u.isApproved ? (
                                <>
                                  <UserX size={14} /> Revoke Access
                                </>
                              ) : (
                                <>
                                  <UserCheck size={14} /> Approve Access
                                </>
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-dimmed)', padding: '40px' }}>
              No accounts registered matching your search query.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
