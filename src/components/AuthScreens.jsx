import React, { useState } from 'react';
import { auth, db } from '../utils/firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { MessageSquare, Mail, Lock, User, ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { isAdminEmail } from '../utils/adminAccess.js';
import { defaultPlanForSignup } from '../utils/plans.js';

export default function AuthScreens({ type, onSwitchType, onBackToHome, onAuthSuccess }) {
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
      if (type === 'login') {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        onAuthSuccess(credential.user);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Admin status comes from the shared allow-list, which matches
        // isAdminEmail() in firestore.rules. The old "any @admin.com address"
        // wildcard disagreed with the rules, so those signups built a profile
        // the rules then refused to write.
        const isAdmin = isAdminEmail(email);

        // New accounts inherit their limits from the default plan rather than
        // storing a copy of them, so raising a plan's quota later applies here
        // too. messageLimit / sessionLimit are written only as admin overrides.
        const plan = await defaultPlanForSignup();
        const planId = isAdmin ? 'premium' : plan.id;

        // Create user document in Firestore
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          name: name,
          email: email,
          role: isAdmin ? 'admin' : 'customer',
          isApproved: isAdmin ? true : false,
          planId,
          // `tier` predates plans and is still read for free-tier gating in the
          // customer dashboard, so it is kept in sync with planId.
          tier: planId,
          messagesSent: 0,
          createdAt: serverTimestamp(),
        });

        onAuthSuccess(user);
      }
    } catch (err) {
      console.error('Auth error:', err);
      if (err.code === 'auth/email-already-in-use') {
        setError('This email is already in use.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters.');
      } else if (err.code === 'auth/invalid-credential') {
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
          <MessageSquare size={36} />
        </div>

        <h2 className="connection-title" style={{ marginBottom: '8px' }}>
          {type === 'login' ? 'Welcome Back' : 'Create Account'}
        </h2>
        <p className="connection-subtitle" style={{ marginBottom: '24px' }}>
          {type === 'login' 
            ? 'Sign in to access your multi-agent inbox.' 
            : 'Register to connect and share your WhatsApp Business number.'}
        </p>

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
