import React, { useState, useMemo } from 'react';
import { adminUpdateUser, adminDeleteUser } from '../../utils/api.js';
import {
  Users, UserCheck, UserX, Shield, Search, Clock, Download, Filter, X,
  AlertTriangle, CheckCircle2, Sliders, Layers, RotateCcw, Trash2, Link2Off,
} from 'lucide-react';
import { showToast } from '../../utils/toastBus.js';
import {
  assignablePlans, resolveEffectiveLimits, findPlan, formatQuota,
} from '../../utils/plans.js';

// Escape a value for CSV. Beyond quoting, a leading =, +, - or @ makes a
// spreadsheet treat the cell as a formula, so a crafted display name could
// execute on open. Prefix those with an apostrophe to neutralise them.
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function formatDate(value) {
  if (!value) return '—';
  let date;
  if (typeof value.toDate === 'function') date = value.toDate();
  else if (typeof value.seconds === 'number') date = new Date(value.seconds * 1000);
  else date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Small pill marking whether a limit comes from the plan or a per-user override.
function SourceBadge({ source }) {
  const isOverride = source === 'override';
  return (
    <span
      title={isOverride ? 'Custom value set for this user; plan changes will not affect it' : 'Inherited from the assigned plan'}
      style={{
        fontSize: '0.65rem',
        fontWeight: '700',
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        padding: '1px 6px',
        borderRadius: '4px',
        background: isOverride ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.06)',
        color: isOverride ? '#f59e0b' : 'var(--text-dimmed)',
        border: `1px solid ${isOverride ? 'rgba(245,158,11,0.25)' : 'var(--border-color)'}`,
      }}
    >
      {isOverride ? 'Custom' : 'Plan'}
    </span>
  );
}

