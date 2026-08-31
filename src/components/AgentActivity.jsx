import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, RefreshCw, ChevronRight, ChevronDown, MessageSquare,
  Loader2, Info,
} from 'lucide-react';
import { fetchAgentActivity } from '../utils/api.js';
import { getChatDisplayName, getInitials } from '../utils/displayName.js';

const AVATAR_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
];

// Stable per seed, so a person/customer keeps one colour across renders.
function avatarColor(seed) {
  let hash = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Compact "when": a time today, "Kemarin", a weekday this week, else a date. The full
// timestamp goes in a title attribute at the call site.
function shortWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';

  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Kemarin';
  if (now - d < 7 * 86400000) return d.toLocaleDateString('id-ID', { weekday: 'short' });
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/**
 * Supervisor view: which customers each teammate has been messaging.
 *
 * Reads from /api/stats/agent-activity, which is built from the agent name stamped on
 * outgoing messages. Two things follow from that and are surfaced rather than hidden:
 * only messages sent from the dashboard after the feature shipped are counted, and only
 * the last 100 per chat are retained — so this is a rolling recent picture. The
 * "tidak terlacak" note reports the messages that carry no agent so the totals read as
 * honestly partial.
 */
export default function AgentActivity({
  chats = [], userInfo, savedNames = {}, activeSessionId = 'default', onOpenChat,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAgentActivity(activeSessionId));
    } catch (err) {
      setError(err?.message || 'Gagal memuat aktivitas agen.');
    } finally {
      setLoading(false);
    }
  };

  // Refetch when the active WhatsApp session changes; switching tabs remounts this, so
  // opening the view is always a fresh read.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);

  // Resolve a chat's display name the same way the rest of the app does, so a customer
  // reads identically here and in the chat list. Falls back to the label the server
  // carried for a chat that has aged out of the live list.
  const chatById = useMemo(() => {
    const m = new Map();
    chats.forEach((c) => { if (c?.id) m.set(c.id, c); });
    return m;
  }, [chats]);

  const labelFor = (entry) => {
    const chat = chatById.get(entry.jid)
      || { id: entry.jid, name: entry.name, phoneNumber: entry.phoneNumber };
    return getChatDisplayName(chat, userInfo, savedNames[entry.jid]);
  };

  const agents = data?.agents || [];
  const keyFor = (a) => a.uid || `name:${a.name}`;
  const toggle = (k) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <div className="view-container">
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Activity size={26} style={{ color: 'var(--primary)' }} /> Aktivitas Agen
          </h2>
          <p>
            Siapa mengobrol dengan siapa. Setiap pesan yang dikirim dari dashboard dicatat
            atas nama pengirimnya, lalu dikelompokkan per agen di sini. Menampilkan
            percakapan terbaru, bukan seluruh riwayat.
          </p>
        </div>
        <div style={{ paddingTop: '8px' }}>
          <button
            onClick={load}
            disabled={loading}
            title="Muat ulang"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px',
              padding: '9px 15px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '600',
              border: '1px solid var(--border-color)', background: 'transparent',
              color: 'var(--text-muted)', cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            <RefreshCw size={15} className={loading ? 'spin-icon' : ''} /> Segarkan
          </button>
        </div>
      </div>

      <div className="view-content" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {error && (
          <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '4px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: '#ef4444' }}>Tidak bisa memuat aktivitas.</strong> {error}
          </div>
        )}

        {loading && !data && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '48px', color: 'var(--text-dimmed)' }}>
            <Loader2 size={20} className="spin-icon" /> Memuat…
          </div>
        )}

        {!loading && !error && agents.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-dimmed)' }}>
            <MessageSquare size={34} style={{ opacity: 0.5 }} />
            <p style={{ marginTop: '12px', fontSize: '0.9rem' }}>
              Belum ada pesan yang dikirim dari dashboard. Begitu tim mulai membalas dari
              sini, aktivitas mereka akan muncul.
            </p>
          </div>
        )}

        {agents.map((agent) => {
          const k = keyFor(agent);
          const open = expanded.has(k);
          return (
            <div key={k} className="card glass" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Agent summary row toggles the customer list. */}
              <button
                onClick={() => toggle(k)}
                aria-expanded={open}
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px', width: '100%',
                  padding: '15px 18px', border: 'none', background: 'transparent',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <span
                  className="customer-avatar"
                  style={{ background: avatarColor(k), width: '42px', height: '42px', fontSize: '0.9rem', flexShrink: 0 }}
                >
                  {getInitials(agent.name)}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.98rem', fontWeight: '700', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agent.name}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {agent.customerCount} pelanggan · {agent.totalMessages} pesan
                    {agent.lastActiveTs && (
                      <> · terakhir {shortWhen(agent.lastActiveTs)}</>
                    )}
                  </div>
                </div>

                {open ? <ChevronDown size={18} style={{ color: 'var(--text-dimmed)', flexShrink: 0 }} />
                      : <ChevronRight size={18} style={{ color: 'var(--text-dimmed)', flexShrink: 0 }} />}
              </button>

              {open && (
                <ul style={{ listStyle: 'none', margin: 0, padding: '0 10px 10px', borderTop: '1px solid var(--border-color)' }}>
                  {agent.chats.map((entry) => {
                    const label = labelFor(entry);
                    return (
                      <li key={entry.jid}>
                        <button
                          type="button"
                          onClick={() => onOpenChat?.(entry.jid)}
                          title={`Buka riwayat chat ${label}`}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
                            padding: '10px 8px', border: 'none', borderRadius: '10px',
                            background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--overlay-subtle)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <span
                            className="customer-avatar"
                            style={{ background: avatarColor(entry.jid), width: '34px', height: '34px', fontSize: '0.74rem', flexShrink: 0 }}
                          >
                            {getInitials(label)}
                          </span>

                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                              <span style={{ fontSize: '0.88rem', fontWeight: '600', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {label}
                              </span>
                              {entry.isGroup && (
                                <span style={{ fontSize: '0.64rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-dimmed)', background: 'var(--overlay-subtle)', padding: '1px 6px', borderRadius: '4px', flexShrink: 0 }}>
                                  Grup
                                </span>
                              )}
                            </span>
                            <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-dimmed)', marginTop: '1px' }}>
                              {entry.count} {entry.count === 1 ? 'pesan' : 'pesan'} dikirim
                              {entry.lastTs && (
                                <span title={new Date(entry.lastTs).toLocaleString('id-ID')}>
                                  {' · '}{shortWhen(entry.lastTs)}
                                </span>
                              )}
                            </span>
                          </span>

                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.76rem', fontWeight: '600', color: 'var(--primary)', flexShrink: 0 }}>
                            Lihat <ChevronRight size={12} />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}

        {/* Honest footnote: our own messages with no agent (sent from the phone, by a bot,
            or before this feature) are counted but cannot be attributed. */}
        {data && data.unattributed > 0 && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '12px 14px', borderRadius: '8px', background: 'var(--overlay-subtle)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <Info size={15} style={{ flexShrink: 0, marginTop: '1px', color: 'var(--text-dimmed)' }} />
            <span>
              {data.unattributed} pesan terkirim tidak terlacak ke agen mana pun — dikirim
              dari HP, oleh bot, atau sebelum fitur ini aktif.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
