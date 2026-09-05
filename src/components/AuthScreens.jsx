import React, { useState } from 'react';
import { login as apiLogin, register as apiRegister } from '../utils/api.js';
import { Mail, Lock, User, ArrowLeft, Eye, EyeOff, Sparkles } from 'lucide-react';
import BrandMark from './BrandMark.jsx';

export default function AuthScreens({ type, onSwitchType, onBackToHome, onAuthSuccess, systemAnnouncement }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password || (type === 'register' && !name)) {
      setError('Please fill in all fields.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      // The server owns account creation now: it assigns the role from the
      // ADMIN_EMAILS allow-list, places the account on the default plan, and
      // decides approval. The client no longer writes any of that, which is what
      // let a crafted signup grant itself privileges under the old rules.
      const user = type === 'login'
        ? await apiLogin({ email, password })
        : await apiRegister({ name, email, password });

      onAuthSuccess(user);
    } catch (err) {
      console.error('Auth error:', err);

      // The API returns a human-readable message with an appropriate status, so
      // prefer it over inventing one. Codes are only used where the wording
      // should differ from the server's.
      if (err.code === 'password_reset_required') {
        setError('This account was migrated and needs a new password. Ask an administrator to reset it.');
      } else if (err.status === 429) {
        setError(err.message || 'Too many attempts. Please wait a moment and try again.');
      } else if (err.status === 401) {
        setError('Invalid email or password.');
      } else {
        setError(err.message || 'An error occurred during authentication.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="connection-overlay">
      <div className="connection-card glass" style={{ maxWidth: '400px' }}>
        <button 
          onClick={onBackToHome}
          style={{ 
            alignSelf: 'flex-start', 
            background: 'transparent', 
            border: 'none', 
            color: 'var(--text-muted)', 
            cursor: 'pointer', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px',
            fontSize: '0.9rem',
            marginBottom: '20px'
          }}
        >
          <ArrowLeft size={16} /> Back to Home
        </button>

        <div className="welcome-logo-wrapper" style={{ margin: '0 auto 24px auto' }}>
          <BrandMark size={44} />
        </div>

        <h2 className="connection-title" style={{ marginBottom: '8px' }}>
          {type === 'login' ? 'Welcome Back' : 'Create Account'}
        </h2>
        {type === 'login' && (systemAnnouncement?.active || (typeof window !== 'undefined' && window.location.search.includes('updated=true'))) && (
          <div
            style={{
              width: '100%',
              padding: '14px 16px',
              background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)',
              border: '1.5px solid #fde68a',
              borderRadius: '12px',
              fontSize: '0.84rem',
              color: '#78350f',
              marginBottom: '20px',
              textAlign: 'left',
              lineHeight: '1.45',
              boxShadow: '0 4px 14px rgba(245, 158, 11, 0.12)',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '700', color: '#b45309', marginBottom: '4px' }}>
              <Sparkles size={16} />
              <span>Pembaruan Sistem Baru Tersedia!</span>
            </div>
            <div style={{ color: '#451a03', fontSize: '0.82rem', marginBottom: '8px' }}>
              {systemAnnouncement?.message || 'Sistem baru saja diperbarui. Mohon tekan tombol Hard Refresh di browser sebelum Anda login.'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#78350f', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: '600' }}>Tekan:</span>
              <kbd className="broadcast-kbd-tag">
                {typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? '⌘ Cmd' : 'Ctrl'}
              </kbd>
              <span>+</span>
              <kbd className="broadcast-kbd-tag">
                Shift
              </kbd>
              <span>+</span>
              <kbd className="broadcast-kbd-tag">
                R
              </kbd>
              <span style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: '700' }}>sebelum login</span>
            </div>
          </div>
        )}

        {error && (
          <div style={{ 
            width: '100%', 
            padding: '12px', 
            background: 'rgba(239, 68, 68, 0.1)', 
            border: '1px solid rgba(239, 68, 68, 0.2)', 
            color: '#ef4444', 
            borderRadius: '8px', 
            fontSize: '0.85rem', 
            marginBottom: '16px',
            textAlign: 'left'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {type === 'register' && (
            <div className="search-input-wrapper">
              <User className="search-icon" />
              <input 
                type="text" 
                placeholder="Full Name" 
                className="search-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          )}

          <div className="search-input-wrapper">
            <Mail className="search-icon" />
            <input 
              type="email" 
              placeholder="Email Address" 
              className="search-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="search-input-wrapper">
            <Lock className="search-icon" />
            <input 
              type={showPassword ? 'text' : 'password'} 
              placeholder="Password" 
              className="search-input has-trailing-action"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete={type === 'login' ? 'current-password' : 'new-password'}
              required
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword(prev => !prev)}
              disabled={loading}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>

          <button 
            type="submit" 
            className="nav-btn" 
            style={{ width: '100%', padding: '12px', marginTop: '10px' }}
            disabled={loading}
          >
            {loading ? 'Processing...' : type === 'login' ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <p style={{ marginTop: '24px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          {type === 'login' ? "Don't have an account? " : "Already have an account? "}
          <button 
            onClick={onSwitchType}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--primary)', 
              fontWeight: '600', 
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
            disabled={loading}
          >
            {type === 'login' ? 'Sign Up' : 'Sign In'}
          </button>
        </p>
      </div>
    </div>
  );
}
