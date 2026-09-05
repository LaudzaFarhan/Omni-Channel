import React, { useState } from 'react';
import { Megaphone, RefreshCw, X, AlertCircle, CheckCircle2, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import { adminBroadcastUpdate, adminClearBroadcastUpdate } from '../../utils/api.js';

export default function BroadcastUpdateModal({ isOpen, onClose, activeAnnouncement, onAnnouncementChanged }) {
  const [title, setTitle] = useState(activeAnnouncement?.title || 'Pembaruan Sistem Tersedia');
  const [message, setMessage] = useState(
    activeAnnouncement?.message ||
    'Kami baru saja merilis pembaruan sistem dengan fitur dan perbaikan terbaru. Silakan tekan Ctrl + Shift + R (Hard Refresh) di browser Anda, lalu login ulang untuk memuat versi terbaru.'
  );
  const [version, setVersion] = useState(activeAnnouncement?.version || '');
  const [forceRelogin, setForceRelogin] = useState(
    activeAnnouncement?.forceRelogin !== undefined ? activeAnnouncement.forceRelogin : true
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  if (!isOpen) return null;

  const handleBroadcast = async (e) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      setError('Judul dan pesan pengumuman wajib diisi.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await adminBroadcastUpdate({
        title: title.trim(),
        message: message.trim(),
        version: version.trim() || undefined,
        forceRelogin,
      });

      setSuccessMsg('Pengumuman pembaruan berhasil disiarkan ke semua pengguna!');
      if (onAnnouncementChanged) {
        onAnnouncementChanged(res.announcement);
      }
      setTimeout(() => {
        setSuccessMsg(null);
      }, 3000);
    } catch (err) {
      console.error('[Admin] Broadcast update failed:', err);
      setError(err.message || 'Gagal mengirim pengumuman.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Yakin ingin menarik / menghapus pengumuman pembaruan saat ini?')) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await adminClearBroadcastUpdate();
      setSuccessMsg('Pengumuman pembaruan telah dinonaktifkan.');
      if (onAnnouncementChanged) {
        onAnnouncementChanged(null);
      }
      setTimeout(() => {
        setSuccessMsg(null);
      }, 2500);
    } catch (err) {
      console.error('[Admin] Clear broadcast failed:', err);
      setError(err.message || 'Gagal menarik pengumuman.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '620px',
          background: 'var(--bg-card, #131b24)',
          border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
          borderRadius: '16px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'linear-gradient(135deg, rgba(37, 211, 102, 0.08), rgba(6, 182, 212, 0.05))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: 'rgba(37, 211, 102, 0.15)',
                color: 'var(--primary, #25d366)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Megaphone size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main, #f1f5f9)' }}>
                Broadcast System Update
              </h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dimmed, #94a3b8)' }}>
                Beri notifikasi realtime ke semua pengguna untuk Hard Refresh (Ctrl+Shift+R) & Login Ulang
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dimmed, #94a3b8)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active status banner */}
          {activeAnnouncement?.active ? (
            <div
              style={{
                padding: '14px 18px',
                borderRadius: '10px',
                background: 'rgba(37, 211, 102, 0.08)',
                border: '1px solid rgba(37, 211, 102, 0.25)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 10px #22c55e' }} />
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: '600', color: '#22c55e' }}>
                    Siaran Sedang Aktif
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dimmed, #94a3b8)' }}>
                    Aktif sejak: {new Date(activeAnnouncement.updatedAt || activeAnnouncement.createdAt).toLocaleString('id-ID')}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClear}
                disabled={submitting}
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Trash2 size={13} /> Tarik Pengumuman
              </button>
            </div>
          ) : (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                fontSize: '0.82rem',
                color: 'var(--text-dimmed, #94a3b8)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertCircle size={15} style={{ color: 'var(--text-dimmed)' }} />
              Saat ini tidak ada siaran pengumuman pembaruan yang aktif.
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <ShieldAlert size={16} />
              {error}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: 'rgba(34, 197, 94, 0.12)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                color: '#4ade80',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CheckCircle2 size={16} />
              {successMsg}
            </div>
          )}

          <form onSubmit={handleBroadcast} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main, #f1f5f9)', marginBottom: '6px' }}>
                  Judul Pemberitahuan
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Pembaruan Sistem Tersedia"
                  required
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-main, #f1f5f9)',
                    fontSize: '0.88rem',
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main, #f1f5f9)', marginBottom: '6px' }}>
                  Versi (Opsional)
                </label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="v2.4.0"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-main, #f1f5f9)',
                    fontSize: '0.88rem',
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main, #f1f5f9)', marginBottom: '6px' }}>
                Pesan Notifikasi
              </label>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tulis pesan petunjuk hard refresh dan login ulang..."
                required
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-main, #f1f5f9)',
                  fontSize: '0.88rem',
                  lineHeight: '1.45',
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                id="forceReloginCheck"
                checked={forceRelogin}
                onChange={(e) => setForceRelogin(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: 'var(--primary, #25d366)', cursor: 'pointer' }}
              />
              <label htmlFor="forceReloginCheck" style={{ fontSize: '0.85rem', color: 'var(--text-main, #f1f5f9)', cursor: 'pointer', userSelect: 'none' }}>
                Sertakan tombol langsung <strong>"Logout & Refresh Sekarang"</strong> (Membersihkan cache dan redirect ke login)
              </label>
            </div>

            {/* Live Preview */}
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dimmed, #94a3b8)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={13} style={{ color: '#06b6d4' }} />
                Preview Tampilan Pengguna:
              </div>
              <div
                style={{
                  padding: '16px 20px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(6, 182, 212, 0.08))',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: 'rgba(245, 158, 11, 0.2)',
                        color: '#f59e0b',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <RefreshCw size={17} />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.92rem', fontWeight: '700', color: '#fbbf24' }}>
                        {title || 'Pembaruan Sistem Tersedia'}
                        {version && (
                          <span style={{ marginLeft: '8px', fontSize: '0.72rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: '#fff' }}>
                            {version}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#e2e8f0', marginTop: '4px', lineHeight: '1.4' }}>
                        {message}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Keyboard Shortcut Highlight */}
                <div
                  style={{
                    marginTop: '12px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: 'rgba(0,0,0,0.25)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#cbd5e1' }}>
                    <span>Tekan tombol:</span>
                    <kbd style={{ padding: '2px 7px', borderRadius: '4px', background: '#334155', color: '#f8fafc', fontSize: '0.75rem', fontWeight: '700', border: '1px solid #475569' }}>Ctrl</kbd>
                    <span>+</span>
                    <kbd style={{ padding: '2px 7px', borderRadius: '4px', background: '#334155', color: '#f8fafc', fontSize: '0.75rem', fontWeight: '700', border: '1px solid #475569' }}>Shift</kbd>
                    <span>+</span>
                    <kbd style={{ padding: '2px 7px', borderRadius: '4px', background: '#334155', color: '#f8fafc', fontSize: '0.75rem', fontWeight: '700', border: '1px solid #475569' }}>R</kbd>
                  </div>
                  {forceRelogin && (
                    <button
                      type="button"
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        background: '#f59e0b',
                        color: '#000',
                        fontSize: '0.78rem',
                        fontWeight: '700',
                        border: 'none',
                        cursor: 'default',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <RefreshCw size={12} /> Logout & Refresh Sekarang
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Submit Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px', paddingTop: '16px', borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  background: 'transparent',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
                  color: 'var(--text-dimmed, #94a3b8)',
                  fontSize: '0.88rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  padding: '10px 22px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #25d366, #10b981)',
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.88rem',
                  fontWeight: '700',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 14px rgba(37, 211, 102, 0.35)',
                }}
              >
                <Megaphone size={16} />
                {submitting ? 'Menyiarkan...' : 'Kirim Siaran ke Semua Pengguna'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