export default function UsersTab({ currentUser, users, loading, error, plans, plansLoading, onRefresh }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pending' | 'approved'
  const [planFilter, setPlanFilter] = useState('all');

  // { type, userObj, ...payload }
  const [activeModal, setActiveModal] = useState(null);
  const [modalInputValue, setModalInputValue] = useState('');
  // Rows with an in-flight write, so the affected controls can be disabled
  // instead of silently accepting a second click.
  const [pendingUids, setPendingUids] = useState([]);

  const selectablePlans = useMemo(() => assignablePlans(plans), [plans]);

  const isPending = (uid) => pendingUids.includes(uid);

  // Wraps every mutation: marks the row busy, reports success or the real error
  // through the toast bus, refreshes the registry, and always clears the flag.
  //
  // The server validates each of these too (see routes-data.js), so a rejection
  // arrives as a readable message rather than a permissions error.
  const runMutation = async (uid, label, mutate) => {
    if (isPending(uid)) return;
    setPendingUids(prev => [...prev, uid]);
    try {
      await mutate();
      showToast({ type: 'success', title: label, message: 'Change saved.' });
      setActiveModal(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error(`[Admin] ${label} failed:`, err);
      showToast({
        type: 'error',
        title: `${label} failed`,
        message: err?.message || 'The server rejected the change. Please try again.',
        duration: 5200,
      });
    } finally {
      setPendingUids(prev => prev.filter(id => id !== uid));
    }
  };

  // --- Approval -------------------------------------------------------------
  const handleToggleApproval = (targetUid, currentApproval) =>
    runMutation(targetUid, currentApproval ? 'Access revoked' : 'Account approved', () =>
      adminUpdateUser(targetUid, { isApproved: !currentApproval })
    );

  // --- Role -----------------------------------------------------------------
  // The only genuinely unsafe demotion is one that leaves zero admins. Demoting
  // *another* admin can never do that, because you are an admin yourself and
  // cannot demote your own account. An earlier version of this guard counted only
  // the other admins and refused when that reached one, which wrongly blocked the
  // ordinary case of two admins demoting each other. The server enforces the real
  // rule (see routes-data.js), so this is just a courtesy check that avoids a
  // pointless round trip.
  const adminCount = users.filter(u => u.role === 'admin').length;

  const openRoleModal = (userObj) => {
    if (userObj.uid === currentUser.uid) {
      showToast({
        type: 'error',
        title: 'Not allowed',
        message: 'You cannot change your own role. Ask another admin to do it.',
      });
      return;
    }

    const targetRole = userObj.role === 'admin' ? 'customer' : 'admin';

    if (targetRole === 'customer' && adminCount <= 1) {
      showToast({
        type: 'error',
        title: 'Not allowed',
        message: 'This is the only remaining admin. Promote another account first.',
        duration: 5200,
      });
      return;
    }

    setActiveModal({ type: 'confirmRole', userObj, targetRole });
  };

  const confirmRoleChange = () => {
    const { userObj, targetRole } = activeModal;
    return runMutation(userObj.uid, 'Role updated', () =>
      adminUpdateUser(userObj.uid, { role: targetRole })
    );
  };

  // --- Plan assignment ------------------------------------------------------
  const openPlanModal = (userObj) => {
    const effective = resolveEffectiveLimits(userObj, plans);
    setModalInputValue(effective.planId);
    setActiveModal({ type: 'changePlan', userObj });
  };

  const confirmPlanChange = () => {
    const { userObj } = activeModal;
    const nextPlan = findPlan(plans, modalInputValue);
    return runMutation(userObj.uid, 'Plan updated', () =>
      adminUpdateUser(userObj.uid, { planId: nextPlan.id })
    );
  };

  // --- Limit overrides ------------------------------------------------------
  const openLimitModal = (userObj) => {
    const effective = resolveEffectiveLimits(userObj, plans);
    setModalInputValue(String(effective.messageLimit));
    setActiveModal({ type: 'editLimit', userObj, effective });
  };

  const confirmLimitChange = () => {
    const { userObj } = activeModal;
    const newLimit = parseInt(modalInputValue, 10);
    if (!Number.isFinite(newLimit) || newLimit < 0) {
      showToast({ type: 'error', title: 'Invalid value', message: 'Enter a whole number of 0 or more.' });
      return;
    }
    return runMutation(userObj.uid, 'Message quota updated', () =>
      adminUpdateUser(userObj.uid, { messageLimit: newLimit })
    );
  };

  const openSessionLimitModal = (userObj) => {
    const effective = resolveEffectiveLimits(userObj, plans);
    setModalInputValue(String(effective.sessionLimit));
    setActiveModal({ type: 'editSessionLimit', userObj, effective });
  };

  const confirmSessionLimitChange = () => {
    const { userObj } = activeModal;
    const newLimit = parseInt(modalInputValue, 10);
    if (!Number.isFinite(newLimit) || newLimit < 1) {
      showToast({ type: 'error', title: 'Invalid value', message: 'A user needs at least one device session.' });
      return;
    }
    return runMutation(userObj.uid, 'Device limit updated', () =>
      adminUpdateUser(userObj.uid, { sessionLimit: newLimit })
    );
  };

  // Removing the field makes the user track their plan again.
  const clearOverride = (userObj, field, label) =>
    runMutation(userObj.uid, `${label} reset to plan`, () =>
      adminUpdateUser(userObj.uid, { [field]: null })
    );

  // --- Usage counter --------------------------------------------------------
  const confirmResetUsage = () => {
    const { userObj } = activeModal;
    return runMutation(userObj.uid, 'Usage counter reset', () =>
      adminUpdateUser(userObj.uid, { messagesSent: 0 })
    );
  };

  // --- Trial ----------------------------------------------------------------
  const handleToggleTrialExpired = (userObj) =>
    runMutation(userObj.uid, 'Trial status updated', () =>
      adminUpdateUser(userObj.uid, { trialExpired: !(userObj.trialExpired || false) })
    );

  // --- Delete ---------------------------------------------------------------
  const confirmDeleteUser = () => {
    const { userObj } = activeModal;
    return runMutation(userObj.uid, 'Profile deleted', () =>
      adminDeleteUser(userObj.uid)
    );
  };

  // --- Filtering ------------------------------------------------------------
  // Documents written before `role` existed have no role at all. Treating
  // anything that isn't an admin as a customer keeps those rows visible in the
  // Pending and Approved views instead of hiding them from every filter.
  const isCustomer = (u) => (u.role || 'customer') !== 'admin';

  const filteredUsers = users.filter((u) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      (u.name || '').toLowerCase().includes(query) ||
      (u.email || '').toLowerCase().includes(query);

    let matchesStatus = true;
    if (statusFilter === 'pending') matchesStatus = !u.isApproved && isCustomer(u);
    else if (statusFilter === 'approved') matchesStatus = Boolean(u.isApproved) && isCustomer(u);

    const matchesPlan =
      planFilter === 'all' || resolveEffectiveLimits(u, plans).planId === planFilter;

    return matchesSearch && matchesStatus && matchesPlan;
  });

  const totalUsers = users.length;
  const pendingUsers = users.filter(u => !u.isApproved && isCustomer(u)).length;
  const approvedUsers = users.filter(u => Boolean(u.isApproved) && isCustomer(u)).length;

  // --- CSV ------------------------------------------------------------------
  const handleExportCSV = () => {
    if (filteredUsers.length === 0) {
      showToast({ type: 'error', title: 'Nothing to export', message: 'No users match the current filters.' });
      return;
    }

    const headers = [
      'UID', 'Name', 'Email', 'Role', 'Approved', 'Plan', 'Trial Expired',
      'Session Limit', 'Session Limit Source', 'Messages Sent', 'Message Limit',
      'Message Limit Source', 'Registered',
    ];

    const rows = filteredUsers.map((u) => {
      const e = resolveEffectiveLimits(u, plans);
      return [
        csvCell(u.uid),
        csvCell(u.name || ''),
        csvCell(u.email || ''),
        csvCell(u.role || 'customer'),
        u.isApproved ? 'Yes' : 'No',
        csvCell(e.planName),
        u.trialExpired ? 'Yes' : 'No',
        e.sessionLimit,
        e.sessionLimitSource,
        u.messagesSent || 0,
        e.messageLimit,
        e.messageLimitSource,
        csvCell(formatDate(u.createdAt)),
      ];
    });

    const csvContent = [headers.map(csvCell).join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `WAgateway_Users_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast({ type: 'success', title: 'Export ready', message: `${filteredUsers.length} rows written to CSV.` });
  };

  const statCards = [
    {
      id: 'all', label: 'Total Registrations', value: totalUsers,
      icon: Users, accent: 'var(--primary)', glow: 'rgba(0,168,132,0.2)',
    },
    {
      id: 'pending', label: 'Pending Verification', value: pendingUsers,
      icon: Clock, accent: '#f59e0b', glow: 'rgba(245,158,11,0.2)',
    },
    {
      id: 'approved', label: 'Approved Customers', value: approvedUsers,
      icon: UserCheck, accent: 'var(--primary)', glow: 'rgba(0,168,132,0.2)',
    },
  ];

  return (
    <>
      {/* Clickable stat cards double as the status filter */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        {statCards.map((card) => {
          const Icon = card.icon;
          const isActive = statusFilter === card.id;
          return (
            <button
              key={card.id}
              type="button"
              className="glass"
              onClick={() => setStatusFilter(card.id)}
              aria-pressed={isActive}
              style={{
                padding: '24px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                cursor: 'pointer',
                textAlign: 'left',
                border: isActive ? `2px solid ${card.accent}` : '1px solid var(--border-color)',
                borderLeft: `4px solid ${card.accent}`,
                boxShadow: isActive ? `0 0 16px ${card.glow}` : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              <div
                className="feature-card-icon"
                style={{ marginBottom: 0, color: card.accent, background: `${card.glow}` }}
              >
                <Icon size={22} />
              </div>
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-dimmed)' }}>{card.label}</div>
                <div style={{ fontSize: '1.8rem', fontWeight: '700', color: card.accent }}>{card.value}</div>
                {isActive && (
                  <span style={{ fontSize: '0.75rem', color: card.accent, fontWeight: '600' }}>Active Filter</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Registry */}
      <div className="glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700' }}>Customer Registry</h3>
            <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-dimmed)' }}>
              {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div className="search-input-wrapper" style={{ width: '240px' }}>
              <Search className="search-icon" />
              <input
                type="text"
                placeholder="Search name or email..."
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Filter size={14} style={{ color: 'var(--text-muted)' }} />
              <select
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
                aria-label="Filter by plan"
                style={{
                  background: 'var(--bg-main)', color: 'var(--text-main)',
                  border: '1px solid var(--border-color)', padding: '8px 12px',
                  borderRadius: '8px', fontSize: '0.85rem', outline: 'none', cursor: 'pointer',
                }}
              >
                <option value="all">All Plans</option>
                {selectablePlans.map(plan => (
                  <option key={plan.id} value={plan.id}>{plan.name}</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleExportCSV}
              style={{
                background: 'rgba(0,168,132,0.1)', border: '1px solid rgba(0,168,132,0.3)',
                color: 'var(--primary)', padding: '8px 14px', borderRadius: '8px',
                fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '6px',
              }}
            >
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        {plansLoading === false && plans.length === 0 && (
          <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', borderLeft: '4px solid #f59e0b', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            No plans defined yet, so built-in fallback limits are being applied. Open the <strong>Plans</strong> tab to create them.
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px' }}><div className="spinner"></div></div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#ef4444', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={28} />
            <div style={{ fontWeight: '600' }}>Could not load the customer registry</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', maxWidth: '460px' }}>
              {error} This usually means the signed-in address is not on the admin allow-list in firestore.rules.
            </div>
          </div>
        ) : filteredUsers.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.95rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-dimmed)', fontWeight: '600' }}>
                  <th style={{ padding: '12px 16px' }}>Name &amp; Email</th>
                  <th style={{ padding: '12px 16px' }}>Registered</th>
                  <th style={{ padding: '12px 16px' }}>Role</th>
                  <th style={{ padding: '12px 16px' }}>Status</th>
                  <th style={{ padding: '12px 16px' }}>Plan</th>
                  <th style={{ padding: '12px 16px' }}>Trial Expired</th>
                  <th style={{ padding: '12px 16px' }}>Devices</th>
                  <th style={{ padding: '12px 16px' }}>Message Quota</th>
                  <th style={{ padding: '12px 16px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isMe = u.uid === currentUser.uid;
                  const busy = isPending(u.uid);
                  const effective = resolveEffectiveLimits(u, plans);
                  const sent = u.messagesSent || 0;
                  const limit = effective.messageLimit;
                  const pct = limit > 0 ? Math.min(100, Math.round((sent / limit) * 100)) : 0;

                  let barColor = 'var(--primary)';
                  if (pct >= 90) barColor = '#ef4444';
                  else if (pct >= 70) barColor = '#f59e0b';

                  return (
                    <tr
                      key={u.uid}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        opacity: busy ? 0.55 : 1,
                        transition: 'opacity 0.2s, background-color 0.2s',
                      }}
                    >
                      <td style={{ padding: '16px' }}>
                        <div style={{ fontWeight: '600', color: 'var(--text-main)' }}>{u.name || 'N/A'}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.email}</div>
                      </td>

                      <td style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {formatDate(u.createdAt)}
                      </td>

                      <td style={{ padding: '16px' }}>
                        <button
                          onClick={() => openRoleModal(u)}
                          disabled={isMe || busy}
                          title={isMe ? 'You cannot modify your own role' : 'Click to toggle role'}
                          style={{
                            background: u.role === 'admin' ? 'rgba(0,168,132,0.1)' : 'rgba(255,255,255,0.05)',
                            border: '1px solid ' + (u.role === 'admin' ? 'rgba(0,168,132,0.2)' : 'var(--border-color)'),
                            color: u.role === 'admin' ? 'var(--primary)' : 'var(--text-muted)',
                            padding: '4px 10px', borderRadius: '4px', fontSize: '0.8rem',
                            fontWeight: '600', cursor: isMe || busy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {(u.role || 'customer').toUpperCase()}
                        </button>
                      </td>

                      <td style={{ padding: '16px' }}>
                        <span
                          className={`status-badge ${u.isApproved ? 'connected' : 'disconnected'}`}
                          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                        >
                          <span className="status-dot"></span>
                          {u.isApproved ? 'Approved' : 'Pending'}
                        </span>
                      </td>

                      {/* Plan assignment */}
                      <td style={{ padding: '16px' }}>
                        <button
                          onClick={() => openPlanModal(u)}
                          disabled={busy}
                          title="Click to change the assigned plan"
                          style={{
                            background: effective.plan.price > 0 ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)',
                            border: '1px solid ' + (effective.plan.price > 0 ? 'rgba(16,185,129,0.2)' : 'var(--border-color)'),
                            color: effective.plan.price > 0 ? 'var(--primary)' : 'var(--text-muted)',
                            padding: '4px 10px', borderRadius: '4px', fontSize: '0.8rem',
                            fontWeight: '600', cursor: busy ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {effective.planName.toUpperCase()}
                        </button>
                        {effective.planMissing && (
                          <div style={{ fontSize: '0.7rem', color: '#f59e0b', marginTop: '4px' }}>
                            plan "{u.planId || u.tier}" missing
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '16px' }}>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={u.trialExpired || false}
                            onChange={() => handleToggleTrialExpired(u)}
                            disabled={u.role === 'admin' || busy}
                          />
                          <span className="slider round"></span>
                        </label>
                      </td>

                      {/* Device limit */}
                      <td style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{effective.sessionLimit}</span>
                          <SourceBadge source={effective.sessionLimitSource} />
                          <button
                            onClick={() => openSessionLimitModal(u)}
                            disabled={busy}
                            style={{
                              background: 'transparent', border: '1px solid var(--border-color)',
                              padding: '3px 8px', borderRadius: '4px', fontSize: '0.75rem',
                              color: 'var(--text-muted)', cursor: busy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      </td>

                      {/* Message quota */}
                      <td style={{ padding: '16px', minWidth: '200px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              {formatQuota(sent)} / {formatQuota(limit)}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <SourceBadge source={effective.messageLimitSource} />
                              <button
                                onClick={() => openLimitModal(u)}
                                disabled={busy}
                                style={{
                                  background: 'transparent', border: 'none', color: 'var(--primary)',
                                  fontSize: '0.75rem', cursor: busy ? 'not-allowed' : 'pointer',
                                  textDecoration: 'underline',
                                }}
                              >
                                Change
                              </button>
                            </div>
                          </div>

                          <div style={{ height: '6px', width: '100%', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '3px', transition: 'width 0.3s' }}></div>
                          </div>

                          <button
                            onClick={() => setActiveModal({ type: 'resetUsage', userObj: u })}
                            disabled={busy || sent === 0}
                            title="Set the sent-message counter back to zero"
                            style={{
                              alignSelf: 'flex-start', background: 'transparent', border: 'none',
                              color: sent === 0 ? 'var(--text-dimmed)' : 'var(--text-muted)',
                              fontSize: '0.7rem', cursor: busy || sent === 0 ? 'not-allowed' : 'pointer',
                              padding: 0, display: 'inline-flex', alignItems: 'center', gap: '4px',
                            }}
                          >
                            <RotateCcw size={11} /> Reset usage
                          </button>
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '16px' }}>
                        {isMe ? (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-dimmed)' }}>(Current Admin)</span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => handleToggleApproval(u.uid, u.isApproved)}
                              disabled={busy}
                              style={{
                                background: u.isApproved ? 'rgba(239, 68, 68, 0.1)' : 'rgba(0, 168, 132, 0.1)',
                                border: '1px solid ' + (u.isApproved ? 'rgba(239, 68, 68, 0.2)' : 'rgba(0, 168, 132, 0.2)'),
                                color: u.isApproved ? '#ef4444' : 'var(--primary)',
                                padding: '6px 12px', borderRadius: '6px', fontSize: '0.85rem',
                                fontWeight: '600', cursor: busy ? 'not-allowed' : 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                              }}
                            >
                              {u.isApproved ? <><UserX size={14} /> Revoke</> : <><UserCheck size={14} /> Approve</>}
                            </button>

                            <button
                              onClick={() => setActiveModal({ type: 'deleteUser', userObj: u })}
                              disabled={busy}
                              title="Delete this profile document"
                              aria-label={`Delete ${u.email || 'user'}`}
                              style={{
                                background: 'transparent', border: '1px solid var(--border-color)',
                                color: 'var(--text-muted)', padding: '6px 8px', borderRadius: '6px',
                                cursor: busy ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center',
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-dimmed)', padding: '40px' }}>
            No user accounts found matching your selected filters.
          </div>
        )}
      </div>

      {/* Modals */}
      {activeModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(6px)',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
            zIndex: 9999, padding: '20px',
          }}
        >
          <div
            className="glass"
            style={{
              width: '100%', maxWidth: '440px', padding: '28px', borderRadius: '16px',
              display: 'flex', flexDirection: 'column', gap: '20px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)', border: '1px solid var(--border-color)',
              background: 'var(--bg-main)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                {activeModal.type === 'editLimit' && <><Sliders size={18} style={{ color: 'var(--primary)' }} /> Update Message Quota</>}
                {activeModal.type === 'editSessionLimit' && <><Layers size={18} style={{ color: 'var(--primary)' }} /> Update Device Limit</>}
                {activeModal.type === 'confirmRole' && <><Shield size={18} style={{ color: '#f59e0b' }} /> Change Account Role</>}
                {activeModal.type === 'changePlan' && <><CheckCircle2 size={18} style={{ color: 'var(--primary)' }} /> Assign Plan</>}
                {activeModal.type === 'resetUsage' && <><RotateCcw size={18} style={{ color: 'var(--primary)' }} /> Reset Usage Counter</>}
                {activeModal.type === 'deleteUser' && <><Trash2 size={18} style={{ color: '#ef4444' }} /> Delete Profile</>}
              </h3>
              <button
                onClick={() => setActiveModal(null)}
                aria-label="Close dialog"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)' }}>
                User: {activeModal.userObj?.name || 'Unnamed Account'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Email: {activeModal.userObj?.email}
              </div>
            </div>

            {activeModal.type === 'editLimit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label htmlFor="admin-quota-input" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  New message quota (overrides the plan):
                </label>
                <input
                  id="admin-quota-input"
                  type="number"
                  min="0"
                  value={modalInputValue}
                  onChange={(e) => setModalInputValue(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: '8px',
                    border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)',
                    color: 'var(--text-main)', fontSize: '1rem', outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[500, 1000, 5000, 10000, 50000].map(val => (
                    <button
                      key={val}
                      onClick={() => setModalInputValue(String(val))}
                      style={{
                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
                        color: 'var(--text-muted)', padding: '4px 10px', borderRadius: '6px',
                        fontSize: '0.75rem', cursor: 'pointer',
                      }}
                    >
                      {val.toLocaleString()}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)' }}>
                  Plan <strong>{activeModal.effective?.planName}</strong> grants{' '}
                  {formatQuota(activeModal.effective?.plan?.messageLimit)} messages.
                </div>
                {activeModal.effective?.messageLimitSource === 'override' && (
                  <button
                    onClick={() => clearOverride(activeModal.userObj, 'messageLimit', 'Message quota')}
                    style={{
                      alignSelf: 'flex-start', background: 'transparent',
                      border: '1px solid var(--border-color)', color: 'var(--text-muted)',
                      padding: '6px 10px', borderRadius: '6px', fontSize: '0.78rem',
                      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
                    }}
                  >
                    <Link2Off size={13} /> Remove override and follow the plan
                  </button>
                )}
              </div>
            )}

            {activeModal.type === 'editSessionLimit' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label htmlFor="admin-device-input" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Allowed concurrent device sessions (overrides the plan):
                </label>
                <input
                  id="admin-device-input"
                  type="number"
                  min="1"
                  value={modalInputValue}
                  onChange={(e) => setModalInputValue(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: '8px',
                    border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)',
                    color: 'var(--text-main)', fontSize: '1rem', outline: 'none',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[1, 2, 3, 5, 10].map(val => (
                    <button
                      key={val}
                      onClick={() => setModalInputValue(String(val))}
                      style={{
                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
                        color: 'var(--text-muted)', padding: '4px 10px', borderRadius: '6px',
                        fontSize: '0.75rem', cursor: 'pointer',
                      }}
                    >
                      {val} {val === 1 ? 'Device' : 'Devices'}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)' }}>
                  Plan <strong>{activeModal.effective?.planName}</strong> grants{' '}
                  {activeModal.effective?.plan?.sessionLimit} device
                  {activeModal.effective?.plan?.sessionLimit === 1 ? '' : 's'}.
                </div>
                {activeModal.effective?.sessionLimitSource === 'override' && (
                  <button
                    onClick={() => clearOverride(activeModal.userObj, 'sessionLimit', 'Device limit')}
                    style={{
                      alignSelf: 'flex-start', background: 'transparent',
                      border: '1px solid var(--border-color)', color: 'var(--text-muted)',
                      padding: '6px 10px', borderRadius: '6px', fontSize: '0.78rem',
                      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
                    }}
                  >
                    <Link2Off size={13} /> Remove override and follow the plan
                  </button>
                )}
              </div>
            )}

            {activeModal.type === 'changePlan' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label htmlFor="admin-plan-select" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Plan:
                </label>
                <select
                  id="admin-plan-select"
                  value={modalInputValue}
                  onChange={(e) => setModalInputValue(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: '8px',
                    border: '1px solid var(--border-color)', background: 'var(--bg-main)',
                    color: 'var(--text-main)', fontSize: '0.95rem', outline: 'none', cursor: 'pointer',
                  }}
                >
                  {selectablePlans.map(plan => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} — {formatQuota(plan.messageLimit)} msgs, {plan.sessionLimit} device
                      {plan.sessionLimit === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)', lineHeight: '1.5' }}>
                  The user inherits this plan's limits unless a custom value is set for them. Fields
                  marked <strong>Custom</strong> in the table stay untouched.
                </div>
              </div>
            )}

            {activeModal.type === 'confirmRole' && (
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                Change the role of this account to{' '}
                <strong style={{ color: 'var(--primary)' }}>{activeModal.targetRole.toUpperCase()}</strong>?

                {activeModal.targetRole === 'admin' && (
                  <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(245,158,11,0.08)', borderLeft: '3px solid #f59e0b', borderRadius: '6px', fontSize: '0.8rem' }}>
                    Promoting grants full admin console access: this account will be able to see and
                    change every customer, plan and live session, including yours. It is also approved
                    automatically.
                  </div>
                )}

                {activeModal.targetRole === 'customer' && (
                  <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(245,158,11,0.08)', borderLeft: '3px solid #f59e0b', borderRadius: '6px', fontSize: '0.8rem' }}>
                    They lose admin console access immediately and are signed out of every device, so
                    they will need to log in again as a regular user. Their approval, plan and message
                    usage are left untouched, and quota and device limits now apply to them.
                  </div>
                )}
              </div>
            )}

            {activeModal.type === 'resetUsage' && (
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                Set this user's sent-message counter back to <strong>0</strong>? Their quota stays the
                same, so this is what you want at the start of a new billing period.
              </div>
            )}

            {activeModal.type === 'deleteUser' && (
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                Permanently delete this account?
                <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444', borderRadius: '6px', fontSize: '0.8rem' }}>
                  The account, its password and its active sessions are removed, and the email becomes
                  available for a new signup. Their transactions are kept but no longer linked to a
                  user. WhatsApp credentials under <code>sessions/</code> are not deleted — disconnect
                  the device from the Live Sessions tab first if that matters. Revoke access instead if
                  you only want to block the user.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              <button
                onClick={() => setActiveModal(null)}
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
                  if (activeModal.type === 'editLimit') confirmLimitChange();
                  if (activeModal.type === 'editSessionLimit') confirmSessionLimitChange();
                  if (activeModal.type === 'confirmRole') confirmRoleChange();
                  if (activeModal.type === 'changePlan') confirmPlanChange();
                  if (activeModal.type === 'resetUsage') confirmResetUsage();
                  if (activeModal.type === 'deleteUser') confirmDeleteUser();
                }}
                disabled={isPending(activeModal.userObj?.uid)}
                style={{
                  background: activeModal.type === 'deleteUser' ? '#ef4444' : 'var(--primary)',
                  border: 'none',
                  color: activeModal.type === 'deleteUser' ? '#fff' : '#000',
                  fontWeight: '600', padding: '8px 18px', borderRadius: '8px',
                  fontSize: '0.85rem',
                  cursor: isPending(activeModal.userObj?.uid) ? 'wait' : 'pointer',
                  opacity: isPending(activeModal.userObj?.uid) ? 0.6 : 1,
                }}
              >
                {activeModal.type === 'deleteUser' ? 'Delete Profile' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
