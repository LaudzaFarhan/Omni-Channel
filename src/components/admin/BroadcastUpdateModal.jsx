import React, { useState, useEffect, useMemo } from 'react';
import {
  Megaphone,
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
  Search,
  Clock,
  Laptop,
} from 'lucide-react';
import {
  adminBroadcastUpdate,
  adminClearBroadcastUpdate,
  fetchAnnouncementVerifications,
} from '../../utils/api.js';
import { subscribeSocket } from '../../utils/socket.js';

function getInitials(name, email) {
  const source = (name || email || 'U').trim();
  const parts = source.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function parseUserAgent(ua) {
  if (!ua) return 'Desktop / Browser';
  let os = 'Unknown OS';
  if (/windows nt 10/i.test(ua)) os = 'Windows 10/11';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  return `${browser} • ${os}`;
}

function formatVerifiedDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(dateStr);
  }
}

export default function BroadcastUpdateModal({
  isOpen,
  onClose,
  activeAnnouncement,
  onAnnouncementChanged,
}) {
  const [activeTab, setActiveTab] = useState('form'); // 'form' | 'verified'
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

  // Verifications state
  const [verifiedUsers, setVerifiedUsers] = useState([]);
  const [loadingVerifications, setLoadingVerifications] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sync announcements changes
  useEffect(() => {
    if (activeAnnouncement) {
      if (activeAnnouncement.title) setTitle(activeAnnouncement.title);
      if (activeAnnouncement.message) setMessage(activeAnnouncement.message);
      if (activeAnnouncement.version) setVersion(activeAnnouncement.version);
      if (activeAnnouncement.forceRelogin !== undefined) setForceRelogin(activeAnnouncement.forceRelogin);
    }
  }, [activeAnnouncement]);

  // Fetch verified users and listen to realtime updates
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    const loadVerifications = async () => {
      setLoadingVerifications(true);
      try {
        const list = await fetchAnnouncementVerifications();
        if (mounted) {
          setVerifiedUsers(list || []);
        }
      } catch (err) {
        console.error('[Admin] Error fetching verifications:', err);
      } finally {
        if (mounted) {
          setLoadingVerifications(false);
        }
      }
    };

    loadVerifications();

    let attached = null;
    const handleVerifiedEvent = (entry) => {
      if (!entry || !entry.userId) return;
      setVerifiedUsers((prev) => {
        const exists = prev.some((u) => u.userId === entry.userId);
        if (exists) return prev;
        return [entry, ...prev];
      });
    };

    const unsubscribe = subscribeSocket((socket) => {
      if (attached) attached.off('system-update-verified', handleVerifiedEvent);
      attached = null;
      if (socket) {
        socket.on('system-update-verified', handleVerifiedEvent);
        attached = socket;
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
      if (attached) attached.off('system-update-verified', handleVerifiedEvent);
    };
  }, [isOpen]);

  const handleRefreshVerifications = async () => {
    setLoadingVerifications(true);
    try {
      const list = await fetchAnnouncementVerifications();
      setVerifiedUsers(list || []);
    } catch (err) {
      console.error('[Admin] Refresh verifications failed:', err);
    } finally {
      setLoadingVerifications(false);
    }
  };

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return verifiedUsers;
    const q = searchQuery.toLowerCase().trim();
    return verifiedUsers.filter(
      (u) =>
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q))
    );
  }, [verifiedUsers, searchQuery]);

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

      setVerifiedUsers([]); // Reset verifications for new broadcast
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
      setVerifiedUsers([]);
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
                Beri notifikasi realtime ke semua pengguna & pantau yang sudah verify
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

        {/* Tab Navigation */}
        <div className="broadcast-tabs-nav">
          <button
            type="button"
            className={`broadcast-tab-btn ${activeTab === 'form' ? 'active' : ''}`}
            onClick={() => setActiveTab('form')}
          >
            <Megaphone size={16} />
            Kirim Siaran
          </button>
          <button
            type="button"
            className={`broadcast-tab-btn ${activeTab === 'verified' ? 'active-verified' : ''}`}
            onClick={() => setActiveTab('verified')}
          >
            <CheckCircle2 size={16} />
            Sudah Verify
            <span
              style={{
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.75rem',
                fontWeight: '700',
                background: activeTab === 'verified' ? '#d1fae5' : 'var(--border-color, #e2e8f0)',
                color: activeTab === 'verified' ? '#065f46' : 'var(--text-main, #0f172a)',
                transition: 'all 0.15s',
              }}
            >
              {verifiedUsers.length}
            </span>
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

          {/* TAB 1: FORM SIARAN */}
          {activeTab === 'form' && (
            <>
              {/* Active status banner */}
              {activeAnnouncement?.active ? (
                <div className="broadcast-status-banner-active">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: '#16a34a',
                        boxShadow: '0 0 10px rgba(22, 163, 74, 0.6)',
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: '700', color: '#15803d' }}>
                        Siaran Sedang Aktif
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)' }}>
                        Aktif sejak:{' '}
                        {new Date(
                          activeAnnouncement.updatedAt || activeAnnouncement.createdAt
                        ).toLocaleString('id-ID')}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => setActiveTab('verified')}
                      style={{
                        background: '#ecfdf5',
                        border: '1px solid #a7f3d0',
                        color: '#059669',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: '700',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.15s',
                      }}
                    >
                      <CheckCircle2 size={14} />
                      {verifiedUsers.length} Sudah Verify
                    </button>
                    <button
                      type="button"
                      onClick={handleClear}
                      disabled={submitting}
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#dc2626',
                        padding: '6px 12px',
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
                </div>
              ) : (
                <div className="broadcast-status-banner-inactive">
                  <AlertCircle size={16} style={{ color: 'var(--text-muted, #64748b)', flexShrink: 0 }} />
                  Saat ini tidak ada siaran pengumuman pembaruan yang aktif.
                </div>
              )}

              <form onSubmit={handleBroadcast} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px' }}>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        color: 'var(--text-main, #0f172a)',
                        marginBottom: '6px',
                      }}
                    >
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
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        color: 'var(--text-main, #0f172a)',
                        marginBottom: '6px',
                      }}
                    >
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
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: 'var(--text-main, #0f172a)',
                      marginBottom: '6px',
                    }}
                  >
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
                  <label
                    htmlFor="forceReloginCheck"
                    style={{
                      fontSize: '0.86rem',
                      color: 'var(--text-main, #1e293b)',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    Sertakan tombol langsung <strong>"Logout & Refresh Sekarang"</strong> (Membersihkan cache dan redirect ke login)
                  </label>
                </div>

                {/* Live Preview */}
                <div>
                  <div
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: '700',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--text-muted, #64748b)',
                      marginBottom: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
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
                              <span
                                style={{
                                  marginLeft: '8px',
                                  fontSize: '0.72rem',
                                  padding: '2px 7px',
                                  borderRadius: '4px',
                                  background: '#ffffff',
                                  color: '#b45309',
                                  border: '1px solid #fde68a',
                                  fontWeight: '700',
                                }}
                              >
                                {version}
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: '0.84rem',
                              color: 'var(--text-main, #1e293b)',
                              marginTop: '4px',
                              lineHeight: '1.45',
                            }}
                          >
                            {message}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Keyboard Shortcut Highlight & Action Preview */}
                    <div className="broadcast-preview-kbd-row">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '0.82rem',
                          color: 'var(--text-main, #1e293b)',
                        }}
                      >
                        <span>Shortcut:</span>
                        <kbd className="broadcast-kbd-tag">{isMac ? '⌘ Cmd' : 'Ctrl'}</kbd>
                        <span>+</span>
                        <kbd className="broadcast-kbd-tag">{isMac ? '⇧ Shift' : 'Shift'}</kbd>
                        <span>+</span>
                        <kbd className="broadcast-kbd-tag">R</kbd>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            background: '#10b981',
                            color: '#ffffff',
                            fontSize: '0.76rem',
                            fontWeight: '700',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <CheckCircle2 size={12} /> Sudah Verify
                        </span>
                        {forceRelogin && (
                          <span
                            style={{
                              padding: '4px 10px',
                              borderRadius: '6px',
                              background: '#f59e0b',
                              color: '#ffffff',
                              fontSize: '0.76rem',
                              fontWeight: '700',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <RefreshCw size={11} /> Logout & Refresh
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Submit Actions */}
                <div
                  className="broadcast-modal-footer"
                  style={{ margin: '0 -24px -24px -24px', borderRadius: '0 0 16px 16px' }}
                >
                  <button
                    type="button"
                    className="broadcast-btn-cancel"
                    onClick={onClose}
                    disabled={submitting}
                  >
                    Tutup
                  </button>
                  <button type="submit" className="broadcast-btn-submit" disabled={submitting}>
                    <Megaphone size={16} />
                    {submitting ? 'Menyiarkan...' : 'Kirim Siaran ke Semua Pengguna'}
                  </button>
                </div>
              </form>
            </>
          )}

          {/* TAB 2: DAFTAR PENGGUNA SUDAH VERIFY */}
          {activeTab === 'verified' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Controls bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap',
                }}
              >
                {/* Search input */}
                <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
                  <Search
                    size={16}
                    style={{
                      position: 'absolute',
                      left: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted, #64748b)',
                    }}
                  />
                  <input
                    type="text"
                    className="broadcast-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari nama atau email pengguna..."
                    style={{ paddingLeft: '36px', height: '38px', fontSize: '0.84rem' }}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted, #64748b)',
                        cursor: 'pointer',
                        padding: '2px',
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className="broadcast-live-badge" title="Menerima data secara realtime melalui WebSocket">
                    <span className="broadcast-live-pulse" />
                    <span>Realtime Sync</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleRefreshVerifications}
                    disabled={loadingVerifications}
                    className="broadcast-btn-cancel"
                    style={{
                      padding: '8px 14px',
                      fontSize: '0.82rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <RefreshCw size={13} className={loadingVerifications ? 'spin' : ''} />
                    Refresh
                  </button>
                </div>
              </div>

              {/* Verified Users List / Table */}
              {filteredUsers.length === 0 ? (
                <div
                  style={{
                    padding: '48px 24px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '12px',
                    background: 'var(--bg-main, #f8fafc)',
                    borderRadius: '12px',
                    border: '1px dashed var(--border-color, #cbd5e1)',
                  }}
                >
                  <div
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      background: '#ecfdf5',
                      color: '#10b981',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CheckCircle2 size={24} />
                  </div>
                  <div style={{ fontSize: '0.96rem', fontWeight: '700', color: 'var(--text-main, #0f172a)' }}>
                    {searchQuery
                      ? 'Tidak ada pengguna yang cocok'
                      : 'Belum Ada Pengguna yang Klik "Sudah Verify"'}
                  </div>
                  <p
                    style={{
                      fontSize: '0.82rem',
                      color: 'var(--text-muted, #64748b)',
                      maxWidth: '440px',
                      margin: 0,
                      lineHeight: '1.5',
                    }}
                  >
                    {searchQuery
                      ? `Tidak ditemukan hasil untuk "${searchQuery}". Coba kata kunci lain.`
                      : 'Saat pengguna masuk dan mengklik tombol "Sudah Verify" pada popup pembaruan mereka, nama dan waktu konfirmasi akan muncul secara otomatis di daftar ini.'}
                  </p>
                </div>
              ) : (
                <div className="broadcast-table-container">
                  <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                    <table className="broadcast-table">
                      <thead>
                        <tr>
                          <th>Pengguna</th>
                          <th>Waktu Verifikasi</th>
                          <th>Perangkat / Browser</th>
                          <th style={{ textAlign: 'right' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((item, idx) => (
                          <tr key={item.userId || idx}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div className="broadcast-avatar-circle">
                                  {getInitials(item.name, item.email)}
                                </div>
                                <div>
                                  <div style={{ fontWeight: '700', color: 'var(--text-main, #0f172a)' }}>
                                    {item.name || 'User'}
                                  </div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted, #64748b)' }}>
                                    {item.email}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '0.82rem',
                                  color: 'var(--text-main, #334155)',
                                }}
                              >
                                <Clock size={13} style={{ color: 'var(--text-muted, #64748b)', flexShrink: 0 }} />
                                <span>{formatVerifiedDate(item.verifiedAt)}</span>
                              </div>
                            </td>
                            <td>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  fontSize: '0.8rem',
                                  color: 'var(--text-muted, #64748b)',
                                }}
                              >
                                <Laptop size={13} style={{ flexShrink: 0 }} />
                                <span>{parseUserAgent(item.userAgent)}</span>
                              </div>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '3px 9px',
                                  borderRadius: '6px',
                                  background: '#ecfdf5',
                                  border: '1px solid #a7f3d0',
                                  color: '#065f46',
                                  fontSize: '0.76rem',
                                  fontWeight: '700',
                                }}
                              >
                                <CheckCircle2 size={12} />
                                Verified
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tab Footer */}
              <div
                className="broadcast-modal-footer"
                style={{
                  margin: '8px -24px -24px -24px',
                  borderRadius: '0 0 16px 16px',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted, #64748b)' }}>
                  Total Terverifikasi:{' '}
                  <strong style={{ color: 'var(--text-main, #0f172a)' }}>{verifiedUsers.length}</strong>{' '}
                  pengguna
                </div>
                <button type="button" className="broadcast-btn-cancel" onClick={onClose}>
                  Tutup
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
