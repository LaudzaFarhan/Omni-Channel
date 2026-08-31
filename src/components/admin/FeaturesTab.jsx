import React, { useMemo, useState } from 'react';
import {
  ToggleLeft, CheckCircle2, Clock, EyeOff, Lock, UserPlus, X, Search,
  ShieldCheck, ShieldOff, Trash2,
} from 'lucide-react';
import { adminSetFeature, adminSetFeatureAccess, adminClearFeatureAccess } from '../../utils/api.js';
import { showToast } from '../../utils/toastBus.js';

// The three rollout states, in the order a feature moves through them.
const STATUSES = [
  {
    key: 'released',
    label: 'Released',
    icon: CheckCircle2,
    color: 'var(--success)',
    soft: 'var(--success-soft)',
    border: 'var(--success-border)',
    help: 'Visible and usable by every customer.',
  },
  {
    key: 'coming_soon',
    label: 'Coming soon',
    icon: Clock,
    color: 'var(--warning)',
    soft: 'var(--warning-soft)',
    border: 'var(--warning-border)',
    help: 'Customers see it and are told it is on the way, but cannot use it.',
  },
  {
    key: 'hidden',
    label: 'Hidden',
    icon: EyeOff,
    color: 'var(--text-dimmed)',
    soft: 'var(--overlay-subtle)',
    border: 'var(--border-color)',
    help: 'Absent. Customers have no way to know it exists.',
  },
];

const statusMeta = (key) => STATUSES.find(s => s.key === key) || STATUSES[0];

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: '8px',
  border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)',
  color: 'var(--text-main)', fontSize: '0.9rem', outline: 'none',
};

const labelStyle = { fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '5px', display: 'block' };

/**
 * Feature control.
 *
 * Two levers per feature, deliberately separate:
 *
 *   status    the rollout for everyone. Release it, announce it as coming, or hide it.
 *   exception one account's own answer, which beats the rollout. This is how a feature
 *             gets piloted with a single customer before it goes out.
 *
 * The catalogue comes from the server and is defined in code, so a newly built feature
 * appears here on deploy with nothing to create first. Three features are locked because
 * customers reach their account and billing through them; the server refuses to change
 * those, and this shows why rather than hiding the rows.
 */
