import React from 'react';
import { LogOut } from 'lucide-react';

export default function StatsPanel({ user, onLogout }) {
  // Format user phone number for display
  const formatPhoneNumber = (jid) => {
    if (!jid) return '';
    // JIDs sometimes contain device/session indexes, e.g., 628xxx:1@s.whatsapp.net
    const rawNumber = jid.split('@')[0].split(':')[0];
    return `+${rawNumber}`;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
      <div className="status-badge connected">
        <span className="status-dot"></span>
        <span>{user ? formatPhoneNumber(user.id) : 'Connected'}</span>
      </div>
      <button 
        onClick={onLogout}
        className="logout-button"
        title="Log out session"
      >
        <LogOut size={16} style={{ display: 'block' }} />
      </button>
    </div>
  );
}
