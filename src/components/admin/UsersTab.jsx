import React, { useState, useMemo } from 'react';
import { adminUpdateUser, adminDeleteUser, adminSetFeatureAccess, adminClearFeatureAccess } from '../../utils/api.js';
import {
  Users, UserCheck, UserX, Shield, Search, Clock, Download, Filter, X,
  AlertTriangle, CheckCircle2, Sliders, Layers, RotateCcw, Trash2, Link2Off,
  ToggleLeft, Lock, ShieldCheck, ShieldOff, CornerDownRight, Crown, UsersRound,
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

// Small pill marking where a limit came from: the plan, agents the customer paid
// for, or an explicit per-user override.
const SOURCE_LABEL = {
  override: { label: 'Custom', title: 'Custom value set for this user; plan changes will not affect it' },
  purchased: { label: 'Paid', title: 'Agents the customer purchased; sits above the plan but below an admin override' },
  plan: { label: 'Plan', title: 'Inherited from the assigned plan' },
};

function SourceBadge({ source }) {
  const meta = SOURCE_LABEL[source] || SOURCE_LABEL.plan;
  const accent = source === 'override' ? '#f59e0b' : source === 'purchased' ? 'var(--success)' : null;

  return (
    <span
      title={meta.title}
      style={{
        fontSize: '0.65rem',
        fontWeight: '700',
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        padding: '1px 6px',
        borderRadius: '4px',
        background: source === 'override' ? 'rgba(245,158,11,0.12)'
          : source === 'purchased' ? 'var(--success-soft)'
          : 'rgba(255,255,255,0.06)',
        color: accent || 'var(--text-dimmed)',
        border: `1px solid ${source === 'override' ? 'rgba(245,158,11,0.25)'
          : source === 'purchased' ? 'var(--success-border)'
          : 'var(--border-color)'}`,
      }}
    >
      {meta.label}
    </span>
  );
}

export default function UsersTab({
  currentUser, users, loading, error, plans, plansLoading, onRefresh,
  features = [], onFeaturesChanged, onRefreshFeatures,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'pending' | 'approved'
  const [accountTypeFilter, setAccountTypeFilter] = useState('all'); // 'all' | 'workspaces' | 'members'
  const [planFilter, setPlanFilter] = useState('all');

  // { type, userObj, ...payload }
  const [activeModal, setActiveModal] = useState(null);
  const [modalInputValue, setModalInputValue] = useState('');
  const [featuresUser, setFeaturesUser] = useState(null);
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
  const getTrialInfo = (u, effective) => {
    // If this is a team member, always evaluate against the workspace owner
    if (u.ownerUserId) {
      const owner = (users || []).find(o => o.uid === u.ownerUserId);
      if (owner) {
        const ownerEffective = resolveEffectiveLimits(owner, plans);
        return getTrialInfo(owner, ownerEffective);
      }
    }

    if (u.role === 'admin') return { label: 'Admin (No trial)', isExpired: false, isCustom: false, daysLeft: null };
    if (u.trialExpired) return { label: 'Expired', isExpired: true, isCustom: Boolean(u.trialEndsAt || u.customTrialDays), daysLeft: 0 };
    
    if (u.trialEndsAt) {
      const endsAt = new Date(u.trialEndsAt);
      if (Number.isFinite(endsAt.getTime())) {
        const msLeft = endsAt.getTime() - Date.now();
        if (msLeft <= 0) {
          return { label: 'Expired', isExpired: true, isCustom: true, daysLeft: 0, endsAt };
        }
        const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
        return { label: `${daysLeft}d left`, isExpired: false, isCustom: true, daysLeft, endsAt };
      }
    }

    const trialDays = u.customTrialDays ?? effective.plan?.trialDays ?? 0;
    if (trialDays > 0) {
      const refDate = u.ownerCreatedAt || u.createdAt;
      let createdAtDate = refDate ? new Date(refDate) : new Date();
      const diffDays = (Date.now() - createdAtDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays >= trialDays) {
        return { label: 'Expired', isExpired: true, isCustom: Boolean(u.customTrialDays), daysLeft: 0 };
      }
      const daysLeft = Math.max(0, trialDays - Math.floor(diffDays));
      return { label: `${daysLeft}d left`, isExpired: false, isCustom: Boolean(u.customTrialDays), daysLeft };
    }

    return { label: 'No trial', isExpired: false, isCustom: false, daysLeft: null };
  };

  const openTrialModal = (userObj, trialInfo) => {
    const defaultDays = trialInfo.daysLeft && trialInfo.daysLeft > 0 ? trialInfo.daysLeft : 7;
    setModalInputValue(String(defaultDays));
    setActiveModal({
      type: 'editTrial',
      userObj,
      trialInfo,
      customDays: String(defaultDays),
      isExpired: trialInfo.isExpired,
    });
  };

  const confirmTrialChange = (days, isExpired = false) => {
    const { userObj } = activeModal;
    const numDays = parseInt(days, 10);
    if (!Number.isFinite(numDays) || numDays < 0) {
      showToast({ type: 'error', title: 'Invalid days', message: 'Enter a valid number of days (0 or more).' });
      return;
    }

    if (isExpired || numDays === 0) {
      return runMutation(userObj.uid, 'Trial expired', () =>
        adminUpdateUser(userObj.uid, {
          trialExpired: true,
          trialEndsAt: new Date().toISOString(),
          customTrialDays: numDays,
        })
      );
    }

    const endsAt = new Date(Date.now() + numDays * 24 * 60 * 60 * 1000);
    return runMutation(userObj.uid, `Trial set to ${numDays} days`, () =>
      adminUpdateUser(userObj.uid, {
        trialExpired: false,
        trialEndsAt: endsAt.toISOString(),
        customTrialDays: numDays,
      })
    );
  };

  const resetTrialToPlan = (userObj) => {
    return runMutation(userObj.uid, 'Trial reset to plan default', () =>
      adminUpdateUser(userObj.uid, {
        trialExpired: false,
        trialEndsAt: null,
        customTrialDays: null,
      })
    );
  };

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

  const memberCountsByOwner = useMemo(() => {
    const counts = {};
    (users || []).forEach(u => {
      if (u.ownerUserId) {
        counts[u.ownerUserId] = (counts[u.ownerUserId] || 0) + 1;
      }
    });
    return counts;
  }, [users]);

  const filteredUsers = useMemo(() => {
    return (users || []).filter((u) => {
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        (u.name || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query) ||
        (u.ownerEmail || '').toLowerCase().includes(query) ||
        (u.ownerName || '').toLowerCase().includes(query);

      let matchesStatus = true;
      if (statusFilter === 'pending') matchesStatus = !u.isApproved && isCustomer(u);
      else if (statusFilter === 'approved') matchesStatus = Boolean(u.isApproved) && isCustomer(u);

      let matchesType = true;
      if (accountTypeFilter === 'workspaces') matchesType = !u.ownerUserId;
      else if (accountTypeFilter === 'members') matchesType = Boolean(u.ownerUserId);

      const matchesPlan =
        planFilter === 'all' || resolveEffectiveLimits(u, plans).planId === planFilter;

      return matchesSearch && matchesStatus && matchesType && matchesPlan;
    });
  }, [users, searchQuery, statusFilter, accountTypeFilter, planFilter, plans]);

  const totalUsers = users.length;
  const pendingUsers = users.filter(u => !u.isApproved && isCustomer(u)).length;
  const approvedUsers = users.filter(u => Boolean(u.isApproved) && isCustomer(u)).length;
  const workspaceOwnersCount = users.filter(u => !u.ownerUserId).length;
  const teamMembersCount = users.filter(u => Boolean(u.ownerUserId)).length;

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
    link.setAttribute('download', `OmniReach_Users_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast({ type: 'success', title: 'Export ready', message: `${filteredUsers.length} rows written to CSV.` });
  };

  const statCards = [
    {
      id: 'all', label: 'Total Registrations', value: totalUsers,
      icon: Users, accent: 'var(--primary)', glow: 'var(--primary-glow)',
    },
    {
      id: 'pending', label: 'Pending Verification', value: pendingUsers,
      icon: Clock, accent: '#f59e0b', glow: 'rgba(245,158,11,0.2)',
    },
    {
      id: 'approved', label: 'Approved Customers', value: approvedUsers,
      icon: UserCheck, accent: 'var(--success)', glow: 'var(--success-glow)',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: '700', margin: 0 }}>Customer Registry</h3>
            <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-dimmed)' }}>
              {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'}
            </span>

            {/* Quick account type selector */}
            <div style={{ display: 'flex', gap: '6px', marginLeft: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setAccountTypeFilter('all')}
                style={{
                  padding: '4px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600',
                  background: accountTypeFilter === 'all' ? 'var(--primary-subtle)' : 'transparent',
                  color: accountTypeFilter === 'all' ? 'var(--primary)' : 'var(--text-muted)',
                  border: `1px solid ${accountTypeFilter === 'all' ? 'var(--primary-border)' : 'var(--border-color)'}`,
                  cursor: 'pointer',
                }}
              >
                All ({totalUsers})
              </button>
              <button
                type="button"
                onClick={() => setAccountTypeFilter('workspaces')}
                style={{
                  padding: '4px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600',
                  background: accountTypeFilter === 'workspaces' ? 'var(--primary-subtle)' : 'transparent',
                  color: accountTypeFilter === 'workspaces' ? 'var(--primary)' : 'var(--text-muted)',
                  border: `1px solid ${accountTypeFilter === 'workspaces' ? 'var(--primary-border)' : 'var(--border-color)'}`,
                  cursor: 'pointer',
                }}
              >
                Workspaces ({workspaceOwnersCount})
              </button>
              {teamMembersCount > 0 && (
                <button
                  type="button"
                  onClick={() => setAccountTypeFilter('members')}
                  style={{
                    padding: '4px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600',
                    background: accountTypeFilter === 'members' ? 'var(--primary-subtle)' : 'transparent',
                    color: accountTypeFilter === 'members' ? 'var(--primary)' : 'var(--text-muted)',
                    border: `1px solid ${accountTypeFilter === 'members' ? 'var(--primary-border)' : 'var(--border-color)'}`,
                    cursor: 'pointer',
                  }}
                >
                  Team Members ({teamMembersCount})
                </button>
              )}
            </div>
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
                background: 'var(--primary-soft)', border: '1px solid var(--primary-border)',
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
                  <th style={{ padding: '12px 16px' }}>Trial Status</th>
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
                        background: u.ownerUserId ? 'rgba(255,255,255,0.018)' : 'transparent',
                        opacity: busy ? 0.55 : 1,
                        transition: 'opacity 0.2s, background-color 0.2s',
                      }}
                    >
                      {/* Name & Email */}
                      <td style={{ padding: '16px' }}>
                        {u.ownerUserId ? (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', paddingLeft: '16px' }}>
                            <CornerDownRight size={15} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '3px' }} />
                            <div>
                              <div style={{ fontWeight: '600', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                {u.name || 'Unnamed Member'}
                                <span style={{ fontSize: '0.65rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: 'var(--primary-subtle)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
                                  Team Member
                                </span>
                              </div>
                              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.email}</div>
                              <div style={{ fontSize: '0.73rem', color: 'var(--text-dimmed)', marginTop: '3px' }}>
                                ↳ Workspace: <strong style={{ color: 'var(--text-main)' }}>{u.ownerName || u.ownerEmail}</strong>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontWeight: '600', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              {u.name || 'N/A'}
                              {u.role !== 'admin' && (
                                <span style={{ fontSize: '0.65rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                                  Workspace Owner
                                </span>
                              )}
                              {memberCountsByOwner[u.uid] > 0 && (
                                <span style={{ fontSize: '0.65rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
                                  {memberCountsByOwner[u.uid]} Member{memberCountsByOwner[u.uid] === 1 ? '' : 's'}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.email}</div>
                          </div>
                        )}
                      </td>

                      <td style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {formatDate(u.createdAt)}
                      </td>

                      {/* Role */}
                      <td style={{ padding: '16px' }}>
                        {u.ownerUserId ? (
                          <span
                            title={`Team member of ${u.ownerName || u.ownerEmail}`}
                            style={{
                              background: 'var(--primary-soft)',
                              border: '1px solid var(--primary-border)',
                              color: 'var(--primary)',
                              padding: '4px 10px', borderRadius: '4px', fontSize: '0.78rem',
                              fontWeight: '700', display: 'inline-block',
                            }}
                          >
                            MEMBER
                          </span>
                        ) : (
                          <button
                            onClick={() => openRoleModal(u)}
                            disabled={isMe || busy}
                            title={isMe ? 'You cannot modify your own role' : 'Click to toggle role'}
                            style={{
                              background: u.role === 'admin' ? 'var(--primary-soft)' : 'rgba(255,255,255,0.05)',
                              border: '1px solid ' + (u.role === 'admin' ? 'var(--primary-border)' : 'var(--border-color)'),
                              color: u.role === 'admin' ? 'var(--primary)' : 'var(--text-muted)',
                              padding: '4px 10px', borderRadius: '4px', fontSize: '0.8rem',
                              fontWeight: '600', cursor: isMe || busy ? 'not-allowed' : 'pointer',
                            }}
                          >
                            {(u.role || 'customer').toUpperCase()}
                          </button>
                        )}
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
                        {u.ownerUserId ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)' }}>
                                {effective.planName.toUpperCase()}
                              </span>
                              <span style={{ fontSize: '0.65rem', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-dimmed)', border: '1px solid var(--border-color)' }}>
                                Inherited
                              </span>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)' }}>
                              From workspace
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => openPlanModal(u)}
                              disabled={busy}
                              title="Click to change the assigned plan"
                              style={{
                                background: effective.plan.price > 0 ? 'var(--success-soft)' : 'rgba(255,255,255,0.05)',
                                border: '1px solid ' + (effective.plan.price > 0 ? 'var(--success-border)' : 'var(--border-color)'),
                                color: effective.plan.price > 0 ? 'var(--success)' : 'var(--text-muted)',
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
                          </>
                        )}
                      </td>

                      {/* Trial status & custom period */}
                      <td style={{ padding: '16px' }}>
                        {(() => {
                          const trialInfo = getTrialInfo(u, effective);
                          const isExpired = trialInfo.isExpired;
                          const hasTrial = trialInfo.daysLeft !== null || isExpired;
                          
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                <span
                                  style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                                    fontSize: '0.74rem', fontWeight: '700', padding: '2px 8px', borderRadius: '5px',
                                    background: isExpired ? 'rgba(239, 68, 68, 0.12)' : hasTrial ? 'var(--success-soft)' : 'rgba(255,255,255,0.05)',
                                    color: isExpired ? '#ef4444' : hasTrial ? 'var(--success)' : 'var(--text-dimmed)',
                                    border: `1px solid ${isExpired ? 'rgba(239, 68, 68, 0.25)' : hasTrial ? 'var(--success-border)' : 'var(--border-color)'}`,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <span style={{
                                    width: '6px', height: '6px', borderRadius: '50%',
                                    backgroundColor: isExpired ? '#ef4444' : hasTrial ? 'var(--success)' : 'var(--text-dimmed)',
                                  }} />
                                  {trialInfo.label}
                                </span>
                                {trialInfo.isCustom && <SourceBadge source="override" />}
                              </div>

                              {u.ownerUserId ? (
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)' }}>
                                  Inherits workspace trial
                                </div>
                              ) : u.role !== 'admin' ? (
                                <button
                                  onClick={() => openTrialModal(u, trialInfo)}
                                  disabled={busy}
                                  title="Change trial duration or expire trial"
                                  style={{
                                    alignSelf: 'flex-start', background: 'transparent', border: 'none',
                                    color: 'var(--primary)', fontSize: '0.73rem', fontWeight: '600',
                                    cursor: busy ? 'not-allowed' : 'pointer', padding: 0,
                                    textDecoration: 'underline',
                                  }}
                                >
                                  {trialInfo.isCustom ? 'Edit Days' : 'Set Trial'}
                                </button>
                              ) : null}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Device limit */}
                      <td style={{ padding: '16px' }}>
                        {u.ownerUserId ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>1 Seat</span>
                            <span style={{ fontSize: '0.65rem', fontWeight: '700', padding: '1px 5px', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-dimmed)' }}>
                              Inherited
                            </span>
                          </div>
                        ) : (
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
                        )}
                      </td>

                      {/* Message quota */}
                      <td style={{ padding: '16px', minWidth: '200px' }}>
                        {u.ownerUserId ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Shared: <strong>{formatQuota(sent)}</strong> / {formatQuota(limit)}
                            </div>
                            <div style={{ height: '6px', width: '100%', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: '3px', transition: 'width 0.3s' }}></div>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)' }}>
                              Workspace pool
                            </div>
                          </div>
                        ) : (
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
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '16px' }}>
                        {isMe ? (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-dimmed)' }}>(Current Admin)</span>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                              onClick={() => setFeaturesUser(u)}
                              disabled={busy}
                              title="Control feature access for this customer"
                              style={{
                                background: 'var(--primary-soft)',
                                border: '1px solid var(--primary-border)',
                                color: 'var(--primary)',
                                padding: '6px 11px',
                                borderRadius: '6px',
                                fontSize: '0.82rem',
                                fontWeight: '600',
                                cursor: busy ? 'not-allowed' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <ToggleLeft size={14} /> Features
                            </button>

                            <button
                              onClick={() => handleToggleApproval(u.uid, u.isApproved)}
                              disabled={busy}
                              style={{
                                background: u.isApproved ? 'rgba(239, 68, 68, 0.1)' : 'var(--success-soft)',
                                border: '1px solid ' + (u.isApproved ? 'rgba(239, 68, 68, 0.2)' : 'var(--success-border)'),
                                color: u.isApproved ? '#ef4444' : 'var(--success)',
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
                {activeModal.type === 'editTrial' && <><Clock size={18} style={{ color: 'var(--primary)' }} /> Set Trial Period</>}
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

            {activeModal.type === 'editTrial' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  Set a custom trial duration for <strong>{activeModal.userObj?.name || activeModal.userObj?.email}</strong>.
                  This grants an active trial period starting from today.
                </div>

                {/* Quick Presets */}
                <div>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    Quick presets (days from now):
                  </label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {[3, 7, 14, 30, 60].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setModalInputValue(String(val))}
                        style={{
                          background: modalInputValue === String(val) ? 'var(--primary-soft)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${modalInputValue === String(val) ? 'var(--primary-border)' : 'var(--border-color)'}`,
                          color: modalInputValue === String(val) ? 'var(--primary)' : 'var(--text-muted)',
                          padding: '5px 12px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        {val} Days
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Days Input */}
                <div>
                  <label htmlFor="custom-trial-days-input" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                    Custom Trial Length (number of days):
                  </label>
                  <input
                    id="custom-trial-days-input"
                    type="number"
                    min="0"
                    max="365"
                    value={modalInputValue}
                    onChange={(e) => setModalInputValue(e.target.value)}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: '8px',
                      border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.05)',
                      color: 'var(--text-main)', fontSize: '1rem', outline: 'none',
                    }}
                  />
                  {(() => {
                    const days = parseInt(modalInputValue, 10);
                    if (Number.isFinite(days) && days > 0) {
                      const expDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
                      return (
                        <div style={{ fontSize: '0.78rem', color: 'var(--success)', marginTop: '6px' }}>
                          ✓ Trial will be active until: <strong>{expDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</strong> ({days} days from now)
                        </div>
                      );
                    }
                    if (days === 0) {
                      return (
                        <div style={{ fontSize: '0.78rem', color: '#ef4444', marginTop: '6px' }}>
                          Setting to 0 days will expire the trial immediately.
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                {/* Reset to plan default */}
                {(activeModal.userObj?.trialEndsAt || activeModal.userObj?.customTrialDays) && (
                  <button
                    type="button"
                    onClick={() => {
                      resetTrialToPlan(activeModal.userObj);
                      setActiveModal(null);
                    }}
                    style={{
                      alignSelf: 'flex-start', background: 'transparent',
                      border: '1px solid var(--border-color)', color: 'var(--text-muted)',
                      padding: '6px 12px', borderRadius: '6px', fontSize: '0.78rem',
                      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
                    }}
                  >
                    <Link2Off size={13} /> Reset to Plan Default (remove custom days)
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
                  if (activeModal.type === 'editTrial') confirmTrialChange(modalInputValue);
                  if (activeModal.type === 'confirmRole') confirmRoleChange();
                  if (activeModal.type === 'changePlan') confirmPlanChange();
                  if (activeModal.type === 'resetUsage') confirmResetUsage();
                  if (activeModal.type === 'deleteUser') confirmDeleteUser();
                }}
                disabled={isPending(activeModal.userObj?.uid)}
                style={{
                  background: activeModal.type === 'deleteUser' ? '#ef4444' : 'var(--primary)',
                  border: 'none',
                  color: activeModal.type === 'deleteUser' ? '#fff' : 'var(--primary-contrast)',
                  fontWeight: '600', padding: '8px 18px', borderRadius: '8px',
                  fontSize: '0.85rem',
                  cursor: isPending(activeModal.userObj?.uid) ? 'wait' : 'pointer',
                  opacity: isPending(activeModal.userObj?.uid) ? 0.6 : 1,
                }}
              >
                {activeModal.type === 'deleteUser' ? 'Delete Profile' : activeModal.type === 'editTrial' ? 'Apply Trial' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {featuresUser && (
        <CustomerFeaturesDialog
          targetUser={featuresUser}
          features={features}
          onClose={() => setFeaturesUser(null)}
          onFeaturesChanged={onFeaturesChanged}
          onRefreshFeatures={onRefreshFeatures}
        />
      )}
    </>
  );
}

/**
 * Dialog to control feature access specifically for a single customer.
 */
function CustomerFeaturesDialog({ targetUser, features = [], onClose, onFeaturesChanged, onRefreshFeatures }) {
  const [busyKey, setBusyKey] = useState(null);
  const [search, setSearch] = useState('');

  const runChange = async (key, mutate) => {
    if (busyKey) return;
    setBusyKey(key);
    try {
      const next = await mutate();
      if (Array.isArray(next) && onFeaturesChanged) onFeaturesChanged(next);
      else if (onRefreshFeatures) await onRefreshFeatures();
      showToast({ type: 'success', title: 'Feature access updated', message: 'Change saved.' });
    } catch (err) {
      console.error('[Admin] Feature access update failed:', err);
      showToast({ type: 'error', title: 'Update failed', message: err?.message || 'Could not update feature access.' });
    } finally {
      setBusyKey(null);
    }
  };

  const handleSetAccess = (key, access) => {
    return runChange(key, () => adminSetFeatureAccess(key, targetUser.uid, access));
  };

  const handleClearAccess = (key) => {
    return runChange(key, () => adminClearFeatureAccess(key, targetUser.uid));
  };

  const filteredFeatures = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return features;
    return features.filter(f => 
      (f.label && f.label.toLowerCase().includes(q)) ||
      (f.key && f.key.toLowerCase().includes(q)) ||
      (f.surface && f.surface.toLowerCase().includes(q)) ||
      (f.description && f.description.toLowerCase().includes(q))
    );
  }, [features, search]);

  const globalStatusBadge = (status) => {
    if (status === 'released') {
      return (
        <span style={{ fontSize: '0.7rem', fontWeight: '700', padding: '2px 7px', borderRadius: '4px', background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid var(--success-border)' }}>
          Global: Released
        </span>
      );
    }
    if (status === 'coming_soon') {
      return (
        <span style={{ fontSize: '0.7rem', fontWeight: '700', padding: '2px 7px', borderRadius: '4px', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }}>
          Global: Coming Soon
        </span>
      );
    }
    return (
      <span style={{ fontSize: '0.7rem', fontWeight: '700', padding: '2px 7px', borderRadius: '4px', background: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
        Global: Hidden
      </span>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px',
      }}
    >
      <div
        className="glass"
        style={{
          width: '100%', maxWidth: '720px', maxHeight: '88vh', overflowY: 'auto', padding: '26px',
          borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '16px',
          border: '1px solid var(--border-color)', background: 'var(--bg-main)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ToggleLeft size={19} style={{ color: 'var(--primary)' }} /> Feature Access for {targetUser.name || targetUser.email}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: '1.4' }}>
              Override which features are visible or hidden for <strong>{targetUser.email}</strong>. Custom settings take precedence over the global rollout status.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Search features..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px 8px 32px', borderRadius: '8px',
              border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.04)',
              color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none',
            }}
          />
        </div>

        {/* Features List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '52vh', overflowY: 'auto', paddingRight: '4px' }}>
          {filteredFeatures.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No features found.
            </div>
          ) : (
            filteredFeatures.map((f) => {
              const isLocked = Boolean(f.locked);
              const override = f.overrides?.find(o => o.userId === targetUser.uid)?.access;
              const isAllow = override === 'allow';
              const isDeny = override === 'deny';
              const isDefault = !override;
              const isBusy = busyKey === f.key;

              // What this customer actually experiences
              let effectiveStateText = 'Follows global rollout';
              if (isAllow) effectiveStateText = '🟢 Forced Available (Early Access)';
              else if (isDeny) effectiveStateText = '🔴 Forced Hidden from this customer';
              else if (f.status === 'released') effectiveStateText = 'Available (Global default)';
              else if (f.status === 'coming_soon') effectiveStateText = 'Coming soon badge (Global default)';
              else effectiveStateText = 'Hidden (Global default)';

              return (
                <div
                  key={f.key}
                  style={{
                    padding: '14px 16px', borderRadius: '10px',
                    border: `1px solid ${override ? (isAllow ? 'var(--primary-border)' : 'rgba(239,68,68,0.3)') : 'var(--border-color)'}`,
                    background: override ? (isAllow ? 'var(--primary-subtle)' : 'rgba(239,68,68,0.04)') : 'rgba(255,255,255,0.02)',
                    display: 'flex', flexDirection: 'column', gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>{f.label}</strong>
                        {globalStatusBadge(f.status)}
                        {isLocked && (
                          <span style={{ fontSize: '0.68rem', fontWeight: '700', padding: '1px 6px', borderRadius: '4px', background: 'var(--overlay-subtle)', color: 'var(--text-dimmed)' }}>
                            <Lock size={10} /> Always on
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {f.description}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)', marginTop: '4px' }}>
                        <strong>Status for customer:</strong> {effectiveStateText}
                      </div>
                    </div>

                    {/* Action Selector */}
                    {!isLocked ? (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => !isDefault && handleClearAccess(f.key)}
                          disabled={isBusy}
                          style={{
                            padding: '6px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600',
                            cursor: isBusy ? 'not-allowed' : 'pointer',
                            background: isDefault ? 'rgba(255,255,255,0.1)' : 'transparent',
                            color: isDefault ? 'var(--text-main)' : 'var(--text-muted)',
                            border: `1px solid ${isDefault ? 'var(--border-color)' : 'transparent'}`,
                          }}
                        >
                          Default (Rollout)
                        </button>
                        <button
                          type="button"
                          onClick={() => !isAllow && handleSetAccess(f.key, 'allow')}
                          disabled={isBusy}
                          style={{
                            padding: '6px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600',
                            cursor: isBusy ? 'not-allowed' : 'pointer',
                            background: isAllow ? 'var(--primary)' : 'transparent',
                            color: isAllow ? '#fff' : 'var(--primary)',
                            border: `1px solid ${isAllow ? 'var(--primary)' : 'var(--primary-border)'}`,
                          }}
                        >
                          <ShieldCheck size={12} style={{ marginRight: '4px' }} /> Force Show
                        </button>
                        <button
                          type="button"
                          onClick={() => !isDeny && handleSetAccess(f.key, 'deny')}
                          disabled={isBusy}
                          style={{
                            padding: '6px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600',
                            cursor: isBusy ? 'not-allowed' : 'pointer',
                            background: isDeny ? '#ef4444' : 'transparent',
                            color: isDeny ? '#fff' : '#ef4444',
                            border: `1px solid ${isDeny ? '#ef4444' : 'rgba(239,68,68,0.3)'}`,
                          }}
                        >
                          <ShieldOff size={12} style={{ marginRight: '4px' }} /> Force Hide
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dimmed)', fontStyle: 'italic' }}>
                        Core account feature
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'var(--primary)', border: 'none', color: 'var(--primary-contrast)',
              padding: '9px 20px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
