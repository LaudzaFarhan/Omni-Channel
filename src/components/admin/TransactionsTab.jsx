import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CreditCard, RefreshCw, Trash2, AlertTriangle, X, Filter, CheckCircle2,
} from 'lucide-react';
import { apiFetch, apiJson } from '../../utils/api.js';
import { showToast } from '../../utils/toastBus.js';
import { formatIDR } from '../../utils/pricing.js';

const STATUS_STYLE = {
  PAID: { color: 'var(--success)', bg: 'var(--success-soft)', border: 'var(--success-border)' },
  PENDING: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
  FAILED: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.25)' },
  EXPIRED: { color: 'var(--text-dimmed)', bg: 'var(--overlay-subtle)', border: 'var(--border-color)' },
};

function StatusPill({ status }) {
  const key = String(status || '').toUpperCase();
  const s = STATUS_STYLE[key] || STATUS_STYLE.EXPIRED;
  return (
    <span style={{
      fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase',
      letterSpacing: '0.03em', padding: '3px 9px', borderRadius: '5px',
      color: s.color, background: s.bg, border: `1px solid ${s.border}`, whiteSpace: 'nowrap',
    }}>
      {key || 'UNKNOWN'}
    </span>
  );
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Transactions were previously invisible to admins: the customer could see their
// own, but nothing in the console listed them or allowed cleanup. Abandoned
// checkouts accumulate because a PENDING row is written before the payment
// gateway is called, so every attempt leaves a record whether or not it was paid.
export default function TransactionsTab({ users }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const emailByUid = useMemo(() => {
    const map = {};
    users.forEach((u) => { map[u.uid] = u.email; });
    return map;
  }, [users]);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/admin/transactions');
      setTransactions(data.transactions || []);
      setError(null);
    } catch (err) {
      console.error('[Admin] Transactions load failed:', err);
      setError(err.message || 'Could not load transactions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = transactions.filter(tx =>
    statusFilter === 'all' || String(tx.status).toUpperCase() === statusFilter
  );

  const counts = useMemo(() => {
    const c = { all: transactions.length };
    transactions.forEach((tx) => {
      const k = String(tx.status || '').toUpperCase();
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [transactions]);

  const handleDeleteOne = async (tx) => {
    setBusyId(tx.id);
    try {
      await apiJson(`/api/admin/transactions/${encodeURIComponent(tx.id)}`, 'DELETE');
      showToast({ type: 'success', title: 'Transaction deleted', message: tx.id });
      setConfirm(null);
      await load();
    } catch (err) {
      showToast({ type: 'error', title: 'Delete failed', message: err.message, duration: 5000 });
    } finally {
      setBusyId(null);
    }
  };

  // Mark a payment received outside the webhook as paid, and grant what it bought.
  //
  // The server runs the same fulfilment the webhook would, so this is not a status edit —
  // it moves the customer onto the plan and grants the agents. The toast reports what was
  // actually applied rather than just "saved", because that is the part worth checking.
  const handleApprove = async (tx) => {
    setBusyId(tx.id);
    try {
      const res = await apiJson(`/api/admin/transactions/${encodeURIComponent(tx.id)}/approve`, 'POST');
      const who = res.customerEmail || tx.email || tx.uid;
      showToast({
        type: 'success',
        title: 'Payment approved',
        message: res.appliedPlan
          ? `${who} is now on ${res.appliedPlan} with ${res.appliedAgents} agent${res.appliedAgents === 1 ? '' : 's'}.`
          : `${tx.id} marked paid.`,
      });

      // Paying does not clear an expired trial, so the customer can still be locked out
      // after a correct approval. Said separately and left on screen longer, because it
      // needs a second action on the Customers tab.
      if (res.trialStillExpired) {
        showToast({
          type: 'error',
          title: 'Trial still expired',
          message: `${who} remains blocked by the expired-trial lock. Clear it on the Customers tab.`,
          duration: 9000,
        });
      }

      setConfirm(null);
      await load();
    } catch (err) {
      showToast({ type: 'error', title: 'Approve failed', message: err.message, duration: 5000 });
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (payload, label) => {
    setBusyId('purge');
    try {
      const res = await apiJson('/api/admin/transactions/purge', 'POST', payload);
      showToast({
        type: 'success',
        title: 'Cleanup complete',
        message: `${res.removed} transaction${res.removed === 1 ? '' : 's'} removed (${label}).`,
      });
      setConfirm(null);
      await load();
    } catch (err) {
      showToast({ type: 'error', title: 'Cleanup failed', message: err.message, duration: 5000 });
    } finally {
      setBusyId(null);
    }
  };

  const pendingCount = counts.PENDING || 0;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CreditCard size={18} style={{ color: 'var(--primary)' }} /> Transactions
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '6px 0 0', maxWidth: '640px', lineHeight: '1.5' }}>
            A <strong>PENDING</strong> row is written before the customer is sent to the payment
            gateway, so every abandoned checkout leaves one behind. Deleting those is safe.
            <strong> PAID</strong> rows are your revenue record — delete them only deliberately.
            If money arrived but the row is still pending, <strong>Approve</strong> grants the
            purchase exactly as the payment gateway would have.
          </p>
        </div>

        <button
          onClick={load}
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

      {error && (
        <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '4px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          <strong style={{ color: '#ef4444' }}>Could not load transactions.</strong> {error}
        </div>
      )}

      {/* Cleanup actions */}
      <div className="glass" style={{ padding: '18px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-dimmed)' }}>
          Cleanup
        </span>

        <button
          onClick={() => setConfirm({
            type: 'purge',
            payload: { status: 'PENDING' },
            label: 'all pending',
            title: `Delete all ${pendingCount} pending transaction${pendingCount === 1 ? '' : 's'}?`,
            body: 'These are checkouts that were started but never paid. Removing them does not affect any customer\'s plan or access.',
          })}
          disabled={pendingCount === 0 || busyId === 'purge'}
          style={{
            background: pendingCount ? 'rgba(245,158,11,0.1)' : 'transparent',
            border: `1px solid ${pendingCount ? 'rgba(245,158,11,0.3)' : 'var(--border-color)'}`,
            color: pendingCount ? '#f59e0b' : 'var(--text-dimmed)',
            padding: '8px 14px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '600',
            cursor: pendingCount === 0 ? 'not-allowed' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: '6px',
          }}
        >
          <Trash2 size={14} /> Delete all pending ({pendingCount})
        </button>

        <button
          onClick={() => setConfirm({
            type: 'purge',
            payload: { status: 'PENDING', olderThanDays: 7 },
            label: 'pending older than 7 days',
            title: 'Delete pending transactions older than 7 days?',
            body: 'Keeps recent attempts in case a customer is still mid-payment, and clears the rest.',
          })}
          disabled={busyId === 'purge'}
          style={{
            background: 'transparent', border: '1px solid var(--border-color)',
            color: 'var(--text-muted)', padding: '8px 14px', borderRadius: '8px',
            fontSize: '0.85rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
          }}
        >
          <Filter size={14} /> Delete pending older than 7 days
        </button>
      </div>

      {/* Table */}
      <div className="glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['all', 'PENDING', 'PAID', 'FAILED', 'EXPIRED'].map((s) => {
            const n = s === 'all' ? counts.all : (counts[s] || 0);
            if (s !== 'all' && n === 0) return null;
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  background: active ? 'var(--primary)' : 'transparent',
                  border: `1px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
                  color: active ? 'var(--primary-contrast)' : 'var(--text-muted)',
                  padding: '5px 12px', borderRadius: '999px', fontSize: '0.8rem',
                  fontWeight: '600', cursor: 'pointer',
                }}
              >
                {s === 'all' ? 'All' : s} ({n})
              </button>
            );
          })}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><div className="spinner"></div></div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dimmed)', padding: '40px' }}>
            No transactions{statusFilter === 'all' ? ' yet' : ` with status ${statusFilter}`}.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-dimmed)', fontWeight: '600' }}>
                  <th style={{ padding: '12px 14px' }}>Date</th>
                  <th style={{ padding: '12px 14px' }}>Customer</th>
                  <th style={{ padding: '12px 14px' }}>Description</th>
                  <th style={{ padding: '12px 14px' }}>Amount</th>
                  <th style={{ padding: '12px 14px' }}>Status</th>
                  <th style={{ padding: '12px 14px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx) => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid var(--border-color)', opacity: busyId === tx.id ? 0.5 : 1 }}>
                    <td style={{ padding: '12px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDate(tx.createdAt)}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div>{emailByUid[tx.uid] || tx.email || <span style={{ color: 'var(--text-dimmed)' }}>unlinked</span>}</div>
                      <code style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)' }}>{tx.id}</code>
                    </td>
                    <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>{tx.item || '—'}</td>
                    <td style={{ padding: '12px 14px', fontWeight: '600', whiteSpace: 'nowrap' }}>
                      {formatIDR(tx.amount)}
                    </td>
                    <td style={{ padding: '12px 14px' }}><StatusPill status={tx.status} /></td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        {/* Only for rows that are not already paid. Approving twice would
                            grant an add-on's agents twice, which the server refuses — but
                            the button should not offer it either. */}
                        {String(tx.status).toUpperCase() !== 'PAID' && (
                          <button
                            onClick={() => setConfirm({
                              type: 'approve', tx,
                              tone: 'primary',
                              confirmLabel: 'Approve payment',
                              title: 'Mark this payment as received?',
                              body: tx.planId
                                ? `${emailByUid[tx.uid] || tx.email || 'This customer'} will be moved onto "${tx.planId}"`
                                  + `${tx.agents ? ` with ${tx.agents} agent${tx.agents === 1 ? '' : 's'}` : ''}`
                                  + `, exactly as an automatic ${formatIDR(tx.amount)} payment would. Use this only when the money has actually arrived.`
                                : 'This row does not record which plan it was for, so it cannot be fulfilled automatically. Set the plan on the Customers tab instead.',
                            })}
                            disabled={busyId === tx.id}
                            aria-label={`Approve ${tx.id}`}
                            title="Mark as paid and grant the purchase"
                            style={{
                              background: 'var(--success-soft)', border: '1px solid var(--success-border)',
                              color: 'var(--success)', padding: '5px 10px', borderRadius: '6px',
                              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px',
                              fontSize: '0.78rem', fontWeight: '600', fontFamily: 'inherit',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <CheckCircle2 size={13} /> Approve
                          </button>
                        )}

                        <button
                          onClick={() => setConfirm({
                            type: 'one', tx,
                            title: 'Delete this transaction?',
                            body: String(tx.status).toUpperCase() === 'PAID'
                              ? 'This is a PAID record. Deleting it removes evidence of a payment you received.'
                              : 'An unpaid checkout attempt. Safe to remove.',
                          })}
                          disabled={busyId === tx.id}
                          aria-label={`Delete ${tx.id}`}
                          style={{
                            background: 'transparent', border: '1px solid var(--border-color)',
                            color: 'var(--text-muted)', padding: '5px 8px', borderRadius: '6px',
                            cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation */}
      {confirm && (
        <div role="dialog" aria-modal="true" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px',
        }}>
          <div className="glass" style={{
            width: '100%', maxWidth: '450px', padding: '26px', borderRadius: '16px',
            display: 'flex', flexDirection: 'column', gap: '16px',
            border: '1px solid var(--border-color)', background: 'var(--bg-main)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* The icon follows the action. A green tick over "approve a payment" and a
                    warning triangle over a delete, rather than one alarm for everything. */}
                {confirm.tone === 'primary'
                  ? <CheckCircle2 size={17} style={{ color: 'var(--success)' }} />
                  : <AlertTriangle size={17} style={{ color: '#f59e0b' }} />}
                {confirm.title}
              </h3>
              <button onClick={() => setConfirm(null)} aria-label="Close"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0, lineHeight: '1.55' }}>
              {confirm.body}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => setConfirm(null)}
                style={{
                  background: 'transparent', border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)', padding: '8px 16px', borderRadius: '8px',
                  fontSize: '0.85rem', cursor: 'pointer',
                }}>
                Cancel
              </button>
              {/* Approving is not destructive, so it must not wear the delete button's red.
                  The label and colour come from `confirm` now that three actions share this
                  dialog, instead of every one of them reading "Delete". */}
              <button
                onClick={() => {
                  if (confirm.type === 'approve') return handleApprove(confirm.tx);
                  if (confirm.type === 'one') return handleDeleteOne(confirm.tx);
                  return handlePurge(confirm.payload, confirm.label);
                }}
                disabled={busyId !== null || (confirm.type === 'approve' && !confirm.tx.planId)}
                style={{
                  background: confirm.tone === 'primary' ? 'var(--success)' : '#ef4444',
                  border: 'none', color: '#fff', fontWeight: '600',
                  padding: '8px 18px', borderRadius: '8px', fontSize: '0.85rem',
                  cursor: busyId !== null ? 'wait' : 'pointer', opacity: busyId !== null ? 0.6 : 1,
                }}
              >
                {confirm.confirmLabel || 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