export default function FeaturesTab({ features, loading, error, users, onFeaturesChanged, onRefresh }) {
  const [busy, setBusy] = useState(false);
  // Note edits are held locally until saved, so typing does not fire a request per keystroke.
  const [noteDrafts, setNoteDrafts] = useState({});
  // { feature } while the add-exception dialog is open.
  const [accessModal, setAccessModal] = useState(null);

  // Only workspace owners can carry an exception: resolution reads the workspace account,
  // so a row against an invited member would never take effect. The server refuses those
  // too, but offering them here and then failing would be a worse way to learn it.
  const eligibleAccounts = useMemo(
    () => (users || []).filter(u => !u.ownerUserId && u.role !== 'admin'),
    [users]
  );

  // Same wrapper as the other admin tabs: one place for the busy flag, the toast and
  // refreshing from the server's view rather than a locally guessed one.
  const run = async (label, mutate) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await mutate();
      if (Array.isArray(next) && onFeaturesChanged) onFeaturesChanged(next);
      else if (onRefresh) await onRefresh();
      showToast({ type: 'success', title: label, message: 'Change saved.' });
      setAccessModal(null);
    } catch (err) {
      console.error(`[Admin] ${label} failed:`, err);
      showToast({
        type: 'error',
        title: `${label} failed`,
        message: err?.message || 'The server rejected the change. Please try again.',
        duration: 5200,
      });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (feature, status) => {
    if (status === feature.status) return;
    const note = noteDrafts[feature.key] ?? feature.note ?? '';
    return run(`${feature.label} · ${statusMeta(status).label}`, () =>
      adminSetFeature(feature.key, { status, note })
    );
  };

  const saveNote = (feature) => {
    const note = noteDrafts[feature.key] ?? '';
    return run(`${feature.label} note saved`, async () => {
      const next = await adminSetFeature(feature.key, { status: feature.status, note });
      setNoteDrafts(prev => { const copy = { ...prev }; delete copy[feature.key]; return copy; });
      return next;
    });
  };

  const grant = (feature, uid, access) =>
    run(access === 'allow' ? 'Early access granted' : 'Access withdrawn', () =>
      adminSetFeatureAccess(feature.key, uid, access)
    );

  const clear = (feature, uid) =>
    run('Exception removed', () => adminClearFeatureAccess(feature.key, uid));

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="spinner"></div></div>;
  }

  const list = features || [];
  const counts = STATUSES.map(s => ({
    ...s,
    n: list.filter(f => f.status === s.key).length,
  }));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ToggleLeft size={18} style={{ color: 'var(--primary)' }} /> Feature Control
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '6px 0 0', maxWidth: '680px', lineHeight: '1.5' }}>
            Decide what every customer sees. Set a feature to <strong>Coming soon</strong> to announce
            it without shipping it, or <strong>Hidden</strong> to keep it out of sight entirely. Add an
            exception to give one account early access, or to withdraw a released feature from them.
            Changes reach signed-in customers immediately.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {counts.map(({ key, label, n, color, soft, border }) => (
            <span
              key={key}
              style={{
                padding: '6px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: '700',
                background: soft, color, border: `1px solid ${border}`, whiteSpace: 'nowrap',
              }}
            >
              {n} {label}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '4px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <strong style={{ color: '#ef4444' }}>Could not read the feature list.</strong> {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {list.map((feature) => {
          const meta = statusMeta(feature.status);
          const noteDraft = noteDrafts[feature.key];
          const noteDirty = noteDraft !== undefined && noteDraft !== (feature.note || '');

          return (
            <div
              key={feature.key}
              className="glass"
              style={{
                padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px',
                border: `1px solid ${feature.status === 'released' ? 'var(--border-color)' : meta.border}`,
              }}
            >
              {/* Identity + rollout control */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: '260px', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.05rem', fontWeight: '700' }}>{feature.label}</span>
                    {feature.locked && (
                      <span
                        title="Customers reach their account and billing through this, so it cannot be hidden or deferred."
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase',
                          padding: '2px 7px', borderRadius: '4px',
                          background: 'var(--overlay-subtle)', color: 'var(--text-dimmed)',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <Lock size={10} /> Always on
                      </span>
                    )}
                    {feature.supervisorOnly && (
                      <span style={{ fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase', padding: '2px 7px', borderRadius: '4px', background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
                        Owner only
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '3px' }}>
                    <code style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)' }}>{feature.key}</code>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)' }}>{feature.surface}</span>
                  </div>
                  <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: '1.5' }}>
                    {feature.description}
                  </p>
                </div>

                {/* Segmented control rather than a dropdown: three states that each need a
                    word of explanation read better side by side than hidden in a menu. */}
                <div role="group" aria-label={`Rollout state for ${feature.label}`} style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {STATUSES.map((s) => {
                    const Icon = s.icon;
                    const active = feature.status === s.key;
                    const disabled = busy || feature.locked;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setStatus(feature, s.key)}
                        disabled={disabled}
                        aria-pressed={active}
                        title={feature.locked ? 'This feature is always available.' : s.help}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          padding: '8px 13px', borderRadius: '8px', fontSize: '0.82rem',
                          fontWeight: '600', fontFamily: 'inherit',
                          background: active ? s.soft : 'transparent',
                          color: active ? s.color : 'var(--text-muted)',
                          border: `1px solid ${active ? s.border : 'var(--border-color)'}`,
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled && !active ? 0.45 : 1,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <Icon size={14} /> {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Why it is held back. Only offered when it is, since a released feature has
                  nothing to explain. */}
              {!feature.locked && feature.status !== 'released' && (
                <div>
                  <label style={labelStyle} htmlFor={`note-${feature.key}`}>
                    Internal note — why this is held back (admins only, never shown to customers)
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      id={`note-${feature.key}`}
                      style={inputStyle}
                      value={noteDraft ?? feature.note ?? ''}
                      placeholder="Waiting on the WhatsApp template approval"
                      onChange={(e) => setNoteDrafts(prev => ({ ...prev, [feature.key]: e.target.value }))}
                    />
                    <button
                      type="button"
                      onClick={() => saveNote(feature)}
                      disabled={busy || !noteDirty}
                      style={{
                        background: noteDirty ? 'var(--primary)' : 'transparent',
                        color: noteDirty ? 'var(--primary-contrast)' : 'var(--text-dimmed)',
                        border: noteDirty ? 'none' : '1px solid var(--border-color)',
                        padding: '9px 16px', borderRadius: '8px', fontSize: '0.83rem',
                        fontWeight: '600', whiteSpace: 'nowrap',
                        cursor: busy || !noteDirty ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Save note
                    </button>
                  </div>
                </div>
              )}

              {/* Account exceptions */}
              {!feature.locked && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-dimmed)' }}>
                      Account exceptions
                      {feature.overrides.length > 0 && ` · ${feature.overrides.length}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAccessModal({ feature })}
                      disabled={busy}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        background: 'transparent', border: '1px solid var(--border-color)',
                        color: 'var(--text-muted)', padding: '7px 13px', borderRadius: '8px',
                        fontSize: '0.8rem', fontWeight: '600', fontFamily: 'inherit',
                        cursor: busy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <UserPlus size={14} /> Add exception
                    </button>
                  </div>

                  {feature.overrides.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)', margin: '8px 0 0', lineHeight: '1.5' }}>
                      Every account follows the rollout above. Add an exception to let one customer in
                      early, or to take this away from one customer only.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                      {feature.overrides.map((o) => {
                        const allowed = o.access === 'allow';
                        return (
                          <div
                            key={o.userId}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                              padding: '9px 12px', borderRadius: '8px',
                              background: allowed ? 'var(--primary-subtle)' : 'rgba(239,68,68,0.06)',
                              border: `1px solid ${allowed ? 'var(--primary-border)' : 'rgba(239,68,68,0.25)'}`,
                            }}
                          >
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: '5px',
                              fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase',
                              color: allowed ? 'var(--primary)' : '#ef4444', whiteSpace: 'nowrap',
                            }}>
                              {allowed ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}
                              {allowed ? 'Early access' : 'Withdrawn'}
                            </span>

                            <span style={{ flex: 1, minWidth: '160px', fontSize: '0.85rem' }}>
                              <strong style={{ color: 'var(--text-main)' }}>{o.name || o.email}</strong>
                              {o.name && (
                                <span style={{ color: 'var(--text-dimmed)', marginLeft: '6px', fontSize: '0.78rem' }}>
                                  {o.email}
                                </span>
                              )}
                            </span>

                            {/* Flip it without deleting and re-adding, which is the common edit. */}
                            <button
                              type="button"
                              onClick={() => grant(feature, o.userId, allowed ? 'deny' : 'allow')}
                              disabled={busy}
                              style={{
                                background: 'transparent', border: '1px solid var(--border-color)',
                                color: 'var(--text-muted)', padding: '5px 11px', borderRadius: '6px',
                                fontSize: '0.76rem', fontWeight: '600', fontFamily: 'inherit',
                                cursor: busy ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                              }}
                            >
                              {allowed ? 'Withdraw instead' : 'Grant instead'}
                            </button>

                            <button
                              type="button"
                              onClick={() => clear(feature, o.userId)}
                              disabled={busy}
                              aria-label={`Remove the exception for ${o.email}`}
                              title="Remove — the account follows the rollout again"
                              style={{
                                background: 'transparent', border: 'none', color: 'var(--text-dimmed)',
                                cursor: busy ? 'not-allowed' : 'pointer', display: 'flex', padding: '4px',
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {accessModal && (
        <AccessDialog
          feature={accessModal.feature}
          accounts={eligibleAccounts}
          busy={busy}
          onClose={() => setAccessModal(null)}
          onSubmit={(uid, access) => grant(accessModal.feature, uid, access)}
        />
      )}
    </>
  );
}

/**
 * Pick an account and decide what it gets.
 *
 * Searchable because the registry grows without bound, and a plain select of several
 * hundred customers is unusable. Only workspace owners are listed — see eligibleAccounts.
 */
function AccessDialog({ feature, accounts, busy, onClose, onSubmit }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [access, setAccess] = useState('allow');

  const existing = new Map((feature.overrides || []).map(o => [o.userId, o.access]));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? accounts.filter(a =>
          (a.email || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))
      : accounts;
    return list.slice(0, 40);
  }, [accounts, query]);

  return (
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
          width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto', padding: '26px',
          borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '16px',
          border: '1px solid var(--border-color)', background: 'var(--bg-main)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserPlus size={17} style={{ color: 'var(--primary)' }} /> Exception for {feature.label}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { key: 'allow', label: 'Give early access', help: `Usable even though it is ${statusMeta(feature.status).label.toLowerCase()} for everyone else.` },
            { key: 'deny', label: 'Withdraw access', help: 'Hidden from this account, whatever the rollout says.' },
          ].map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setAccess(opt.key)}
              aria-pressed={access === opt.key}
              title={opt.help}
              style={{
                flex: 1, padding: '10px', borderRadius: '8px', fontSize: '0.83rem',
                fontWeight: '600', fontFamily: 'inherit', cursor: 'pointer',
                background: access === opt.key ? 'var(--primary-soft)' : 'transparent',
                color: access === opt.key ? 'var(--primary)' : 'var(--text-muted)',
                border: `1px solid ${access === opt.key ? 'var(--primary-border)' : 'var(--border-color)'}`,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div>
          <label style={labelStyle} htmlFor="feature-account-search">Account</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', ...inputStyle, padding: '7px 12px' }}>
            <Search size={14} style={{ color: 'var(--text-dimmed)', flexShrink: 0 }} />
            <input
              id="feature-account-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or email…"
              style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--text-main)', fontSize: '0.88rem', outline: 'none', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        <div style={{ maxHeight: '260px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {matches.length === 0 && (
            <p style={{ fontSize: '0.83rem', color: 'var(--text-dimmed)', margin: 0, padding: '12px', lineHeight: '1.5' }}>
              {accounts.length === 0
                ? 'No customer accounts yet. Exceptions apply to the account that owns a workspace.'
                : 'No account matches that search.'}
            </p>
          )}

          {matches.map((account) => {
            const current = existing.get(account.uid);
            const isSelected = selected === account.uid;
            return (
              <button
                key={account.uid}
                type="button"
                onClick={() => setSelected(account.uid)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left',
                  padding: '9px 12px', borderRadius: '8px', fontFamily: 'inherit', cursor: 'pointer',
                  background: isSelected ? 'var(--primary-soft)' : 'transparent',
                  border: `1px solid ${isSelected ? 'var(--primary-border)' : 'transparent'}`,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.87rem', fontWeight: '600', color: 'var(--text-main)' }}>
                    {account.name || account.email}
                  </span>
                  <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-dimmed)' }}>
                    {account.email}
                  </span>
                </span>
                {/* Says up front that submitting will replace what is already there. */}
                {current && (
                  <span style={{ fontSize: '0.68rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-dimmed)', whiteSpace: 'nowrap' }}>
                    has {current === 'allow' ? 'early access' : 'withdrawal'}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border-color)',
              color: 'var(--text-muted)', padding: '9px 16px', borderRadius: '8px',
              fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => selected && onSubmit(selected, access)}
            disabled={busy || !selected}
            style={{
              background: 'var(--primary)', border: 'none', color: 'var(--primary-contrast)',
              fontWeight: '600', padding: '9px 18px', borderRadius: '8px', fontSize: '0.85rem',
              fontFamily: 'inherit',
              cursor: busy || !selected ? 'not-allowed' : 'pointer',
              opacity: busy || !selected ? 0.6 : 1,
            }}
          >
            {access === 'allow' ? 'Grant access' : 'Withdraw access'}
          </button>
        </div>
      </div>
    </div>
  );
}
