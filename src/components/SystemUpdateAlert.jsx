import React, { useState, useEffect } from 'react';
import { RefreshCw, X, AlertTriangle, Sparkles } from 'lucide-react';
import { logout as apiLogout } from '../utils/api.js';

export default function SystemUpdateAlert({ announcement, onDismiss }) {
  const [dismissed, setDismissed] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // If announcement changed or re-broadcasted, reset dismissal
  useEffect(() => {
    setDismissed(false);
  }, [announcement?.updatedAt, announcement?.createdAt]);

  if (!announcement || !announcement.active || dismissed) {
    return null;
  }

  const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  const handleHardRefreshAndRelogin = async () => {
    setLoggingOut(true);
    try {
      // Clear client storage & caches
      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          const cacheKeys = await window.caches.keys();
          await Promise.all(cacheKeys.map(key => window.caches.delete(key)));
        } catch (cErr) {
          console.warn('[SystemUpdate] Failed to clear browser caches:', cErr);
        }
      }

      // Logout API (clears access & refresh tokens)
      await apiLogout();

      // Force navigate to login with updated query flag
      window.location.href = '/login?updated=true&t=' + Date.now();
    } catch (err) {
      console.error('[SystemUpdate] Error logging out:', err);
      // Fallback
      window.location.href = '/login?updated=true';
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        maxWidth: '480px',
        width: 'calc(100vw - 48px)',
        zIndex: 99999,
        borderRadius: '16px',
        background: 'linear-gradient(135deg, rgba(17, 24, 39, 0.96), rgba(30, 41, 59, 0.98))',
        border: '1.5px solid rgba(245, 158, 11, 0.5)',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 24px rgba(245, 158, 11, 0.25)',
        backdropFilter: 'blur(16px)',
        padding: '20px',
        color: '#f8fafc',
        animation: 'slideUpBounce 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.2)',
              color: '#fbbf24',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 0 12px rgba(245, 158, 11, 0.3)',
            }}
          >
            <Sparkles size={18} />
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: '700', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{announcement.title || 'Pembaruan Sistem Tersedia'}</span>
              {announcement.version && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 7px',
                    borderRadius: '6px',
                    background: 'rgba(245, 158, 11, 0.2)',
                    color: '#fde68a',
                    fontWeight: '600',
                  }}
                >
                  {announcement.version}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '1px' }}>
              Pemberitahuan Resmi Sistem OmniReach
            </div>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          title="Tutup pemberitahuan"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color 0.15s',
          }}
        >
          <X size={18} />
        </button>
      </div>

      {/* Message Body */}
      <div style={{ marginTop: '12px', fontSize: '0.86rem', color: '#e2e8f0', lineHeight: '1.5' }}>
        {announcement.message}
      </div>

      {/* Keyboard Shortcut Highlight Box */}
      <div
        style={{
          marginTop: '14px',
          padding: '10px 14px',
          borderRadius: '10px',
          background: 'rgba(0, 0, 0, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ fontSize: '0.78rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span>Lakukan Hard Refresh:</span>
          {isMac ? (
            <>
              <kbd style={{ padding: '2px 7px', borderRadius: '4px', background: '#334155', color: '#f8fafc', fontSize: '0.75rem', fontWeight: '700', border: '1px solid #475569', boxShadow: '0 2px 0 #1e293b' }}>⌘ Cmd</kbd>
              <span>+</span>
              <kbd style={{ padding: '2px 7px', borderRadius: '4px', background: '#334155', color: '#f8fafc', fontSize: '0.75rem', fontWeight: '700', border: '1px solid #475569', boxShadow: '0 2px 0 #1e293b' }}>⇧ Shift</kbd>
              <span>+</span>
              <kbd style={{ padding: '2px 7px', borderRadius: '4px', background: '#334155', color: '#f8fafc', fontSize: '0.75rem', fontWeight: '700', border: '1px solid #475569', boxShadow: '0 2px 0 #1e293b' }}>R</kbd>
            </>
          ) : (
            <>
              <kbd style={{ padding: '2px 7px', borderRadius: '4px', background: '#334155', color: '#f8fafc', fontSize: '0.75rem', fontWeight: '700', border: '1px solid #475569', boxShadow: '0 2px 0 #1e293b' }}>Ctrl</kbd>
              <span>+</span>
              <kbd style={{ padding: '2px 7px', borderRadius: '4px', background: '#334155', color: '#f8fafc', fontSize: '0.75rem', fontWeight: '700', border: '1px solid #475569', boxShadow: '0 2px 0 #1e293b' }}>Shift</kbd>
              <span>+</span>
              <kbd style={{ padding: '2px 7px', borderRadius: '4px', background: '#334155', color: '#f8fafc', fontSize: '0.75rem', fontWeight: '700', border: '1px solid #475569', boxShadow: '0 2px 0 #1e293b' }}>R</kbd>
            </>
          )}
        </div>
        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
          *Tekan kombinasi tombol ini sebelum atau setelah login agar script browser ter-update.
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
        <button
          type="button"
          onClick={handleDismiss}
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#94a3b8',
            fontSize: '0.82rem',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Nanti Saja
        </button>

        <button
          type="button"
          onClick={handleHardRefreshAndRelogin}
          disabled={loggingOut}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: '#000',
            border: 'none',
            fontSize: '0.82rem',
            fontWeight: '700',
            cursor: loggingOut ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 14px rgba(245, 158, 11, 0.4)',
          }}
        >
          <RefreshCw size={14} className={loggingOut ? 'spinning' : ''} />
          {loggingOut ? 'Memproses...' : 'Logout & Refresh Sekarang'}
        </button>
      </div>
    </div>
  );
}
