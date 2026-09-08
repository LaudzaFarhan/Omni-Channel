import React, { useState, useEffect } from 'react';
import { RefreshCw, X, Sparkles, CheckCircle2 } from 'lucide-react';
import { verifySystemAnnouncement, checkUserAnnouncementVerified } from '../utils/api.js';
import { clearCachesAndReload } from '../utils/autoUpdater.js';

export default function SystemUpdateAlert({ announcement, onDismiss }) {
  const [dismissed, setDismissed] = useState(false);
  const [verified, setVerified] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Check if current user already verified this announcement
  useEffect(() => {
    let cancelled = false;
    setDismissed(false);
    setVerified(false);

    checkUserAnnouncementVerified().then((hasVerified) => {
      if (!cancelled && hasVerified) {
        setVerified(true);
      }
    });

    return () => { cancelled = true; };
  }, [announcement?.updatedAt, announcement?.createdAt]);

  if (!announcement || !announcement.active || dismissed || verified) {
    return null;
  }

  const handleUpdateNow = async () => {
    setUpdating(true);
    try {
      await verifySystemAnnouncement();
    } catch (err) {
      console.warn('[SystemUpdate] Failed to record verification:', err);
    }
    // Seamless reload without logging out the customer
    clearCachesAndReload();
  };

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  };

  const handleVerify = async () => {
    setVerifying(true);
    try {
      await verifySystemAnnouncement();
      setVerified(true);
      setDismissed(true);
      if (onDismiss) onDismiss();
    } catch (err) {
      console.error('[SystemUpdate] Verification error:', err);
      setDismissed(true);
    } finally {
      setVerifying(false);
    }
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

      {/* Info Notice Box */}
      <div
        style={{
          marginTop: '14px',
          padding: '10px 14px',
          borderRadius: '10px',
          background: 'rgba(37, 99, 235, 0.06)',
          border: '1px solid rgba(37, 99, 235, 0.15)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <Sparkles size={15} style={{ color: 'var(--primary, #2563eb)', flexShrink: 0 }} />
        <div style={{ fontSize: '0.8rem', color: 'var(--text-main, #1e293b)' }}>
          Klik tombol <strong>Perbarui Sekarang</strong> untuk memuat fitur & perbaikan terbaru secara instan tanpa perlu logout.
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleDismiss}
          className="broadcast-btn-cancel"
          style={{ padding: '8px 12px', fontSize: '0.82rem' }}
        >
          Nanti Saja
        </button>

        <button
          type="button"
          onClick={handleVerify}
          disabled={verifying || updating}
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            background: 'var(--bg-card, #ffffff)',
            color: 'var(--text-main, #334155)',
            border: '1px solid var(--border-color, #e2e8f0)',
            fontSize: '0.82rem',
            fontWeight: '600',
            cursor: verifying ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s',
          }}
        >
          <CheckCircle2 size={15} style={{ color: 'var(--success, #10b981)' }} />
          {verifying ? 'Menyimpan...' : 'Tandai Selesai'}
        </button>

        <button
          type="button"
          onClick={handleUpdateNow}
          disabled={updating || verifying}
          style={{
            padding: '8px 18px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, var(--primary, #2563eb), #1d4ed8)',
            color: '#ffffff',
            border: 'none',
            fontSize: '0.82rem',
            fontWeight: '700',
            cursor: updating ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
            transition: 'all 0.15s',
          }}
        >
          <RefreshCw size={14} className={updating ? 'spinning' : ''} />
          {updating ? 'Memuat Versi Baru...' : 'Perbarui Sekarang'}
        </button>
      </div>
    </div>
  );
}
