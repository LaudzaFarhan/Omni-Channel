import React, { useState, useEffect } from 'react';
import { UserPlus, AlertTriangle, Loader2, Eye, EyeOff } from 'lucide-react';
import { lookupInvite, acceptInvite } from '../utils/api.js';

// Landing page for an invitation link.
//
// The token in the URL is the only credential the recipient has, so the flow is:
// look it up to confirm who it is for, then exchange it for a password. Accepting
// signs them in directly — bouncing them to the login form right after choosing a
// password would be a pointless extra step.
export default function AcceptInvite({ token, onAccepted, onGoToLogin }) {
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lookupError, setLookupError] = useState(null);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) {
      setLookupError('This link is missing its invitation code. Ask for a new one.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    lookupInvite(token)
      .then((data) => {
        if (cancelled) return;
        setInvite(data);
        setName(data.name || '');
      })
      .catch((err) => {
        if (!cancelled) setLookupError(err.message || 'This invitation could not be checked.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    if (password.length < 8) {
      setError('Choose a password of at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const user = await acceptInvite({ token, password, name: name.trim() });
      onAccepted?.(user);
    } catch (err) {
      setError(err.message || 'Could not set up the account.');
    } finally {
      setSubmitting(false);
    }
  };

  const cardStyle = {
    width: '100%', maxWidth: '440px', padding: '34px', borderRadius: '16px',
    background: 'var(--card-bg)', border: '1px solid var(--border-color)',
    boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
    display: 'flex', flexDirection: 'column', gap: '20px',
  };

  const inputStyle = {
    width: '100%', padding: '11px 12px', borderRadius: '8px',
    border: '1px solid var(--border-color)', background: 'var(--bg-panel, var(--bg-sidebar))',
    color: 'var(--text-main)', fontSize: '0.92rem', boxSizing: 'border-box',
  };

  const labelStyle = {
    display: 'block', fontSize: '0.78rem', fontWeight: '600',
    color: 'var(--text-dimmed)', marginBottom: '6px',
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px', background: 'var(--bg-main)',
    }}>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
          <Loader2 size={20} className="spin-icon" style={{ color: 'var(--primary)' }} />
          Checking your invitation…
        </div>
      ) : lookupError ? (
        <div style={cardStyle}>
          <div style={{
            width: '52px', height: '52px', borderRadius: '50%', margin: '0 auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(239,68,68,0.1)', color: '#ef4444',
          }}>
            <AlertTriangle size={26} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', margin: '0 0 8px' }}>
              This invitation is no longer valid
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.6', margin: 0 }}>
              {lookupError}
            </p>
          </div>
          <button className="upgrade-btn" onClick={onGoToLogin} style={{ padding: '12px', width: '100%' }}>
            Go to sign in
          </button>
        </div>
      ) : (
        <form style={cardStyle} onSubmit={submit}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '50%', margin: '0 auto 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--primary-soft)', color: 'var(--primary)',
            }}>
              <UserPlus size={26} />
            </div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '700', margin: '0 0 8px' }}>
              Join {invite.invitedBy}
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.6', margin: 0 }}>
              You have been invited to work on this WhatsApp account as an agent.
              Choose a password and you are in.
            </p>
          </div>

          {error && (
            <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {error}
            </div>
          )}

          {/* Fixed: the account is tied to the address the supervisor invited, so
              changing it here would be meaningless. */}
          <div>
            <label style={labelStyle} htmlFor="invite-signin-email">You will sign in with</label>
            <input id="invite-signin-email" readOnly value={invite.email}
              style={{ ...inputStyle, color: 'var(--text-muted)', cursor: 'not-allowed' }} />
          </div>

          <div>
            <label style={labelStyle} htmlFor="invite-accept-name">Your name</label>
            <input id="invite-accept-name" style={inputStyle} value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="How colleagues will see you" />
          </div>

          <div>
            <label style={labelStyle} htmlFor="invite-accept-password">Choose a password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="invite-accept-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoFocus
                style={{ ...inputStyle, paddingRight: '42px' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', color: 'var(--text-dimmed)',
                  cursor: 'pointer', display: 'flex', padding: 0,
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label style={labelStyle} htmlFor="invite-accept-confirm">Confirm password</label>
            <input
              id="invite-accept-confirm"
              type={showPassword ? 'text' : 'password'}
              required
              style={inputStyle}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="upgrade-btn" disabled={submitting}
            style={{ padding: '13px', width: '100%', opacity: submitting ? 0.6 : 1 }}>
            {submitting ? 'Setting up…' : 'Set password and sign in'}
          </button>

          <p style={{ fontSize: '0.76rem', color: 'var(--text-dimmed)', textAlign: 'center', margin: 0, lineHeight: '1.5' }}>
            Only you will know this password. The person who invited you cannot see it.
          </p>
        </form>
      )}
    </div>
  );
}
