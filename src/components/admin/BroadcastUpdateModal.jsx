import React, { useState } from 'react';
import { Megaphone, RefreshCw, X, AlertCircle, CheckCircle2, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import { adminBroadcastUpdate, adminClearBroadcastUpdate } from '../../utils/api.js';

export default function BroadcastUpdateModal({ isOpen, onClose, activeAnnouncement, onAnnouncementChanged }) {
  const [title, setTitle] = useState(activeAnnouncement?.title || 'Pembaruan Sistem Tersedia');
  const [message, setMessage] = useState(
    activeAnnouncement?.message ||
    'Kami baru saja merilis pembaruan sistem dengan fitur dan perbaikan terbaru. Silakan tekan Ctrl + Shift + R (Hard Refresh) di browser Anda, lalu login ulang untuk memuat versi terbaru.'
  );
  const [version, setVersion] = useState(activeAnnouncement?.version || 'v3.0.0');
  const [forceRelogin, setForceRelogin] = useState(
    activeAnnouncement?.forceRelogin !== undefined ? activeAnnouncement.forceRelogin : true
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  if (!isOpen) return null;

  const isMac = typeof window !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

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
    <div className="broadcast-modal-backdrop" onClick={onClose}>
      <div className="broadcast-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="broadcast-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: 'var(--primary-soft, #f0f3fc)',
                color: 'var(--primary, #3f67d8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(63, 103, 216, 0.15)',
              }}
            >
              <Megaphone size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main, #0f172a)' }}>
                Broadcast System Update
              </h3>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted, #64748b)' }}>
                Beri notifikasi realtime ke semua pengguna untuk Hard Refresh (Ctrl+Shift+R) & Login Ulang
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup modal"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-dimmed, #94a3b8)',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Active status banner */}
          {activeAnnouncement?.active ? (
            <div className="broadcast-status-banner-active">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#16a34a', boxShadow: '0 0 10px rgba(22, 163, 74, 0.6)' }} />
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: '700', color: '#15803d' }}>
                    Siaran Sedang Aktif
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)' }}>
                    Aktif sejak: {new Date(activeAnnouncement.updatedAt || activeAnnouncement.createdAt).toLocaleString('id-ID')}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClear}
                disabled={submitting}
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#dc2626',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: '700',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s',
                }}
              >
                <Trash2 size={13} /> Tarik Pengumuman
              </button>
            </div>
          ) : (
            <div className="broadcast-status-banner-inactive">
              <AlertCircle size={16} style={{ color: 'var(--text-muted, #64748b)', flexShrink: 0 }} />
              Saat ini tidak ada siaran pengumuman pembaruan yang aktif.
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '10px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
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
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                color: '#15803d',
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
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main, #0f172a)', marginBottom: '6px' }}>
                  Judul Pemberitahuan
                </label>
                <input
                  type="text"
                  className="broadcast-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Pembaruan Sistem Tersedia"
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main, #0f172a)', marginBottom: '6px' }}>
                  Versi (Opsional)
                </label>
                <input
                  type="text"
                  className="broadcast-input"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="v3.0.0"
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main, #0f172a)', marginBottom: '6px' }}>
                Pesan Notifikasi
              </label>
              <textarea
                rows={4}
                className="broadcast-input"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tulis pesan petunjuk hard refresh dan login ulang..."
                required
                style={{ lineHeight: '1.5', resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                id="forceReloginCheck"
                checked={forceRelogin}
                onChange={(e) => setForceRelogin(e.target.checked)}
                style={{ width: '17px', height: '17px', accentColor: 'var(--primary, #3f67d8)', cursor: 'pointer' }}
              />
              <label htmlFor="forceReloginCheck" style={{ fontSize: '0.86rem', color: 'var(--text-main, #1e293b)', cursor: 'pointer', userSelect: 'none' }}>
                Sertakan tombol langsung <strong>"Logout & Refresh Sekarang"</strong> (Membersihkan cache dan redirect ke login)
              </label>
            </div>

            {/* Live Preview */}
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted, #64748b)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={14} style={{ color: 'var(--primary, #3f67d8)' }} />
                Preview Tampilan Pengguna:
              </div>
              <div className="broadcast-preview-box">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '34px',
                        height: '34px',
                        borderRadius: '8px',
                        background: 'rgba(245, 158, 11, 0.2)',
                        color: '#d97706',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <RefreshCw size={17} />
                    </div>
                    <div>
                      <div style={{ fontSize: '0.94rem', fontWeight: '700', color: '#b45309' }}>
                        {title || 'Pembaruan Sistem Tersedia'}
                        {version && (
                          <span style={{ marginLeft: '8px', fontSize: '0.72rem', padding: '2px 7px', borderRadius: '4px', background: '#ffffff', color: '#b45309', border: '1px solid #fde68a', fontWeight: '700' }}>
                            {version}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.84rem', color: 'var(--text-main, #1e293b)', marginTop: '4px', lineHeight: '1.45' }}>
                        {message}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Keyboard Shortcut Highlight */}
                <div className="broadcast-preview-kbd-row">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text-main, #1e293b)' }}>
                    <span>Tekan tombol:</span>
                    <kbd className="broadcast-kbd-tag">{isMac ? '⌘ Cmd' : 'Ctrl'}</kbd>
                    <span>+</span>
                    <kbd className="broadcast-kbd-tag">{isMac ? '⇧ Shift' : 'Shift'}</kbd>
                    <span>+</span>
                    <kbd className="broadcast-kbd-tag">R</kbd>
                  </div>
                  {forceRelogin && (
                    <button
                      type="button"
                      style={{
                        padding: '6px 14px',
                        borderRadius: '6px',
                        background: '#f59e0b',
                        color: '#ffffff',
                        fontSize: '0.78rem',
                        fontWeight: '700',
                        border: 'none',
                        cursor: 'default',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        boxShadow: '0 2px 6px rgba(245, 158, 11, 0.35)',
                      }}
                    >
                      <RefreshCw size={12} /> Logout & Refresh Sekarang
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Submit Actions */}
            <div className="broadcast-modal-footer" style={{ margin: '0 -24px -24px -24px', borderRadius: '0 0 16px 16px' }}>
              <button
                type="button"
                className="broadcast-btn-cancel"
                onClick={onClose}
                disabled={submitting}
              >
                Tutup
              </button>
              <button
                type="submit"
                className="broadcast-btn-submit"
                disabled={submitting}
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
