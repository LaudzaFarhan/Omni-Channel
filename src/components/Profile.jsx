import React from 'react';
import { User } from 'lucide-react';

export default function Profile({ user, userProfile }) {
  return (
    <div className="view-container">
      <div className="view-header">
        <h2>My Profile</h2>
        <p>Manage your personal information and account settings.</p>
      </div>
      
      <div className="view-content">
        <div className="card glass" style={{ maxWidth: '600px' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '30px' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', fontWeight: 'bold' }}>
              {user?.email?.charAt(0).toUpperCase() || <User size={40} />}
            </div>
            <div>
              <h3 style={{ fontSize: '1.5rem', marginBottom: '4px' }}>{userProfile?.name || 'Administrator'}</h3>
              <p style={{ color: 'var(--text-muted)' }}>{userProfile?.role === 'admin' ? 'System Administrator' : 'Customer Account'}</p>
            </div>
          </div>

          <div className="profile-details">
            <div className="form-group">
              <label>Email Address</label>
              <input type="text" value={user?.email || ''} disabled className="modern-input" />
            </div>
            <div className="form-group">
              <label>Account Role</label>
              <input type="text" value={(userProfile?.role || 'User').toUpperCase()} disabled className="modern-input" />
            </div>
            <div className="form-group">
              <label>Verification Status</label>
              <input type="text" value={userProfile?.isApproved ? 'Approved' : 'Pending'} disabled className="modern-input" style={{ color: userProfile?.isApproved ? 'var(--primary)' : '#f59e0b', fontWeight: '600' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
