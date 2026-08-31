import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Activity, RefreshCw, Power, Smartphone, AlertTriangle, HardDrive,
  Clock, Server, X, Users as UsersIcon, MessageSquare, QrCode,
} from 'lucide-react';
import { fetchWithAuth } from '../../utils/api.js';
import { showToast } from '../../utils/toastBus.js';

const REFRESH_MS = 10000;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const STATUS_STYLES = {
  connected: { color: 'var(--success)', background: 'var(--success-soft)', border: 'var(--success-border)' },
  connecting: { color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
  qr: { color: '#f59e0b', background: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
  disconnected: { color: '#ef4444', background: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.25)' },
};

function StatusPill({ status }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.disconnected;
  return (
    <span
      style={{
        fontSize: '0.72rem', fontWeight: '700', textTransform: 'uppercase',
        letterSpacing: '0.03em', padding: '3px 9px', borderRadius: '5px',
        color: style.color, background: style.background, border: `1px solid ${style.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {status || 'unknown'}
    </span>
  );
}

// Live view of every WhatsApp socket the backend is holding, across all
// tenants. This data only exists in the server's memory (activeSessions) and in
// the on-disk chat stores, so it is fetched over the admin REST API rather than
// from Firestore.
export default function SessionsTab({ users }) {
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Avoids a state update after unmount when a refresh is still in flight.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // uid -> profile, so a session can be labelled with the customer who owns it.
  const usersByUid = useMemo(() => {
    const map = {};
    users.forEach((u) => { map[u.uid] = u; });
    return map;
  }, [users]);

  const load = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const [sessionsRes, overviewRes] = await Promise.all([
        fetchWithAuth('/api/admin/sessions'),
        fetchWithAuth('/api/admin/overview'),
      ]);

      if (!mountedRef.current) return;

      if (sessionsRes.status === 403) {
        setError(
          'The backend rejected this account as an admin. Add the address to ADMIN_EMAILS in the ' +
          'server environment (it must also have role "admin" in Firestore).'
        );
        setData(null);
        return;
      }

      if (!sessionsRes.ok) {
        throw new Error(`Server returned ${sessionsRes.status}`);
      }

      setData(await sessionsRes.json());
      if (overviewRes.ok) setOverview(await overviewRes.json());
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      if (!mountedRef.current) return;
      console.error('[Admin] Failed to load live sessions:', err);
      setError(err.message || 'Could not reach the backend.');
    } finally {
      if (mountedRef.current && isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => load(false), REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, load]);

  const handleForceLogout = async () => {
    const target = confirmTarget;
    if (!target) return;
    setBusyKey(target.key);
    try {
      const res = await fetchWithAuth('/api/admin/sessions/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: target.uid, sessionId: target.sessionId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${res.status}`);
      }

      showToast({
        type: 'success',
        title: 'Session disconnected',
        message: `${target.sessionId} for ${usersByUid[target.uid]?.email || target.uid} was logged out.`,
      });
      setConfirmTarget(null);
      load(false);
    } catch (err) {
      console.error('[Admin] Force logout failed:', err);
      showToast({
        type: 'error',
        title: 'Force logout failed',
        message: err.message || 'The backend rejected the request.',
        duration: 5200,
      });
    } finally {
      setBusyKey(null);
    }
  };

  const sessions = data?.sessions || [];
  const summary = data?.summary;

  const summaryCards = [
    { label: 'Live sessions', value: summary?.total ?? '—', icon: Smartphone, accent: 'var(--primary)' },
    { label: 'Connected', value: summary?.connected ?? '—', icon: Activity, accent: 'var(--success)' },
    { label: 'Customers with sessions', value: summary?.distinctUsers ?? '—', icon: UsersIcon, accent: '#f59e0b' },
    { label: 'Open browser tabs', value: summary?.onlineBrowsers ?? '—', icon: Server, accent: '#f59e0b' },
  ];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} style={{ color: 'var(--primary)' }} /> Live WhatsApp Sessions
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '6px 0 0', maxWidth: '620px', lineHeight: '1.5' }}>
            Every WhatsApp socket the backend currently holds, across all customers. This state lives
            in server memory, so it resets when the backend restarts.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            Auto refresh
          </label>
          <button
            onClick={() => load(false)}
            style={{
              background: 'var(--primary-soft)', border: '1px solid var(--primary-border)',
              color: 'var(--primary)', padding: '8px 14px', borderRadius: '8px',
              fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: '6px',
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '4px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', gap: '10px' }}>
          <AlertTriangle size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong style={{ color: '#ef4444' }}>Could not load live sessions.</strong> {error}
          </div>
        </div>
      )}

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="glass" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div className="feature-card-icon" style={{ marginBottom: 0, color: card.accent }}><Icon size={20} /></div>
              <div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>{card.label}</div>
                <div style={{ fontSize: '1.6rem', fontWeight: '700', color: card.accent }}>{card.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Server snapshot */}
      {overview && (
        <div className="glass" style={{ padding: '20px', display: 'flex', flexWrap: 'wrap', gap: '28px', alignItems: 'center' }}>
          {[
            { label: 'Backend uptime', value: formatUptime(overview.uptimeSeconds), icon: Clock },
            { label: 'Session storage', value: `${formatBytes(overview.storage?.bytes)} in ${overview.storage?.files ?? 0} files`, icon: HardDrive },
            { label: 'Memory (RSS)', value: formatBytes(overview.memory?.rssBytes), icon: Server },
            { label: 'Baileys / Node', value: `${overview.baileysVersion || '—'} · ${overview.nodeVersion || '—'}`, icon: Activity },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Icon size={15} style={{ color: 'var(--text-dimmed)' }} />
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{item.label}</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: '600' }}>{item.value}</div>
                </div>
              </div>
            );
          })}
          {overview.config && !overview.config.mayarWebhookTokenSet && (
            <div style={{ fontSize: '0.78rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={14} /> Mayar webhook token is not set, so the payment webhook is unauthenticated.
            </div>
          )}
        </div>
      )}

      {/* Session table */}
      <div className="glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h4 style={{ fontSize: '1rem', fontWeight: '700', margin: 0 }}>Session detail</h4>
          {lastUpdated && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dimmed)' }}>
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><div className="spinner"></div></div>
        ) : sessions.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dimmed)', padding: '40px' }}>
            {error
              ? 'No data available.'
              : 'No WhatsApp sessions are currently held by the backend. Sessions appear here once a customer connects a device.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-dimmed)', fontWeight: '600' }}>
                  <th style={{ padding: '12px 14px' }}>Customer</th>
                  <th style={{ padding: '12px 14px' }}>Session</th>
                  <th style={{ padding: '12px 14px' }}>Status</th>
                  <th style={{ padding: '12px 14px' }}>WhatsApp number</th>
                  <th style={{ padding: '12px 14px' }}>Stored data</th>
                  <th style={{ padding: '12px 14px' }}>Tabs</th>
                  <th style={{ padding: '12px 14px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const owner = usersByUid[s.uid];
                  const busy = busyKey === s.key;

                  return (
                    <tr key={s.key} style={{ borderBottom: '1px solid var(--border-color)', opacity: busy ? 0.55 : 1 }}>
                      <td style={{ padding: '14px' }}>
                        <div style={{ fontWeight: '600' }}>{owner?.name || owner?.email || 'Unknown account'}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {owner?.email || <code style={{ fontSize: '0.72rem' }}>{s.uid}</code>}
                        </div>
                      </td>

                      <td style={{ padding: '14px' }}>
                        <code style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.sessionId}</code>
                        {s.reconnectAttempts > 0 && (
                          <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: '3px' }}>
                            {s.reconnectAttempts} reconnect {s.reconnectAttempts === 1 ? 'attempt' : 'attempts'}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '14px' }}>
                        <StatusPill status={s.status} />
                        {s.hasPendingQr && (
                          <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <QrCode size={11} /> waiting for scan
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '14px' }}>
                        {s.waNumber ? (
                          <>
                            <div style={{ fontWeight: '600' }}>+{s.waNumber}</div>
                            {s.waName && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.waName}</div>}
                          </>
                        ) : (
                          <span style={{ color: 'var(--text-dimmed)' }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: '14px', fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <MessageSquare size={12} /> {s.chatCount} chats · {s.messageCount} msgs
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-dimmed)', marginTop: '3px' }}>
                          {s.contactCount} contacts
                          {s.unresolvedLids > 0 && ` · ${s.unresolvedLids} unresolved`}
                        </div>
                      </td>

                      <td style={{ padding: '14px', fontWeight: '600' }}>{s.connectedBrowsers}</td>

                      <td style={{ padding: '14px' }}>
                        <button
                          onClick={() => setConfirmTarget(s)}
                          disabled={busy}
                          style={{
                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                            color: '#ef4444', padding: '6px 12px', borderRadius: '6px',
                            fontSize: '0.8rem', fontWeight: '600',
                            cursor: busy ? 'not-allowed' : 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
                          }}
                        >
                          <Power size={13} /> Force logout
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Force logout confirmation */}
      {confirmTarget && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px',
          }}
        >
          <div
            className="glass"
            style={{
              width: '100%', maxWidth: '460px', padding: '28px', borderRadius: '16px',
              display: 'flex', flexDirection: 'column', gap: '18px',
              border: '1px solid var(--border-color)', background: 'var(--bg-main)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Power size={17} style={{ color: '#ef4444' }} /> Force logout session
              </h3>
              <button
                onClick={() => setConfirmTarget(null)}
                aria-label="Close dialog"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
              <div style={{ fontWeight: '600' }}>
                {usersByUid[confirmTarget.uid]?.email || confirmTarget.uid}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Session <code>{confirmTarget.sessionId}</code>
                {confirmTarget.waNumber ? ` · +${confirmTarget.waNumber}` : ''}
              </div>
            </div>

            <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.55' }}>
              This disconnects the WhatsApp socket and deletes the stored credentials and cached chats
              for this session.
              <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444', borderRadius: '6px', fontSize: '0.82rem' }}>
                The customer will have to scan a new QR code to reconnect, and the cached chat history
                for this session is removed. Their WhatsApp account itself is unaffected.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setConfirmTarget(null)}
                style={{
                  background: 'transparent', border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)', padding: '8px 16px', borderRadius: '8px',
                  fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleForceLogout}
                disabled={busyKey === confirmTarget.key}
                style={{
                  background: '#ef4444', border: 'none', color: '#fff', fontWeight: '600',
                  padding: '8px 18px', borderRadius: '8px', fontSize: '0.85rem',
                  cursor: busyKey === confirmTarget.key ? 'wait' : 'pointer',
                  opacity: busyKey === confirmTarget.key ? 0.6 : 1,
                }}
              >
                Disconnect session
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
