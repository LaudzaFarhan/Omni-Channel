import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Clock,
  TrendingUp,
  Crown,
  Users,
  Search,
  RefreshCw,
  Calendar,
  ChevronRight,
  X,
  Laptop,
  CheckCircle2,
  AlertCircle,
  BarChart2,
  ArrowUpDown,
  History,
} from 'lucide-react';
import { fetchTeamPresenceMetrics } from '../../utils/api.js';
import { subscribeSocket } from '../../utils/socket.js';

function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds < 0) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}j ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${totalSeconds}d`;
}

function getInitials(name, email) {
  const source = (name || email || 'U').trim();
  const parts = source.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function formatTime(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function formatFullDate(dateStr) {
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
    });
  } catch {
    return String(dateStr);
  }
}

export default function TeamPresenceMonitor() {
  const [period, setPeriod] = useState('today'); // 'today' | 'yesterday' | '7days' | '30days' | 'custom'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metricsData, setMetricsData] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'online' | 'away' | 'off'
  const [selectedMember, setSelectedMember] = useState(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTeamPresenceMetrics({
        period,
        startDate: period === 'custom' ? startDate : undefined,
        endDate: period === 'custom' ? endDate : undefined,
      });
      setMetricsData(res);
    } catch (err) {
      console.error('[PresenceMonitor] Error loading metrics:', err);
      setError(err.message || 'Gagal memuat data monitoring kehadiran tim.');
    } finally {
      setLoading(false);
    }
  }, [period, startDate, endDate]);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  // Subscribe to real-time socket events so active sessions update automatically
  useEffect(() => {
    let attached = null;
    const handlePresenceUpdate = () => {
      // Re-fetch metrics on socket presence update
      loadMetrics();
    };

    const unsubscribe = subscribeSocket((socket) => {
      if (attached) attached.off('team-presence-update', handlePresenceUpdate);
      attached = null;
      if (socket) {
        socket.on('team-presence-update', handlePresenceUpdate);
        attached = socket;
      }
    });

    return () => {
      unsubscribe();
      if (attached) attached.off('team-presence-update', handlePresenceUpdate);
    };
  }, [loadMetrics]);

  const summary = metricsData?.summary || {
    totalMembers: 0,
    onlineNowCount: 0,
    awayNowCount: 0,
    offNowCount: 0,
    totalTeamOnlineSec: 0,
    totalTeamAwaySec: 0,
    totalTeamOfflineSec: 0,
    avgOnlinePerMember: 0,
    mostActiveMember: null,
  };

  const members = metricsData?.members || [];

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const matchesSearch =
        !searchQuery.trim() ||
        (m.name && m.name.toLowerCase().includes(searchQuery.toLowerCase().trim())) ||
        (m.email && m.email.toLowerCase().includes(searchQuery.toLowerCase().trim()));

      const matchesStatus = statusFilter === 'all' || m.liveStatus === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [members, searchQuery, statusFilter]);

  const periodLabels = {
    today: 'Hari Ini',
    yesterday: 'Kemarin',
    '7days': '7 Hari Terakhir',
    '30days': '30 Hari Terakhir',
    custom: 'Rentang Kustom',
  };

  return (
    <div className="presence-monitor-container">
      {/* Top Header & Toolbar */}
      <div className="presence-monitor-header">
        <div>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '1.2rem', fontWeight: '800', color: 'var(--text-main)' }}>
            Monitor Jam Kerja & Kehadiran Tim
          </h3>
          <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)' }}>
            Pantau durasi waktu online, away, dan offline setiap anggota tim secara transparan per periode waktu.
          </p>
        </div>

        <div className="presence-controls-row">
          {/* Period Filter Buttons */}
          <div className="presence-period-buttons">
            <button
              type="button"
              className={`presence-period-btn ${period === 'today' ? 'active' : ''}`}
              onClick={() => setPeriod('today')}
            >
              Hari Ini
            </button>
            <button
              type="button"
              className={`presence-period-btn ${period === 'yesterday' ? 'active' : ''}`}
              onClick={() => setPeriod('yesterday')}
            >
              Kemarin
            </button>
            <button
              type="button"
              className={`presence-period-btn ${period === '7days' ? 'active' : ''}`}
              onClick={() => setPeriod('7days')}
            >
              7 Hari
            </button>
            <button
              type="button"
              className={`presence-period-btn ${period === '30days' ? 'active' : ''}`}
              onClick={() => setPeriod('30days')}
            >
              30 Hari
            </button>
            <button
              type="button"
              className={`presence-period-btn ${period === 'custom' ? 'active' : ''}`}
              onClick={() => setPeriod('custom')}
            >
              Kustom
            </button>
          </div>

          <button
            type="button"
            onClick={loadMetrics}
            disabled={loading}
            className="presence-refresh-btn"
            title="Refresh data kehadiran"
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Custom Date Range Picker Form (when custom period chosen) */}
      {period === 'custom' && (
        <div className="presence-custom-date-box">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: '600', color: 'var(--text-main)' }}>
            <Calendar size={15} style={{ color: 'var(--primary)' }} />
            Pilih Rentang Tanggal:
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="date"
              className="presence-date-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>sampai</span>
            <input
              type="date"
              className="presence-date-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <button
              type="button"
              className="presence-apply-btn"
              onClick={loadMetrics}
              disabled={loading || !startDate}
            >
              Terapkan Filter
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="presence-alert-error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* KPI Overview Summary Cards */}
      <div className="presence-kpi-grid">
        {/* Card 1: Total Team Online */}
        <div className="presence-kpi-card">
          <div className="presence-kpi-icon-wrap icon-emerald">
            <Clock size={20} />
          </div>
          <div className="presence-kpi-body">
            <span className="presence-kpi-label">Total Online Tim</span>
            <span className="presence-kpi-value">{formatDuration(summary.totalTeamOnlineSec)}</span>
            <span className="presence-kpi-sub">
              Periode: <strong>{periodLabels[period] || period}</strong>
            </span>
          </div>
        </div>

        {/* Card 2: Average Online / Member */}
        <div className="presence-kpi-card">
          <div className="presence-kpi-icon-wrap icon-blue">
            <TrendingUp size={20} />
          </div>
          <div className="presence-kpi-body">
            <span className="presence-kpi-label">Rata-rata / Anggota</span>
            <span className="presence-kpi-value">{formatDuration(summary.avgOnlinePerMember)}</span>
            <span className="presence-kpi-sub">Total {summary.totalMembers} anggota tim</span>
          </div>
        </div>

        {/* Card 3: Most Active Member */}
        <div className="presence-kpi-card">
          <div className="presence-kpi-icon-wrap icon-amber">
            <Crown size={20} />
          </div>
          <div className="presence-kpi-body">
            <span className="presence-kpi-label">Anggota Teraktif</span>
            <span className="presence-kpi-value" style={{ fontSize: '1.15rem' }}>
              {summary.mostActiveMember ? summary.mostActiveMember.name : '—'}
            </span>
            <span className="presence-kpi-sub">
              {summary.mostActiveMember
                ? `${formatDuration(summary.mostActiveMember.onlineSeconds)} online`
                : 'Belum ada data'}
            </span>
          </div>
        </div>

        {/* Card 4: Live Status Right Now */}
        <div className="presence-kpi-card">
          <div className="presence-kpi-icon-wrap icon-indigo">
            <Users size={20} />
          </div>
          <div className="presence-kpi-body">
            <span className="presence-kpi-label">Status Realtime Saat Ini</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <span className="presence-live-pill pill-online">
                <span className="live-dot dot-online" />
                {summary.onlineNowCount} Online
              </span>
              <span className="presence-live-pill pill-away">
                <span className="live-dot dot-away" />
                {summary.awayNowCount} Away
              </span>
              <span className="presence-live-pill pill-off">
                <span className="live-dot dot-off" />
                {summary.offNowCount} Off
              </span>
            </div>
            <span className="presence-kpi-sub" style={{ marginTop: '4px' }}>
              Pembaruan langsung via socket
            </span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="presence-search-filter-row">
        <div className="presence-search-input-wrap">
          <Search size={15} className="presence-search-icon" />
          <input
            type="text"
            className="presence-search-field"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama atau email anggota tim..."
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="presence-search-clear"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="presence-status-filter-pills">
          <button
            type="button"
            className={`presence-status-filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Semua ({members.length})
          </button>
          <button
            type="button"
            className={`presence-status-filter-btn ${statusFilter === 'online' ? 'active' : ''}`}
            onClick={() => setStatusFilter('online')}
          >
            <span className="live-dot dot-online" />
            Online ({summary.onlineNowCount})
          </button>
          <button
            type="button"
            className={`presence-status-filter-btn ${statusFilter === 'away' ? 'active' : ''}`}
            onClick={() => setStatusFilter('away')}
          >
            <span className="live-dot dot-away" />
            Away ({summary.awayNowCount})
          </button>
          <button
            type="button"
            className={`presence-status-filter-btn ${statusFilter === 'off' ? 'active' : ''}`}
            onClick={() => setStatusFilter('off')}
          >
            <span className="live-dot dot-off" />
            Off ({summary.offNowCount})
          </button>
        </div>
      </div>

      {/* Members Presence Table */}
      <div className="presence-table-wrapper">
        <table className="presence-table">
          <thead>
            <tr>
              <th>Anggota Tim</th>
              <th>Status Live</th>
              <th>Waktu Online</th>
              <th>Waktu Away</th>
              <th>Waktu Offline</th>
              <th style={{ minWidth: '150px' }}>Distribusi Aktivitas</th>
              <th>Rasio Aktif</th>
              <th style={{ textAlign: 'right' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  <RefreshCw size={22} className="spin" style={{ margin: '0 auto 8px' }} />
                  <div>Memuat data kehadiran tim...</div>
                </td>
              </tr>
            ) : filteredMembers.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                  <Users size={32} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                  <div style={{ fontWeight: '600', color: 'var(--text-main)', fontSize: '0.94rem' }}>
                    Tidak ada anggota yang cocok
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '0.82rem' }}>
                    {searchQuery
                      ? `Tidak ditemukan anggota dengan kata kunci "${searchQuery}".`
                      : 'Belum ada data anggota untuk filter status ini.'}
                  </p>
                </td>
              </tr>
            ) : (
              filteredMembers.map((member) => {
                const totalTracked = member.onlineSeconds + member.awaySeconds + member.offlineSeconds;
                const onlinePct = totalTracked > 0 ? (member.onlineSeconds / totalTracked) * 100 : 0;
                const awayPct = totalTracked > 0 ? (member.awaySeconds / totalTracked) * 100 : 0;
                const offPct = totalTracked > 0 ? (member.offlineSeconds / totalTracked) * 100 : 100;

                return (
                  <tr key={member.uid} className="presence-table-row">
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className="presence-user-avatar">
                          {getInitials(member.name, member.email)}
                        </div>
                        <div>
                          <div style={{ fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>{member.name}</span>
                            {member.isSupervisor && (
                              <span className="presence-owner-badge">Owner</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {member.email}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td>
                      {member.liveStatus === 'online' && (
                        <span className="presence-status-badge badge-online">
                          <span className="live-dot dot-online" /> Online
                        </span>
                      )}
                      {member.liveStatus === 'away' && (
                        <span className="presence-status-badge badge-away">
                          <span className="live-dot dot-away" /> Away
                        </span>
                      )}
                      {member.liveStatus === 'off' && (
                        <span className="presence-status-badge badge-off">
                          <span className="live-dot dot-off" /> Off
                        </span>
                      )}
                    </td>

                    <td>
                      <div style={{ fontWeight: '700', color: '#059669', fontSize: '0.88rem' }}>
                        {formatDuration(member.onlineSeconds)}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                        {member.sessionsCount} sesi login
                      </div>
                    </td>

                    <td>
                      <div style={{ fontWeight: '600', color: '#d97706', fontSize: '0.86rem' }}>
                        {formatDuration(member.awaySeconds)}
                      </div>
                    </td>

                    <td>
                      <div style={{ fontWeight: '500', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                        {formatDuration(member.offlineSeconds)}
                      </div>
                    </td>

                    <td>
                      {/* Proportional Activity Bar */}
                      <div className="presence-progress-bar-wrap" title={`Online: ${onlinePct.toFixed(1)}%, Away: ${awayPct.toFixed(1)}%, Off: ${offPct.toFixed(1)}%`}>
                        <div
                          className="presence-bar-segment bar-online"
                          style={{ width: `${Math.max(0, onlinePct)}%` }}
                        />
                        <div
                          className="presence-bar-segment bar-away"
                          style={{ width: `${Math.max(0, awayPct)}%` }}
                        />
                        <div
                          className="presence-bar-segment bar-off"
                          style={{ width: `${Math.max(0, offPct)}%` }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                        <span>🟢 {onlinePct.toFixed(0)}%</span>
                        <span>🟡 {awayPct.toFixed(0)}%</span>
                        <span>⚫ {offPct.toFixed(0)}%</span>
                      </div>
                    </td>

                    <td>
                      <span className="presence-uptime-chip">
                        {member.uptimePercent}%
                      </span>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => setSelectedMember(member)}
                        className="presence-detail-btn"
                      >
                        <History size={13} />
                        <span>Riwayat</span>
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Member Session History Modal */}
      {selectedMember && (
        <div className="broadcast-modal-backdrop" onClick={() => setSelectedMember(null)}>
          <div className="presence-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="presence-detail-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="presence-user-avatar" style={{ width: '42px', height: '42px', fontSize: '0.95rem' }}>
                  {getInitials(selectedMember.name, selectedMember.email)}
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-main)' }}>
                    Riwayat Kehadiran: {selectedMember.name}
                  </h4>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {selectedMember.email} • Periode: {periodLabels[period] || period}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="presence-modal-close-btn"
                onClick={() => setSelectedMember(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="presence-detail-modal-body">
              {/* Summary Stats Strip */}
              <div className="presence-modal-stat-strip">
                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                    Total Online
                  </span>
                  <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#059669' }}>
                    {formatDuration(selectedMember.onlineSeconds)}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                    Total Away
                  </span>
                  <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#d97706' }}>
                    {formatDuration(selectedMember.awaySeconds)}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                    Total Offline
                  </span>
                  <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-muted)' }}>
                    {formatDuration(selectedMember.offlineSeconds)}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>
                    Rasio Aktif
                  </span>
                  <div style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--primary)' }}>
                    {selectedMember.uptimePercent}%
                  </div>
                </div>
              </div>

              <h5 style={{ margin: '16px 0 10px 0', fontSize: '0.88rem', fontWeight: '700', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={15} style={{ color: 'var(--primary)' }} />
                Log Sesi Aktivitas Terakhir:
              </h5>

              {selectedMember.timeline && selectedMember.timeline.length > 0 ? (
                <div className="presence-timeline-list">
                  {selectedMember.timeline.map((item, idx) => (
                    <div key={item.id || idx} className="presence-timeline-item">
                      <div className="presence-timeline-dot-line">
                        <span className={`presence-timeline-dot dot-${item.status}`} />
                        {idx < selectedMember.timeline.length - 1 && <span className="presence-timeline-line" />}
                      </div>
                      <div className="presence-timeline-content">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className={`presence-status-badge badge-${item.status}`}>
                            {item.status.toUpperCase()}
                          </span>
                          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                            Durasi: <strong>{formatDuration(item.durationSeconds)}</strong>
                          </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-main)', marginTop: '4px' }}>
                          Mulai: {formatFullDate(item.startedAt)}
                          {item.endedAt ? ` — Selesai: ${formatTime(item.endedAt)}` : ' (Sedang Berlangsung)'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                  Belum ada log sesi tercatat untuk anggota ini pada periode yang dipilih.
                </div>
              )}
            </div>

            <div className="presence-detail-modal-footer">
              <button
                type="button"
                className="broadcast-btn-cancel"
                onClick={() => setSelectedMember(null)}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
