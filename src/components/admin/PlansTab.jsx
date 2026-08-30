import React, { useState, useMemo } from 'react';
import { adminSavePlan, adminSetDefaultPlan, adminDeletePlan } from '../../utils/api.js';
import {
  Layers, Plus, Pencil, Trash2, Archive, ArchiveRestore, Star, X,
  AlertTriangle, Users as UsersIcon, Sparkles,
} from 'lucide-react';
import { showToast } from '../../utils/toastBus.js';
import {
  FALLBACK_PLANS, normalizePlan, sortPlans,
  resolveUserPlanId, planPriceLabel, formatQuota,
} from '../../utils/plans.js';

const BLANK_FORM = {
  id: '',
  name: '',
  description: '',
  price: '0',
  currency: 'IDR',
  messageLimit: '500',
  sessionLimit: '1',
  trialDays: '0',
  featuresText: '',
  isDefault: false,
  sortOrder: '100',
};

function formToPlan(form) {
  return {
    id: form.id,
    name: form.name.trim() || form.id,
    description: form.description.trim(),
    price: Number(form.price) || 0,
    currency: form.currency.trim() || 'IDR',
    messageLimit: Math.max(0, parseInt(form.messageLimit, 10) || 0),
    sessionLimit: Math.max(1, parseInt(form.sessionLimit, 10) || 1),
    trialDays: Math.max(0, parseInt(form.trialDays, 10) || 0),
    features: form.featuresText
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean),
    isDefault: Boolean(form.isDefault),
    sortOrder: parseInt(form.sortOrder, 10) || 0,
  };
}

function planToForm(plan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description || '',
    price: String(plan.price ?? 0),
    currency: plan.currency || 'IDR',
    messageLimit: String(plan.messageLimit ?? 0),
    sessionLimit: String(plan.sessionLimit ?? 1),
    trialDays: String(plan.trialDays ?? 0),
    featuresText: (plan.features || []).join('\n'),
    isDefault: Boolean(plan.isDefault),
    sortOrder: String(plan.sortOrder ?? 100),
  };
}

const inputStyle = {
  width: '100%', padding: '9px 12px', borderRadius: '8px',
  border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)',
  color: 'var(--text-main)', fontSize: '0.9rem', outline: 'none',
};

const labelStyle = { fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '5px', display: 'block' };

