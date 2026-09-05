import React, { useState, useEffect } from 'react';
import { RefreshCw, X, Sparkles } from 'lucide-react';
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
      className="system-update-card"
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.18)',
              color: '#d97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(245, 158, 11, 0.25)',
            }}
          >
            <Sparkles size={18} />
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: '700', color: '#b45309', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{announcement.title || 'Pembaruan Sistem Tersedia'}</span>
              {announcement.version && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '2px 7px',
                    borderRadius: '6px',
                    background: '#fef3c7',
                    color: '#b45309',
                    border: '1px solid #fde68a',
                    fontWeight: '700',
                  }}
                >
                  {announcement.version}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)', marginTop: '2px' }}>
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
            color: 'var(--text-dimmed, #94a3b8)',
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
      <div style={{ marginTop: '12px', fontSize: '0.88rem', color: 'var(--text-main, #1e293b)', lineHeight: '1.5' }}>
        {announcement.message}
      </div>

      {/* Keyboard Shortcut Highlight Box */}
      <div
        style={{
          marginTop: '14px',
          padding: '10px 14px',
          borderRadius: '10px',
          background: 'var(--warning-soft, #fef3e2)',
          border: '1px solid var(--warning-border, #fde68a)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ fontSize: '0.82rem', color: 'var(--text-main, #1e293b)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: '600' }}>Lakukan Hard Refresh:</span>
          <kbd className="broadcast-kbd-tag">{isMac ? '⌘ Cmd' : 'Ctrl'}</kbd>
          <span>+</span>
          <kbd className="broadcast-kbd-tag">{isMac ? '⇧ Shift' : 'Shift'}</kbd>
          <span>+</span>
          <kbd className="broadcast-kbd-tag">R</kbd>
        </div>
        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted, #64748b)' }}>
          *Tekan kombinasi tombol ini sebelum atau setelah login agar browser memuat aset terbaru.
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px' }}>
        <button
          type="button"
          onClick={handleDismiss}
          className="broadcast-btn-cancel"
          style={{ padding: '8px 14px', fontSize: '0.82rem' }}
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
            color: '#ffffff',
            border: 'none',
            fontSize: '0.82rem',
            fontWeight: '700',
            cursor: loggingOut ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
            transition: 'all 0.15s',
          }}
        >
          <RefreshCw size={14} className={loggingOut ? 'spinning' : ''} />
          {loggingOut ? 'Memproses...' : 'Logout & Refresh Sekarang'}
        </button>
      </div>
    </div>
  );
}
