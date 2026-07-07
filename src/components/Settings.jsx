import React from 'react';

export default function Settings() {
  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Settings</h2>
        <p>Configure your dashboard preferences.</p>
      </div>
      
      <div className="view-content">
        <div className="card glass" style={{ maxWidth: '600px' }}>
          <div className="settings-list">
            <div className="setting-item">
              <div>
                <h4>Desktop Notifications</h4>
                <p className="text-muted" style={{ fontSize: '0.8rem' }}>Receive push notifications for new messages</p>
              </div>
              <label className="switch">
                <input type="checkbox" defaultChecked />
                <span className="slider round"></span>
              </label>
            </div>
            
            <hr style={{ borderColor: 'var(--border-color)', margin: '15px 0' }} />

            <div className="setting-item">
              <div>
                <h4>Dark Mode</h4>
                <p className="text-muted" style={{ fontSize: '0.8rem' }}>Enable dark theme for the dashboard</p>
              </div>
              <label className="switch">
                <input type="checkbox" defaultChecked />
                <span className="slider round"></span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