export default function PlansTab({ plans, loading, error, users, onPlansChanged, onRefresh }) {
  // { mode: 'create' | 'edit', form } — null when closed
  const [editor, setEditor] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // How many customers sit on each plan, so archiving or deleting a plan that is
  // still in use can be flagged before it happens.
  const usageByPlan = useMemo(() => {
    const counts = {};
    users.forEach((u) => {
      const id = resolveUserPlanId(u);
      counts[id] = (counts[id] || 0) + 1;
    });
    return counts;
  }, [users]);

  // Each admin plan endpoint returns the full catalogue after the write, so the
  // UI updates from the server's view rather than a locally guessed one. The
  // server also broadcasts 'plans-updated' to every other client.
  const run = async (label, mutate) => {
    if (busy) return;
    setBusy(true);
    try {
      const nextPlans = await mutate();
      if (Array.isArray(nextPlans) && onPlansChanged) {
        onPlansChanged(sortPlans(nextPlans.map(p => normalizePlan(p.id, p))));
      } else if (onRefresh) {
        await onRefresh();
      }
      showToast({ type: 'success', title: label, message: 'Change saved.' });
      setEditor(null);
      setConfirmAction(null);
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

  // Write the built-in catalogue on first use, so a fresh deployment has
  // something to assign instead of falling back to hardcoded numbers.
  //
  // Migration 001_init.sql already seeds Free and Premium, so this is only
  // reached if they were later deleted.
  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      let latest = [];
      for (const plan of FALLBACK_PLANS) {
        latest = await adminSavePlan(normalizePlan(plan.id, plan));
      }
      if (onPlansChanged) {
        onPlansChanged(sortPlans(latest.map(p => normalizePlan(p.id, p))));
      }
      showToast({ type: 'success', title: 'Default plans created', message: 'Free and Premium are ready to assign.' });
    } catch (err) {
      console.error('[Admin] Seeding plans failed:', err);
      showToast({
        type: 'error',
        title: 'Could not create default plans',
        message: err?.message || 'The server rejected the request.',
        duration: 5200,
      });
    } finally {
      setSeeding(false);
    }
  };

  const openCreate = () => setEditor({ mode: 'create', form: { ...BLANK_FORM } });
  const openEdit = (plan) => setEditor({ mode: 'edit', form: planToForm(plan) });

  const updateForm = (patch) => setEditor(prev => ({ ...prev, form: { ...prev.form, ...patch } }));

  const handleSavePlan = () => {
    const { mode, form } = editor;
    const id = form.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

    if (!id) {
      showToast({ type: 'error', title: 'Plan id required', message: 'Use lowercase letters, numbers, dashes or underscores.' });
      return;
    }
    if (!form.name.trim()) {
      showToast({ type: 'error', title: 'Plan name required', message: 'Give the plan a display name.' });
      return;
    }
    if (mode === 'create' && plans.some(p => p.id === id)) {
      showToast({ type: 'error', title: 'Plan already exists', message: `"${id}" is already defined.` });
      return;
    }

    const payload = formToPlan({ ...form, id });

    // Only one plan may be the signup default. That is enforced by a partial
    // unique index in Postgres and applied in a transaction server-side, so the
    // client no longer has to clear the flag on the others itself.
    return run(mode === 'create' ? 'Plan created' : 'Plan updated', () =>
      adminSavePlan({
        ...payload,
        archived: mode === 'edit' ? plans.find(p => p.id === id)?.archived || false : false,
      })
    );
  };

  const handleSetDefault = (plan) =>
    run('Default plan updated', () => adminSetDefaultPlan(plan.id));

  const handleToggleArchive = (plan) =>
    run(plan.archived ? 'Plan restored' : 'Plan archived', () =>
      adminSavePlan({ ...plan, archived: !plan.archived, isDefault: false })
    );

  const handleDeletePlan = (plan) =>
    run('Plan deleted', () => adminDeletePlan(plan.id));

  const ordered = sortPlans(plans);
  const defaultPlanId = ordered.find(p => p.isDefault && !p.archived)?.id;

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="spinner"></div></div>;
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={18} style={{ color: 'var(--primary)' }} /> Plan Catalogue
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '6px 0 0', maxWidth: '620px', lineHeight: '1.5' }}>
            Message quota and device limits are resolved from these plans, so raising a limit here
            applies to every customer on that plan at once. Customers with a <strong>Custom</strong>
            {' '}value on the Customers tab keep their override until you remove it.
          </p>
        </div>

        <button
          onClick={openCreate}
          style={{
            background: 'var(--primary)', border: 'none', color: '#000', fontWeight: '600',
            padding: '10px 16px', borderRadius: '8px', fontSize: '0.85rem', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
          }}
        >
          <Plus size={15} /> New Plan
        </button>
      </div>

      {error && (
        <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '4px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <strong style={{ color: '#ef4444' }}>Could not read the plan catalogue.</strong> {error}
          <div style={{ marginTop: '6px' }}>
            Deploy the updated <code>firestore.rules</code>, which adds the <code>plans</code> collection.
          </div>
        </div>
      )}

      {!error && ordered.length === 0 && (
        <div className="glass" style={{ padding: '40px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
          <div className="feature-card-icon" style={{ marginBottom: 0 }}><Sparkles size={22} /></div>
          <div style={{ fontWeight: '700', fontSize: '1.05rem' }}>No plans defined yet</div>
          <p style={{ fontSize: '0.87rem', color: 'var(--text-muted)', maxWidth: '460px', margin: 0, lineHeight: '1.5' }}>
            Until a plan exists the app falls back to the limits that used to be hardcoded: 500
            messages and 1 device. Create the standard Free and Premium plans to start managing them
            from here.
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              style={{
                background: 'var(--primary)', border: 'none', color: '#000', fontWeight: '600',
                padding: '10px 16px', borderRadius: '8px', fontSize: '0.85rem',
                cursor: seeding ? 'wait' : 'pointer', opacity: seeding ? 0.6 : 1,
              }}
            >
              {seeding ? 'Creating…' : 'Create Free & Premium'}
            </button>
            <button
              onClick={openCreate}
              style={{
                background: 'transparent', border: '1px solid var(--border-color)',
                color: 'var(--text-muted)', padding: '10px 16px', borderRadius: '8px',
                fontSize: '0.85rem', cursor: 'pointer',
              }}
            >
              Start from scratch
            </button>
          </div>
        </div>
      )}

      {ordered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
          {ordered.map((plan) => {
            const inUse = usageByPlan[plan.id] || 0;
            const isDefault = plan.id === defaultPlanId;

            return (
              <div
                key={plan.id}
                className="glass"
                style={{
                  padding: '22px', display: 'flex', flexDirection: 'column', gap: '14px',
                  border: isDefault ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                  opacity: plan.archived ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '1.1rem', fontWeight: '700' }}>{plan.name}</span>
                      {isDefault && (
                        <span style={{ fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase', padding: '2px 7px', borderRadius: '4px', background: 'rgba(0,168,132,0.12)', color: 'var(--primary)', border: '1px solid rgba(0,168,132,0.25)' }}>
                          Signup default
                        </span>
                      )}
                      {plan.archived && (
                        <span style={{ fontSize: '0.65rem', fontWeight: '700', textTransform: 'uppercase', padding: '2px 7px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-dimmed)', border: '1px solid var(--border-color)' }}>
                          Archived
                        </span>
                      )}
                    </div>
                    <code style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)' }}>{plan.id}</code>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--primary)' }}>{planPriceLabel(plan)}</div>
                  </div>
                </div>

                {plan.description && (
                  <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', margin: 0, lineHeight: '1.5' }}>{plan.description}</p>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[
                    { label: 'Messages', value: formatQuota(plan.messageLimit) },
                    { label: 'Devices', value: plan.sessionLimit },
                    { label: 'Trial days', value: plan.trialDays || '—' },
                  ].map(stat => (
                    <div key={stat.label} style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-dimmed)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{stat.label}</div>
                      <div style={{ fontSize: '1rem', fontWeight: '700' }}>{stat.value}</div>
                    </div>
                  ))}
                </div>

                {plan.features.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.7' }}>
                    {plan.features.map((feature, i) => <li key={i}>{feature}</li>)}
                  </ul>
                )}

                <div style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <UsersIcon size={13} /> {inUse} {inUse === 1 ? 'customer' : 'customers'} on this plan
                </div>

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '4px' }}>
                  <button
                    onClick={() => openEdit(plan)}
                    disabled={busy}
                    style={{
                      background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
                      color: 'var(--text-main)', padding: '7px 12px', borderRadius: '6px',
                      fontSize: '0.8rem', cursor: busy ? 'not-allowed' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                    }}
                  >
                    <Pencil size={13} /> Edit
                  </button>

                  {!isDefault && !plan.archived && (
                    <button
                      onClick={() => handleSetDefault(plan)}
                      disabled={busy}
                      title="New signups will be placed on this plan"
                      style={{
                        background: 'transparent', border: '1px solid var(--border-color)',
                        color: 'var(--text-muted)', padding: '7px 12px', borderRadius: '6px',
                        fontSize: '0.8rem', cursor: busy ? 'not-allowed' : 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                      }}
                    >
                      <Star size={13} /> Make default
                    </button>
                  )}

                  <button
                    onClick={() => setConfirmAction({ type: 'archive', plan, inUse })}
                    disabled={busy}
                    style={{
                      background: 'transparent', border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)', padding: '7px 12px', borderRadius: '6px',
                      fontSize: '0.8rem', cursor: busy ? 'not-allowed' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                    }}
                  >
                    {plan.archived ? <><ArchiveRestore size={13} /> Restore</> : <><Archive size={13} /> Archive</>}
                  </button>

                  <button
                    onClick={() => setConfirmAction({ type: 'delete', plan, inUse })}
                    disabled={busy}
                    aria-label={`Delete plan ${plan.name}`}
                    style={{
                      background: 'transparent', border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)', padding: '7px 9px', borderRadius: '6px',
                      cursor: busy ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center',
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Plan editor */}
      {editor && (
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
              width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', padding: '28px',
              borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '16px',
              border: '1px solid var(--border-color)', background: 'var(--bg-main)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Layers size={18} style={{ color: 'var(--primary)' }} />
                {editor.mode === 'create' ? 'New Plan' : `Edit ${editor.form.name || editor.form.id}`}
              </h3>
              <button
                onClick={() => setEditor(null)}
                aria-label="Close dialog"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle} htmlFor="plan-id">Plan id</label>
                <input
                  id="plan-id"
                  style={{ ...inputStyle, opacity: editor.mode === 'edit' ? 0.6 : 1 }}
                  value={editor.form.id}
                  disabled={editor.mode === 'edit'}
                  placeholder="premium"
                  onChange={(e) => updateForm({ id: e.target.value })}
                />
              </div>
              <div>
                <label style={labelStyle} htmlFor="plan-name">Display name</label>
                <input
                  id="plan-name"
                  style={inputStyle}
                  value={editor.form.name}
                  placeholder="Premium"
                  onChange={(e) => updateForm({ name: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle} htmlFor="plan-description">Description</label>
              <input
                id="plan-description"
                style={inputStyle}
                value={editor.form.description}
                placeholder="Shown on the plan card in this console"
                onChange={(e) => updateForm({ description: e.target.value })}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle} htmlFor="plan-price">Price</label>
                <input id="plan-price" type="number" min="0" style={inputStyle} value={editor.form.price} onChange={(e) => updateForm({ price: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="plan-currency">Currency</label>
                <input id="plan-currency" style={inputStyle} value={editor.form.currency} onChange={(e) => updateForm({ currency: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="plan-sort">Sort order</label>
                <input id="plan-sort" type="number" style={inputStyle} value={editor.form.sortOrder} onChange={(e) => updateForm({ sortOrder: e.target.value })} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
              <div>
                <label style={labelStyle} htmlFor="plan-messages">Message quota</label>
                <input id="plan-messages" type="number" min="0" style={inputStyle} value={editor.form.messageLimit} onChange={(e) => updateForm({ messageLimit: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="plan-devices">Device limit</label>
                <input id="plan-devices" type="number" min="1" style={inputStyle} value={editor.form.sessionLimit} onChange={(e) => updateForm({ sessionLimit: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle} htmlFor="plan-trial">Trial days</label>
                <input id="plan-trial" type="number" min="0" style={inputStyle} value={editor.form.trialDays} onChange={(e) => updateForm({ trialDays: e.target.value })} />
              </div>
            </div>

            <div>
              <label style={labelStyle} htmlFor="plan-features">Features (one per line)</label>
              <textarea
                id="plan-features"
                style={{ ...inputStyle, minHeight: '90px', resize: 'vertical', fontFamily: 'inherit' }}
                value={editor.form.featuresText}
                placeholder={'5 WhatsApp devices\n50,000 outbound messages'}
                onChange={(e) => updateForm({ featuresText: e.target.value })}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={editor.form.isDefault}
                onChange={(e) => updateForm({ isDefault: e.target.checked })}
              />
              Assign this plan to new signups
            </label>

            <div style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)', lineHeight: '1.5' }}>
              Trial days of 0 disables the trial countdown for this plan. The device limit is enforced
              by the backend when a browser connects.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setEditor(null)}
                style={{
                  background: 'transparent', border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)', padding: '9px 16px', borderRadius: '8px',
                  fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSavePlan}
                disabled={busy}
                style={{
                  background: 'var(--primary)', border: 'none', color: '#000', fontWeight: '600',
                  padding: '9px 18px', borderRadius: '8px', fontSize: '0.85rem',
                  cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
                }}
              >
                {editor.mode === 'create' ? 'Create Plan' : 'Save Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive / delete confirmation */}
      {confirmAction && (
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
              width: '100%', maxWidth: '440px', padding: '28px', borderRadius: '16px',
              display: 'flex', flexDirection: 'column', gap: '18px',
              border: '1px solid var(--border-color)', background: 'var(--bg-main)',
            }}
          >
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              {confirmAction.type === 'delete'
                ? <><Trash2 size={17} style={{ color: '#ef4444' }} /> Delete plan</>
                : confirmAction.plan.archived
                  ? <><ArchiveRestore size={17} style={{ color: 'var(--primary)' }} /> Restore plan</>
                  : <><Archive size={17} style={{ color: '#f59e0b' }} /> Archive plan</>}
            </h3>

            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.55' }}>
              <strong style={{ color: 'var(--text-main)' }}>{confirmAction.plan.name}</strong>{' '}
              {confirmAction.type === 'delete'
                ? 'will be removed from the catalogue.'
                : confirmAction.plan.archived
                  ? 'will be assignable again.'
                  : 'will stay applied to existing customers but disappear from the assignment dropdown.'}

              {confirmAction.inUse > 0 && confirmAction.type === 'delete' && (
                <div style={{ marginTop: '12px', padding: '10px 12px', background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444', borderRadius: '6px', fontSize: '0.82rem', display: 'flex', gap: '8px' }}>
                  <AlertTriangle size={15} style={{ color: '#ef4444', flexShrink: 0, marginTop: '1px' }} />
                  <span>
                    {confirmAction.inUse} {confirmAction.inUse === 1 ? 'customer is' : 'customers are'} still
                    on this plan. They will fall back to the default plan's limits. Archive it instead if
                    you only want to stop new assignments.
                  </span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setConfirmAction(null)}
                style={{
                  background: 'transparent', border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)', padding: '8px 16px', borderRadius: '8px',
                  fontSize: '0.85rem', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmAction.type === 'delete') handleDeletePlan(confirmAction.plan);
                  else handleToggleArchive(confirmAction.plan);
                }}
                disabled={busy}
                style={{
                  background: confirmAction.type === 'delete' ? '#ef4444' : 'var(--primary)',
                  border: 'none', color: confirmAction.type === 'delete' ? '#fff' : '#000',
                  fontWeight: '600', padding: '8px 18px', borderRadius: '8px', fontSize: '0.85rem',
                  cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
                }}
              >
                {confirmAction.type === 'delete'
                  ? 'Delete plan'
                  : confirmAction.plan.archived ? 'Restore plan' : 'Archive plan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
