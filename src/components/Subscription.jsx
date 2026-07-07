import React, { useState } from 'react';
import { Send, Hash, Zap, Smartphone, Plus } from 'lucide-react';
import { db } from '../utils/firebase.js';
import { doc, updateDoc, increment } from 'firebase/firestore';

export default function Subscription({ userProfile, activeSessionCount }) {
  const [buying, setBuying] = useState(false);
  const limit = userProfile?.messageLimit ?? 500;
  const sent = userProfile?.messagesSent || 0;
  const percent = limit > 0 ? Math.min((sent / limit) * 100, 100) : 0;

  const sessionLimit = userProfile?.sessionLimit ?? 1;

  const handleSimulatePurchase = async () => {
    if (buying) return;
    setBuying(true);
    try {
      const userRef = doc(db, 'users', userProfile.uid);
      await updateDoc(userRef, {
        sessionLimit: increment(1)
      });
      alert('Simulation Successful! 1 Device Session License added to your account.');
    } catch (e) {
      console.error('Failed to buy session:', e);
      alert('Failed to simulate session purchase.');
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Subscription Plan</h2>
        <p>Manage your account limits, device licenses, and subscription status.</p>
      </div>
      
      <div className="view-content" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        
        {/* Message Usage Card */}
        <div className="card glass" style={{ maxWidth: '700px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '10px', color: 'var(--primary)' }}>
              <Zap size={24} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1.4rem' }}>Message Plan Usage</h3>
            <span style={{ 
              marginLeft: 'auto', 
              background: (userProfile?.tier || 'free') === 'premium' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: (userProfile?.tier || 'free') === 'premium' ? 'var(--primary)' : '#f59e0b',
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '0.85rem',
              fontWeight: '700',
              textTransform: 'uppercase'
            }}>
              {(userProfile?.tier || 'free')} Tier
            </span>
          </div>
          
          <div className="usage-stats">
            <div className="stat-box" style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <div style={{ color: 'var(--text-muted)' }}><Send size={28} /></div>
              <div>
                <span className="stat-label">Messages Sent</span>
                <span className="stat-value">{sent.toLocaleString()}</span>
              </div>
            </div>
            <div className="stat-box" style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <div style={{ color: 'var(--text-muted)' }}><Hash size={28} /></div>
              <div>
                <span className="stat-label">Message Limit</span>
                <span className="stat-value">{limit.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="progress-container">
            <div className="progress-bar-bg">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${percent}%`, backgroundColor: percent >= 90 ? '#ef4444' : 'var(--primary)' }}
              ></div>
            </div>
            <p className="progress-text">
              {percent.toFixed(1)}% of your limit used
            </p>
          </div>

          {percent >= 100 && (
            <div className="alert-danger" style={{ marginTop: '20px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px' }}>
              You have reached your message limit. Please contact support or upgrade your plan to continue sending messages.
            </div>
          )}

          <div style={{ marginTop: '30px' }}>
            <button className="upgrade-btn">Upgrade Plan</button>
          </div>
        </div>

        {/* Device Sessions Card */}
        <div className="card glass" style={{ maxWidth: '700px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '10px', color: 'var(--primary)' }}>
              <Smartphone size={24} />
            </div>
            <h3 style={{ margin: 0, fontSize: '1.4rem' }}>Device Session Licenses</h3>
          </div>

          <div className="usage-stats">
            <div className="stat-box" style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <div style={{ color: 'var(--text-muted)' }}><Smartphone size={28} /></div>
              <div>
                <span className="stat-label">Active Sessions</span>
                <span className="stat-value">{activeSessionCount || 1}</span>
              </div>
            </div>
            <div className="stat-box" style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
              <div style={{ color: 'var(--text-muted)' }}><Hash size={28} /></div>
              <div>
                <span className="stat-label">Session Limit</span>
                <span className="stat-value">{sessionLimit}</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: '30px', padding: '20px', border: '1px solid var(--border-color)', borderRadius: '10px', background: 'rgba(255,255,255,0.01)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '1rem', fontWeight: '600' }}>Add Additional Session License</h4>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Expand your limit to allow concurrent device connections at **200,000 IDR / session**.</p>
            </div>
            <button 
              className="upgrade-btn" 
              onClick={handleSimulatePurchase}
              disabled={buying}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={16} /> Simulate Purchase (200k IDR)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
