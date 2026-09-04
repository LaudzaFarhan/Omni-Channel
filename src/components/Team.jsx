import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, UserPlus, Trash2, RefreshCw, Copy, Check, AlertTriangle, X,
  Crown, Clock, Link2, ShieldCheck, Infinity as InfinityIcon,
} from 'lucide-react';
import {
  fetchTeam, inviteMember, resendInvite, removeMember,
} from '../utils/api.js';
import { subscribeSocket } from '../utils/socket.js';
import { showToast } from '../utils/toastBus.js';

const STATUS = {
  owner: { label: 'Owner', color: 'var(--success)', bg: 'var(--success-soft)', border: 'var(--success-border)', icon: Crown },
  active: { label: 'Active', color: 'var(--success)', bg: 'var(--success-soft)', border: 'var(--success-border)', icon: ShieldCheck },
  invited: { label: 'Invite pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)', icon: Clock },
  expired: { label: 'Invite expired', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.25)', icon: AlertTriangle },
};

function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.expired;
  const Icon = s.icon;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      fontSize: '0.72rem', fontWeight: '700', padding: '3px 9px', borderRadius: '5px',
      color: s.color, background: s.bg, border: `1px solid ${s.border}`, whiteSpace: 'nowrap',
    }}>
      <Icon size={12} /> {s.label}
    </span>
  );
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// A link the supervisor has to pass on by hand, so it gets a dedicated panel with
// a copy button rather than being buried in a toast. It is shown exactly once:
// only a hash of the token is stored server-side.
function InviteLinkPanel({ invite, onDone }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the input below is selectable as a
      // fallback, so this is not worth an error dialog.
      showToast({ type: 'info', title: 'Copy the link manually', message: 'Clipboard access was blocked by the browser.' });
    }
  };

  return (
    <div style={{
      padding: '18px', borderRadius: '12px', marginBottom: '18px',
      background: 'var(--primary-subtle)', border: '1px solid var(--primary-border)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
        <div>
          <strong style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '7px' }}>
            <Link2 size={16} style={{ color: 'var(--primary)' }} />
            Send this link to {invite.member.email}
          </strong>
          <p style={{ margin: '6px 0 0', fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: '1.5', maxWidth: '620px' }}>
            It lets them set their own password and expires in {invite.expiresInDays} days.
            We do not email it — send it however you normally reach them.
            <strong> This is the only time it is shown</strong>; if it gets lost, use Resend to
            generate a new one, which cancels this link.
          </p>
        </div>
        <button onClick={onDone} aria-label="Dismiss"
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          readOnly
          value={invite.inviteUrl}
          onFocus={(e) => e.target.select()}
          aria-label="Invitation link"
          style={{
            flex: 1, padding: '9px 11px', borderRadius: '8px',
            border: '1px solid var(--border-color)', background: 'var(--bg-panel, var(--bg-sidebar))',
            color: 'var(--text-main)', fontSize: '0.8rem', fontFamily: 'monospace',
            boxSizing: 'border-box', minWidth: 0,
          }}
        />
        <button onClick={copy} className="upgrade-btn"
          style={{ padding: '9px 16px', display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
          {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
        </button>
      </div>
    </div>
  );
}

// Who else can sign in to this account.
//
// Supervisor-only, both here and on the server (the `supervisor` middleware chain).
// A member reaching these endpoints gets 403 supervisor_only, and the tab is hidden
// from them in the sidebar.
// How many seat blocks to draw before switching to a count. A plan can grant far more
// agents than are worth rendering one-by-one, and an unlimited plan has no number at all.
const SEAT_BLOCKS = 12;

export default function Team({ userProfile }) {
  const unlimitedAgents = Boolean(userProfile?.unlimitedAgents);
  const [team, setTeam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ email: '', name: '' });
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [freshInvite, setFreshInvite] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      setTeam(await fetchTeam());
      setError(null);
    } catch (err) {
      console.error('[Team] Load failed:', err);
      setError(err.message || 'Could not load the team.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Buying more agents changes the seat budget, so the counter has to follow it
  // without a reload.
  useEffect(() => {
    let attached = null;
    const handleWorkspace = () => load();

    const unsubscribe = subscribeSocket((socket) => {
      if (attached) attached.off('workspace-updated', handleWorkspace);
      attached = null;
      if (socket) {
        socket.on('workspace-updated', handleWorkspace);
        attached = socket;
      }
    });

    return () => {
      unsubscribe();
      if (attached) attached.off('workspace-updated', handleWorkspace);
    };
  }, [load]);

  const seats = team?.seats;
  const full = seats ? seats.available <= 0 : false;

  const submitInvite = async (e) => {
    e.preventDefault();
    if (busy) return;

    const email = form.email.trim();
    if (!email) {
      setFormError('Enter the email address they will sign in with.');
      return;
    }

    setBusy('invite');
    setFormError(null);
    try {
      const result = await inviteMember({ email, name: form.name.trim() });
      setFreshInvite(result);
      setForm({ email: '', name: '' });
      setInviting(false);
      await load();
    } catch (err) {
      setFormError(err.message || 'Could not send the invitation.');
    } finally {
      setBusy(null);
    }
  };

  const handleResend = async (member) => {
    setBusy(member.uid);
    try {
      const result = await resendInvite(member.uid);
      setFreshInvite({ ...result, member });
      await load();
    } catch (err) {
      showToast({ type: 'error', title: 'Could not create a link', message: err.message, duration: 5000 });
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (member) => {
    setBusy(member.uid);
    try {
      await removeMember(member.uid);
      showToast({
        type: 'success',
        title: 'Access removed',
        message: `${member.email} can no longer sign in, and was signed out immediately.`,
      });
      setConfirm(null);
      await load();
    } catch (err) {
      showToast({ type: 'error', title: 'Could not remove', message: err.message, duration: 5000 });
    } finally {
      setBusy(null);
    }
  };

  const buttonStyle = {
    background: 'transparent', border: '1px solid var(--border-color)',
    color: 'var(--text-muted)', padding: '6px 12px', borderRadius: '8px',
    fontSize: '0.82rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '8px',
    border: '1px solid var(--border-color)', background: 'var(--bg-panel, var(--bg-sidebar))',
    color: 'var(--text-main)', fontSize: '0.9rem', boxSizing: 'border-box',
  };

  return (
    <div className="view-container">
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={26} style={{ color: 'var(--primary)' }} /> Team
          </h2>
          <p>
            Decide who else can sign in and work on this account. Everyone here shares the
            same WhatsApp numbers, chats, contacts and message quota — each person takes one
            agent slot, including you.
          </p>
        </div>

        <div style={{ paddingTop: '8px' }}>
          <button
            className="upgrade-btn"
            onClick={() => { setInviting(true); setFormError(null); }}
            disabled={full || loading}
            title={full ? 'No agent slots left' : 'Invite someone by email'}
            style={{
              padding: '9px 17px', display: 'inline-flex', alignItems: 'center', gap: '7px',
              fontSize: '0.86rem', opacity: full || loading ? 0.55 : 1,
              cursor: full || loading ? 'not-allowed' : 'pointer',
            }}
          >
            <UserPlus size={15} /> Invite someone
          </button>
        </div>
      </div>

      <div className="view-content" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {error && (
          <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '4px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: '#ef4444' }}>Could not load the team.</strong> {error}
          </div>
        )}

        {freshInvite && (
          <InviteLinkPanel invite={freshInvite} onDone={() => setFreshInvite(null)} />
        )}

        {/* Seat budget */}
        {seats && (
          <div className="card glass" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-dimmed)', marginBottom: '6px' }}>
                Agent slots
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {seats.used}
                <span style={{ color: 'var(--text-dimmed)', fontWeight: '500', fontSize: '1rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  of {unlimitedAgents
                    ? <InfinityIcon size={18} style={{ color: 'var(--primary)' }} />
                    : seats.limit} used
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {unlimitedAgents
                  ? 'This plan has no agent limit — invite as many people as you need.'
                  : full
                    ? 'Every slot is taken. Add an agent on the Subscription page to invite more people.'
                    : `${seats.available} ${seats.available === 1 ? 'slot' : 'slots'} free — you can invite ${seats.available} more ${seats.available === 1 ? 'person' : 'people'}.`}
              </div>
            </div>

            {/* One block per slot, so "why is one already used" is answerable at a
                glance: the first is always the owner.

                Capped at SEAT_BLOCKS. The count comes from the plan, and an unlimited or
                generously sized plan would otherwise render hundreds of nodes here — one
                per notional seat — for no added meaning. Past the cap the blocks show what
                is in use and a count carries the rest. */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', maxWidth: '340px', alignItems: 'center' }}>
              {Array.from({ length: Math.min(Math.max(seats.limit, seats.used), SEAT_BLOCKS) }, (_, i) => (
                <span
                  key={i}
                  title={i < seats.used ? 'In use' : 'Free'}
                  style={{
                    width: '26px', height: '34px', borderRadius: '5px',
                    background: i < seats.used ? 'var(--primary)' : 'var(--overlay-subtle)',
                    border: `1px solid ${i < seats.used ? 'var(--primary)' : 'var(--border-color)'}`,
                    opacity: i < seats.limit ? 1 : 0.45,
                  }}
                />
              ))}
              {unlimitedAgents ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: '700', color: 'var(--primary)', marginLeft: '2px' }}>
                  <InfinityIcon size={16} /> unlimited
                </span>
              ) : Math.max(seats.limit, seats.used) > SEAT_BLOCKS && (
                <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-dimmed)', marginLeft: '2px' }}>
                  +{Math.max(seats.limit, seats.used) - SEAT_BLOCKS} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Members */}
        <div className="card glass" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}><div className="spinner" /></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-dimmed)', fontWeight: '600' }}>
                    <th style={{ padding: '13px 14px 13px 22px' }}>Person</th>
                    <th style={{ padding: '13px 14px', whiteSpace: 'nowrap', width: '1%' }}>Status</th>
                    <th style={{ padding: '13px 14px', whiteSpace: 'nowrap', width: '1%' }}>Last signed in</th>
                    <th style={{ padding: '13px 22px 13px 14px', whiteSpace: 'nowrap', width: '1%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(team?.members || []).map((member) => (
                    <tr key={member.uid} style={{ borderBottom: '1px solid var(--border-color)', opacity: busy === member.uid ? 0.5 : 1 }}>
                      <td style={{ padding: '13px 14px 13px 22px' }}>
                        <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          {member.name || member.email.split('@')[0]}
                          {member.isSelf && (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)', fontWeight: '500' }}>(you)</span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{member.email}</div>
                      </td>

                      <td style={{ padding: '13px 14px', whiteSpace: 'nowrap' }}>
                        <StatusPill status={member.status} />
                        {member.status === 'invited' && member.inviteExpiresAt && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)', marginTop: '4px' }}>
                            expires {formatDate(member.inviteExpiresAt)}
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '13px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        {formatDate(member.lastLoginAt) || <span style={{ color: 'var(--text-dimmed)' }}>never</span>}
                      </td>

                      <td style={{ padding: '13px 22px 13px 14px', whiteSpace: 'nowrap' }}>
                        {member.isSupervisor ? (
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)' }}>Account owner</span>
                        ) : (
                          <div style={{ display: 'inline-flex', gap: '7px' }}>
                            {member.status !== 'active' && (
                              <button onClick={() => handleResend(member)} disabled={busy === member.uid}
                                style={buttonStyle} title="Create a fresh invitation link">
                                <RefreshCw size={13} /> Resend
                              </button>
                            )}
                            <button
                              onClick={() => setConfirm({
                                member,
                                title: `Remove ${member.name || member.email}?`,
                                body: member.status === 'active'
                                  ? 'They will be signed out straight away and will not be able to sign in again. The chats, contacts and messages on this account are not affected, and the agent slot is freed for someone else.'
                                  : 'Their pending invitation will be cancelled and the agent slot freed.',
                              })}
                              disabled={busy === member.uid}
                              style={{ ...buttonStyle, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                              title="Remove access"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)', lineHeight: '1.6', margin: 0, maxWidth: '740px' }}>
          Agents can read and reply to chats, manage contacts, and hold the bot on a
          conversation. They cannot see billing, change the plan, buy agent slots, manage
          this list, or disconnect the WhatsApp number — those stay with you.
        </p>
      </div>

      {/* Invite form */}
      {inviting && (
        <div role="dialog" aria-modal="true" aria-label="Invite someone" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px',
        }}>
          <form className="glass" onSubmit={submitInvite} style={{
            width: '100%', maxWidth: '470px', padding: '26px', borderRadius: '16px',
            display: 'flex', flexDirection: 'column', gap: '18px',
            border: '1px solid var(--border-color)', background: 'var(--bg-main)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserPlus size={18} style={{ color: 'var(--primary)' }} /> Invite someone
              </h3>
              <button type="button" onClick={() => setInviting(false)} aria-label="Close"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                {formError}
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-dimmed)', marginBottom: '6px' }} htmlFor="invite-email">
                Email they will sign in with *
              </label>
              <input id="invite-email" type="email" required autoFocus style={inputStyle}
                value={form.email}
                onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="sales@company.com" />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', color: 'var(--text-dimmed)', marginBottom: '6px' }} htmlFor="invite-name">
                Name
              </label>
              <input id="invite-name" style={inputStyle}
                value={form.name}
                onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Optional — they can change it" />
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.55', padding: '12px 14px', borderRadius: '8px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)' }}>
              You will get a link to send them. They choose their own password, so you never
              see it.{unlimitedAgents
                ? ' Your plan has no agent limit.'
                : ` Uses one of your ${seats ? seats.limit : ''} agent slots.`}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" onClick={() => setInviting(false)} style={{ ...buttonStyle, padding: '9px 18px' }}>
                Cancel
              </button>
              <button type="submit" className="upgrade-btn" disabled={busy === 'invite'}
                style={{ padding: '9px 20px', opacity: busy === 'invite' ? 0.6 : 1 }}>
                {busy === 'invite' ? 'Creating…' : 'Create invitation'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Remove confirmation */}
      {confirm && (
        <div role="dialog" aria-modal="true" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px',
        }}>
          <div className="glass" style={{
            width: '100%', maxWidth: '460px', padding: '26px', borderRadius: '16px',
            display: 'flex', flexDirection: 'column', gap: '16px',
            border: '1px solid var(--border-color)', background: 'var(--bg-main)',
          }}>
            <h3 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={17} style={{ color: '#f59e0b' }} /> {confirm.title}
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0, lineHeight: '1.55' }}>
              {confirm.body}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => setConfirm(null)} style={{ ...buttonStyle, padding: '8px 16px' }}>Cancel</button>
              <button
                onClick={() => handleRemove(confirm.member)}
                disabled={busy !== null}
                style={{
                  background: '#ef4444', border: 'none', color: '#fff', fontWeight: '600',
                  padding: '8px 18px', borderRadius: '8px', fontSize: '0.85rem',
                  cursor: busy !== null ? 'wait' : 'pointer', opacity: busy !== null ? 0.6 : 1,
                }}
              >
                Remove access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
