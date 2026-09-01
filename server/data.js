// Data access for users, plans, transactions, refresh tokens and the audit log.
//
// Postgres columns are snake_case; the client already speaks the Firestore
// document shape (uid, isApproved, messageLimit, planId, ...). The mappers below
// translate at this boundary so the React code needs almost no changes.
//
// One subtlety carried over deliberately: message_limit and session_limit are
// NULL when the user inherits from their plan. resolveEffectiveLimits() in
// src/utils/plans.js already treats null/undefined as "no override", which is
// exactly what a missing Firestore field used to mean.

import { query, queryOne, withTransaction } from './db.js';
import { resolveFeatures } from './features.js';
import { hashRefreshToken, refreshTokenExpiry } from './auth.js';

// ---------------------------------------------------------------------------
// mappers
// ---------------------------------------------------------------------------
export function mapUser(row) {
  if (!row) return null;
  return {
    uid: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isApproved: row.is_approved,
    planId: row.plan_id,
    // `tier` predates plans and is still read for free-tier gating in the
    // customer dashboard. Kept as an alias rather than a second source of truth.
    tier: row.plan_id,
    messageLimit: row.message_limit,
    sessionLimit: row.session_limit,
    messagesSent: row.messages_sent,
    trialExpired: row.trial_expired,
    trialEndsAt: row.trial_ends_at,
    customTrialDays: row.custom_trial_days ?? null,
    // Agents the customer paid for. NULL means they inherit the plan's included
    // count; sessionLimit above still wins as an explicit admin override.
    purchasedAgents: row.purchased_agents ?? null,
    mustResetPassword: row.must_reset_password,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,

    // Team seats. NULL means this account owns its own workspace (a supervisor);
    // set means it is a member of that supervisor's workspace.
    ownerUserId: row.owner_user_id ?? null,
    isSupervisor: (row.owner_user_id ?? null) === null,

    // The id everything data-shaped is scoped by. Derived rather than stored so
    // there is exactly one definition of it and it cannot drift from
    // owner_user_id.
    workspaceId: row.owner_user_id ?? row.id,

    // An invited member has no password until they accept, so the members list can
    // show "invite pending" without a second query.
    hasPassword: row.password_hash === undefined ? undefined : Boolean(row.password_hash),
  };
}

export function mapPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    currency: row.currency,
    messageLimit: row.message_limit,
    sessionLimit: row.session_limit,
    trialDays: row.trial_days,
    features: Array.isArray(row.features) ? row.features : [],
    isDefault: row.is_default,
    archived: row.archived,
    sortOrder: row.sort_order,

    // Quantity pricing. base_price covers included_agents; beyond that each agent
    // costs addon_agent_price, up to max_agents (null = unlimited).
    basePrice: Number(row.base_price ?? row.price ?? 0),
    includedAgents: Number(row.included_agents ?? 1),
    addonAgentPrice: Number(row.addon_agent_price ?? 0),
    maxAgents: row.max_agents === null || row.max_agents === undefined
      ? null
      : Number(row.max_agents),

    // A per-unit top-up rather than a plan: buying it adds agents to the current plan
    // instead of switching to this one. See migration 006 and isAddon() in pricing.js.
    isAddon: Boolean(row.is_addon),
  };
}

export function mapTransaction(row) {
  if (!row) return null;
  return {
    transactionId: row.id,
    id: row.id,
    uid: row.user_id,
    email: row.email,
    item: row.item,
    type: row.type,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    paymentUrl: row.payment_url,
    createdAt: row.created_at,

    // What the checkout was for. Recorded locally so fulfilment does not depend
    // on the gateway echoing our extraData back to us.
    planId: row.plan_id ?? null,
    agents: row.agents ?? null,
  };
}

const USER_COLUMNS = `
  id, email, name, role, is_approved, plan_id, message_limit, session_limit,
  messages_sent, trial_expired, trial_ends_at, custom_trial_days, must_reset_password,
  purchased_agents, owner_user_id, created_at, last_login_at
`;

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export async function findUserById(id) {
  return mapUser(await queryOne(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]));
}

// Includes the password hash, so this is only for the login path.
export async function findUserForLogin(email) {
  return queryOne(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(email) = lower($1)`,
    [email]
  );
}

export async function emailExists(email) {
  const row = await queryOne('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  return Boolean(row);
}

export async function countUsers() {
  const row = await queryOne('SELECT count(*)::int AS n FROM users');
  return row.n;
}

export async function countAdmins() {
  const row = await queryOne("SELECT count(*)::int AS n FROM users WHERE role = 'admin'");
  return row.n;
}

export async function createUser({
  id, email, name, passwordHash, role = 'customer',
  isApproved = false, planId = null, mustResetPassword = false, createdAt = null,
  // Set for an invited team member. The member inherits the workspace's plan and
  // quota, so plan_id is left null on their own row — resolving limits from a
  // member's row would give them a second free allowance.
  ownerUserId = null,
}) {
  const row = await queryOne(
    `INSERT INTO users (id, email, name, password_hash, role, is_approved, plan_id, must_reset_password, created_at, owner_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()), $10)
     RETURNING ${USER_COLUMNS}`,
    [id, email, name, passwordHash, role, isApproved, planId, mustResetPassword, createdAt, ownerUserId]
  );
  return mapUser(row);
}

export async function listUsers() {
  const { rows } = await query(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC`);
  return rows.map(mapUser);
}

// Fields an admin may change, mapped to their columns. Anything not listed here
// cannot be written through the API, which is what firestore.rules used to
// guarantee with its hasOnly() checks.
const ADMIN_WRITABLE = {
  name: 'name',
  role: 'role',
  isApproved: 'is_approved',
  planId: 'plan_id',
  messageLimit: 'message_limit',
  sessionLimit: 'session_limit',
  messagesSent: 'messages_sent',
  trialExpired: 'trial_expired',
  purchasedAgents: 'purchased_agents',
  trialEndsAt: 'trial_ends_at',
  customTrialDays: 'custom_trial_days',
};

// Builds a parameterised UPDATE from a whitelist. Passing null for
// messageLimit or sessionLimit clears the override so the plan applies again,
// which is the equivalent of Firestore's deleteField().
export async function updateUser(id, patch) {
  const sets = [];
  const values = [];

  for (const [key, column] of Object.entries(ADMIN_WRITABLE)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }

  if (sets.length === 0) return findUserById(id);

  values.push(id);
  const row = await queryOne(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING ${USER_COLUMNS}`,
    values
  );
  return mapUser(row);
}

export async function deleteUser(id) {
  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function setPasswordHash(id, passwordHash) {
  await query(
    'UPDATE users SET password_hash = $1, must_reset_password = FALSE WHERE id = $2',
    [passwordHash, id]
  );
}

export async function recordLogin(id) {
  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
}

// Atomic, and refuses to exceed the effective limit. Doing this in SQL closes
// the hole in the Firestore version, where the browser incremented its own
// counter and the quota was advisory.
//
// Returns { allowed, messagesSent, limit }.
export async function consumeMessageQuota(userId) {
  const row = await queryOne(
    `WITH effective AS (
       SELECT u.id,
              u.messages_sent,
              u.role,
              COALESCE(u.message_limit, p.message_limit, 500) AS limit_value
         FROM users u
         LEFT JOIN plans p ON p.id = u.plan_id
        WHERE u.id = $1
     )
     UPDATE users u
        SET messages_sent = u.messages_sent + 1
       FROM effective e
      WHERE u.id = e.id
        AND (e.role = 'admin' OR e.messages_sent < e.limit_value)
     RETURNING u.messages_sent, e.limit_value`,
    [userId]
  );

  if (!row) {
    // Either no such user, or the quota is exhausted. Distinguish for the caller.
    const current = await queryOne(
      `SELECT u.messages_sent, COALESCE(u.message_limit, p.message_limit, 500) AS limit_value
         FROM users u LEFT JOIN plans p ON p.id = u.plan_id
        WHERE u.id = $1`,
      [userId]
    );
    return {
      allowed: false,
      messagesSent: current ? current.messages_sent : 0,
      limit: current ? Number(current.limit_value) : 0,
    };
  }

  return {
    allowed: true,
    messagesSent: row.messages_sent,
    limit: Number(row.limit_value),
  };
}

// Effective device limit, resolved in one query: user override, else plan, else 1.
// Mirrors resolveEffectiveLimits() on the client.
// Effective agent limit: how many devices/people may be signed in at once.
//
// Precedence:
//   session_limit      an admin granted it manually (override)
//   purchased_agents   the customer paid for it
//   included_agents    what the plan comes with
//   session_limit(plan) legacy column, for plans predating agent pricing
//   1                  last resort
export async function resolveSessionLimitFor(userId) {
  const row = await queryOne(
    `SELECT COALESCE(u.session_limit, u.purchased_agents, p.included_agents, p.session_limit, 1) AS limit_value
       FROM users u LEFT JOIN plans p ON p.id = u.plan_id
      WHERE u.id = $1`,
    [userId]
  );
  return row ? Math.max(1, Number(row.limit_value)) : 1;
}

// ---------------------------------------------------------------------------
// team seats
// ---------------------------------------------------------------------------
// Everyone in a workspace, supervisor first, then members oldest-first.
//
// `hasPassword` distinguishes an accepted member from an outstanding invite, and
// comes from password_hash — which is why this query names its columns explicitly
// instead of reusing USER_COLUMNS. The hash itself is never returned, only whether
// one exists.
export async function listWorkspaceMembers(workspaceId) {
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, (password_hash IS NOT NULL) AS password_hash
       FROM users
      WHERE id = $1 OR owner_user_id = $1
      ORDER BY (owner_user_id IS NOT NULL), created_at ASC`,
    [workspaceId]
  );
  return rows.map(mapUser);
}

/** Members excluding the supervisor. Used for the seat arithmetic. */
export async function countWorkspaceMembers(workspaceId) {
  const row = await queryOne(
    'SELECT count(*)::int AS n FROM users WHERE owner_user_id = $1',
    [workspaceId]
  );
  return row.n;
}

// A single member, scoped to the workspace so one supervisor can never address
// another's staff by guessing an id.
export async function findWorkspaceMember(workspaceId, memberId) {
  return mapUser(await queryOne(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND owner_user_id = $2`,
    [memberId, workspaceId]
  ));
}

export async function setMemberName(workspaceId, memberId, name) {
  const row = await queryOne(
    `UPDATE users SET name = $3
      WHERE id = $1 AND owner_user_id = $2
      RETURNING ${USER_COLUMNS}`,
    [memberId, workspaceId, name]
  );
  return mapUser(row);
}

// Deleting the row is the whole revocation: refresh_tokens and team_invites both
// cascade from users(id). The caller still has to disconnect live sockets, which
// no cascade can do.
export async function deleteWorkspaceMember(workspaceId, memberId) {
  const { rowCount } = await query(
    'DELETE FROM users WHERE id = $1 AND owner_user_id = $2',
    [memberId, workspaceId]
  );
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// invites
// ---------------------------------------------------------------------------
export function mapInvite(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: row.user_id,
    workspaceId: row.workspace_id,
    email: row.email,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at ?? null,
    invitedBy: row.invited_by ?? null,
    createdAt: row.created_at,
  };
}

// Only the hash is stored, so an invite link cannot be reconstructed from the
// database. Superseding any previous token for the same member is what makes
// "resend" safe: the old link stops working.
export async function createInvite({ userId, workspaceId, email, tokenHash, expiresAt, invitedBy }) {
  return withTransaction(async (client) => {
    await client.query('DELETE FROM team_invites WHERE user_id = $1 AND accepted_at IS NULL', [userId]);
    const { rows } = await client.query(
      `INSERT INTO team_invites (user_id, workspace_id, email, token_hash, expires_at, invited_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, workspaceId, email, tokenHash, expiresAt, invitedBy || null]
    );
    return mapInvite(rows[0]);
  });
}

/** Unexpired, unaccepted invite for this token, or null. */
export async function findPendingInviteByTokenHash(tokenHash) {
  return mapInvite(await queryOne(
    `SELECT * FROM team_invites
      WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [tokenHash]
  ));
}

export async function markInviteAccepted(id) {
  await query('UPDATE team_invites SET accepted_at = now() WHERE id = $1', [id]);
}

/** Outstanding invites for a workspace, keyed by member id for the members list. */
export async function listPendingInvites(workspaceId) {
  const { rows } = await query(
    `SELECT * FROM team_invites
      WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [workspaceId]
  );
  return rows.map(mapInvite);
}

// Applied by the payment webhook once an invoice for N agents is paid.
export async function setPurchasedAgents(userId, agents) {
  const value = agents === null ? null : Math.max(1, Math.floor(Number(agents)));
  const row = await queryOne(
    `UPDATE users SET purchased_agents = $2 WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    [userId, value]
  );
  return mapUser(row);
}

/**
 * Add agents to what the customer already has, for an add-on purchase.
 *
 * The starting point is deliberately COALESCE(purchased_agents, plan.included_agents,
 * plan.session_limit, 1) rather than purchased_agents alone. NULL there means "inherit
 * the plan", so treating it as zero would turn a Premium customer's first add-on
 * purchase into a DOWNGRADE: 5 included agents would become 1 bought agent.
 *
 * session_limit is untouched. It is the admin's explicit override and outranks this,
 * so a manually granted limit is not silently overwritten by a customer's top-up.
 */
export async function addPurchasedAgents(userId, delta) {
  const amount = Math.max(1, Math.floor(Number(delta) || 0));
  const row = await queryOne(
    `UPDATE users u
        SET purchased_agents = COALESCE(
              u.purchased_agents,
              p.included_agents,
              p.session_limit,
              1
            ) + $2
       FROM plans p
      WHERE u.id = $1 AND p.id = u.plan_id
      RETURNING ${USER_COLUMNS.split(',').map(c => `u.${c.trim()}`).join(', ')}`,
    [userId, amount]
  );

  // No plan row to join against (plan_id is NULL, or points at a deleted plan), so the
  // FROM clause matched nothing. Fall back to the column alone, where NULL genuinely
  // does mean "nothing inherited".
  if (!row) {
    const fallback = await queryOne(
      `UPDATE users SET purchased_agents = COALESCE(purchased_agents, 1) + $2
        WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [userId, amount]
    );
    return mapUser(fallback);
  }

  return mapUser(row);
}

// ---------------------------------------------------------------------------
// plans
// ---------------------------------------------------------------------------
export async function listPlans() {
  const { rows } = await query('SELECT * FROM plans ORDER BY sort_order ASC, name ASC');
  return rows.map(mapPlan);
}

export async function findPlanById(id) {
  return mapPlan(await queryOne('SELECT * FROM plans WHERE id = $1', [id]));
}

export async function getDefaultPlan() {
  const row = await queryOne(
    `SELECT * FROM plans
      WHERE is_default AND NOT archived
      UNION ALL
     SELECT * FROM plans WHERE id = 'free'
      LIMIT 1`
  );
  return mapPlan(row);
}

export async function upsertPlan(plan) {
  // The partial unique index allows only one default, so clearing the flag
  // elsewhere has to happen in the same transaction as setting it.
  return withTransaction(async (client) => {
    if (plan.isDefault) {
      await client.query('UPDATE plans SET is_default = FALSE WHERE id <> $1 AND is_default', [plan.id]);
    }

    const { rows } = await client.query(
      `INSERT INTO plans (id, name, description, price, currency, message_limit,
                          session_limit, trial_days, features, is_default, archived, sort_order,
                          base_price, included_agents, addon_agent_price, max_agents, is_addon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         price = EXCLUDED.price,
         currency = EXCLUDED.currency,
         message_limit = EXCLUDED.message_limit,
         session_limit = EXCLUDED.session_limit,
         trial_days = EXCLUDED.trial_days,
         features = EXCLUDED.features,
         is_default = EXCLUDED.is_default,
         archived = EXCLUDED.archived,
         sort_order = EXCLUDED.sort_order,
         base_price = EXCLUDED.base_price,
         included_agents = EXCLUDED.included_agents,
         addon_agent_price = EXCLUDED.addon_agent_price,
         max_agents = EXCLUDED.max_agents,
         is_addon = EXCLUDED.is_addon
       RETURNING *`,
      [
        plan.id, plan.name, plan.description || '', plan.price || 0,
        plan.currency || 'IDR', plan.messageLimit, plan.sessionLimit,
        plan.trialDays || 0, JSON.stringify(plan.features || []),
        Boolean(plan.isDefault), Boolean(plan.archived), plan.sortOrder ?? 100,
        plan.basePrice ?? plan.price ?? 0,
        Math.max(1, plan.includedAgents ?? 1),
        plan.addonAgentPrice ?? 0,
        plan.maxAgents === null || plan.maxAgents === undefined ? null : Math.max(1, plan.maxAgents),
        Boolean(plan.isAddon),
      ]
    );

    return mapPlan(rows[0]);
  });
}

export async function setDefaultPlan(id) {
  return withTransaction(async (client) => {
    await client.query('UPDATE plans SET is_default = FALSE WHERE is_default AND id <> $1', [id]);
    const { rows } = await client.query(
      'UPDATE plans SET is_default = TRUE, archived = FALSE WHERE id = $1 RETURNING *',
      [id]
    );
    return mapPlan(rows[0]);
  });
}

export async function deletePlan(id) {
  const { rowCount } = await query('DELETE FROM plans WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function countUsersOnPlan(id) {
  const row = await queryOne('SELECT count(*)::int AS n FROM users WHERE plan_id = $1', [id]);
  return row.n;
}

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------
export async function listTransactionsForUser(userId) {
  const { rows } = await query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows.map(mapTransaction);
}

export async function listAllTransactions(limit = 500) {
  const { rows } = await query(
    'SELECT * FROM transactions ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows.map(mapTransaction);
}

export async function saveTransaction(tx) {
  const row = await queryOne(
    `INSERT INTO transactions (id, user_id, email, item, type, amount, currency, status, payment_url, raw, plan_id, agents)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       payment_url = COALESCE(EXCLUDED.payment_url, transactions.payment_url),
       amount = EXCLUDED.amount,
       raw = COALESCE(EXCLUDED.raw, transactions.raw),
       plan_id = COALESCE(EXCLUDED.plan_id, transactions.plan_id),
       agents = COALESCE(EXCLUDED.agents, transactions.agents)
     RETURNING *`,
    [
      tx.transactionId, tx.uid || null, tx.email || null, tx.item || null,
      tx.type || null, tx.amount || 0, tx.currency || 'IDR',
      tx.status || 'PENDING', tx.paymentUrl || null,
      tx.raw ? JSON.stringify(tx.raw) : null,
      // The plan and agent count the customer chose. Without these, a webhook
      // whose extraData was stripped has nothing to fulfil against and quietly
      // grants only the plan's included agents.
      tx.planId || null,
      Number.isFinite(Number(tx.agents)) && Number(tx.agents) > 0 ? Math.floor(Number(tx.agents)) : null,
    ]
  );
  return mapTransaction(row);
}

export async function deleteTransaction(id) {
  const { rowCount } = await query('DELETE FROM transactions WHERE id = $1', [id]);
  return rowCount > 0;
}

// Bulk cleanup. Abandoned checkouts accumulate because a PENDING row is written
// before the gateway is called, so every attempt leaves a record whether or not
// the customer ever paid.
//
// `status` restricts the delete; `olderThanDays` protects recent rows a customer
// may still be paying. Nothing is deleted without at least one filter, so a bare
// call cannot wipe the table.
export async function deleteTransactionsBulk({ status, olderThanDays } = {}) {
  const conditions = [];
  const values = [];

  if (status) {
    values.push(String(status).toUpperCase());
    conditions.push(`upper(status) = $${values.length}`);
  }

  if (Number.isFinite(Number(olderThanDays))) {
    values.push(Number(olderThanDays));
    conditions.push(`created_at < now() - ($${values.length} || ' days')::interval`);
  }

  if (conditions.length === 0) {
    throw new Error('Refusing to delete every transaction: pass a status or an age filter.');
  }

  const { rowCount } = await query(
    `DELETE FROM transactions WHERE ${conditions.join(' AND ')}`,
    values
  );
  return rowCount;
}

export async function countTransactionsBy(status) {
  const row = await queryOne(
    'SELECT count(*)::int AS n FROM transactions WHERE upper(status) = upper($1)',
    [status]
  );
  return row.n;
}

export async function markTransactionStatus(id, status) {
  const row = await queryOne(
    'UPDATE transactions SET status = $2 WHERE id = $1 RETURNING *',
    [id, status]
  );
  return mapTransaction(row);
}

// ---------------------------------------------------------------------------
// refresh tokens
// ---------------------------------------------------------------------------
export async function storeRefreshToken({ userId, tokenHash, userAgent, ip }) {
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, refreshTokenExpiry(), (userAgent || '').slice(0, 400), ip || null]
  );
}

export async function findValidRefreshToken(token) {
  return queryOne(
    `SELECT id, user_id FROM refresh_tokens
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [hashRefreshToken(token)]
  );
}

export async function revokeRefreshToken(token) {
  const { rowCount } = await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [hashRefreshToken(token)]
  );
  return rowCount > 0;
}

export async function revokeAllRefreshTokens(userId) {
  const { rowCount } = await query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
  return rowCount;
}

// ---------------------------------------------------------------------------
// contacts (the operator's own address book)
// ---------------------------------------------------------------------------
export function mapContact(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    phone: row.phone,
    name: row.name || '',
    email: row.email || null,
    company: row.company || null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    note: row.note || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Tags arrive from a form, so they are cleaned here rather than trusting the
// client: strings only, trimmed, de-duplicated case-insensitively, capped.
function cleanTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const label = String(tag ?? '').trim().slice(0, 40);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= 20) break;
  }
  return out;
}

export async function listContacts(userId) {
  const { rows } = await query(
    'SELECT * FROM contacts WHERE user_id = $1 ORDER BY name = \'\', lower(name), phone',
    [userId]
  );
  return rows.map(mapContact);
}

export async function findContactById(userId, id) {
  return mapContact(await queryOne(
    'SELECT * FROM contacts WHERE user_id = $1 AND id = $2',
    [userId, id]
  ));
}

export async function findContactByPhone(userId, phone) {
  return mapContact(await queryOne(
    'SELECT * FROM contacts WHERE user_id = $1 AND phone = $2',
    [userId, phone]
  ));
}

export async function countContacts(userId) {
  const row = await queryOne('SELECT count(*)::int AS n FROM contacts WHERE user_id = $1', [userId]);
  return row.n;
}

// Create, or update the existing row for this number.
//
// Keyed on (user_id, phone) so saving the same number twice edits one contact
// instead of producing a duplicate — the same reason a CSV re-import is an
// update. The phone must already be normalised; the route does that.
export async function upsertContact(userId, { phone, name, email, company, tags, note }) {
  const row = await queryOne(
    `INSERT INTO contacts (user_id, phone, name, email, company, tags, note)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     ON CONFLICT (user_id, phone) DO UPDATE SET
       name    = EXCLUDED.name,
       email   = EXCLUDED.email,
       company = EXCLUDED.company,
       tags    = EXCLUDED.tags,
       note    = EXCLUDED.note
     RETURNING *`,
    [
      userId, phone,
      String(name ?? '').trim().slice(0, 120),
      email ? String(email).trim().slice(0, 200) : null,
      company ? String(company).trim().slice(0, 120) : null,
      JSON.stringify(cleanTags(tags)),
      note ? String(note).trim().slice(0, 1000) : null,
    ]
  );
  return mapContact(row);
}

// Fields a contact's owner may change. `phone` is included: correcting a typo is
// a legitimate edit, and the unique index still stops it colliding with another
// row (the route turns that into a 409).
const CONTACT_WRITABLE = {
  phone: 'phone',
  name: 'name',
  email: 'email',
  company: 'company',
  tags: 'tags',
  note: 'note',
};

export async function updateContact(userId, id, patch) {
  const sets = [];
  const values = [];

  for (const [key, column] of Object.entries(CONTACT_WRITABLE)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;

    if (key === 'tags') {
      values.push(JSON.stringify(cleanTags(patch.tags)));
      sets.push(`${column} = $${values.length}::jsonb`);
      continue;
    }

    values.push(patch[key]);
    sets.push(`${column} = $${values.length}`);
  }

  if (sets.length === 0) return findContactById(userId, id);

  values.push(userId, id);
  const row = await queryOne(
    `UPDATE contacts SET ${sets.join(', ')}
      WHERE user_id = $${values.length - 1} AND id = $${values.length}
      RETURNING *`,
    values
  );
  return mapContact(row);
}

export async function deleteContact(userId, id) {
  const { rowCount } = await query(
    'DELETE FROM contacts WHERE user_id = $1 AND id = $2',
    [userId, id]
  );
  return rowCount > 0;
}

// Scoped to the caller either way, so the worst a bad id list can do is delete
// the caller's own contacts. An empty list is a no-op rather than "everything".
export async function deleteContactsBulk(userId, ids) {
  const clean = (Array.isArray(ids) ? ids : [])
    .map(id => String(id).trim())
    .filter(id => /^\d+$/.test(id));

  if (clean.length === 0) return 0;

  const { rowCount } = await query(
    'DELETE FROM contacts WHERE user_id = $1 AND id = ANY($2::bigint[])',
    [userId, clean]
  );
  return rowCount;
}

/**
 * Bulk upsert for a CSV import.
 *
 * One transaction, so a spreadsheet either lands completely or not at all — a
 * partial import is worse than none, because the operator cannot tell which rows
 * made it. `xmax = 0` distinguishes an insert from an update on a conflicting
 * row, which is how the created/updated counts are reported back.
 *
 * Rows must already be normalised and de-duplicated by the caller: Postgres
 * cannot upsert the same key twice in one statement, and doing it row by row here
 * keeps the error message tied to a specific number.
 */
export async function importContacts(userId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { created: 0, updated: 0 };
  }

  return withTransaction(async (client) => {
    let created = 0;
    let updated = 0;

    for (const row of rows) {
      const result = await client.query(
        `INSERT INTO contacts (user_id, phone, name, email, company, tags, note)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
         ON CONFLICT (user_id, phone) DO UPDATE SET
           -- A blank cell in the spreadsheet must not wipe a name that is
           -- already saved, so each field falls back to the stored value.
           name    = CASE WHEN EXCLUDED.name = '' THEN contacts.name ELSE EXCLUDED.name END,
           email   = COALESCE(EXCLUDED.email, contacts.email),
           company = COALESCE(EXCLUDED.company, contacts.company),
           tags    = CASE WHEN EXCLUDED.tags = '[]'::jsonb THEN contacts.tags ELSE EXCLUDED.tags END,
           note    = COALESCE(EXCLUDED.note, contacts.note)
         RETURNING (xmax = 0) AS inserted`,
        [
          userId, row.phone,
          String(row.name ?? '').trim().slice(0, 120),
          row.email ? String(row.email).trim().slice(0, 200) : null,
          row.company ? String(row.company).trim().slice(0, 120) : null,
          JSON.stringify(cleanTags(row.tags)),
          row.note ? String(row.note).trim().slice(0, 1000) : null,
        ]
      );

      if (result.rows[0]?.inserted) created++;
      else updated++;
    }

    return { created, updated };
  });
}

/** Every distinct tag this user has applied, for the filter dropdown. */
export async function listContactTags(userId) {
  const { rows } = await query(
    `SELECT t.tag, count(*)::int AS n
       FROM contacts c, jsonb_array_elements_text(c.tags) AS t(tag)
      WHERE c.user_id = $1
      GROUP BY t.tag
      ORDER BY n DESC, lower(t.tag)`,
    [userId]
  );
  return rows.map(r => ({ tag: r.tag, count: r.n }));
}

// ---------------------------------------------------------------------------
// chat settings (agent hold)
// ---------------------------------------------------------------------------
export function mapChatSettings(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    chatJid: row.chat_jid,
    botPaused: row.bot_paused,
    pausedAt: row.paused_at,
    pausedBy: row.paused_by,
    note: row.note,

    // Commercial state. NULL in the column reads as 'prospect' everywhere, so the
    // default is applied here once instead of at every call site.
    status: row.status || 'prospect',
    statusAt: row.status_at ?? null,
    statusBy: row.status_by ?? null,
  };
}

// A missing row means "not held", so this returns a synthetic default rather than
// null. Callers can then treat every chat uniformly.
//
// Accepts one JID or an array of equivalent JIDs (@lid and phone form). The hold
// is stored under a single canonical JID, but reading should match whichever
// alias the caller happens to know.
export async function getChatSettings(userId, sessionId, chatJids) {
  const jids = (Array.isArray(chatJids) ? chatJids : [chatJids]).filter(Boolean);
  const row = jids.length
    ? await queryOne(
        `SELECT * FROM chat_settings
          WHERE user_id = $1 AND session_id = $2 AND chat_jid = ANY($3::text[])`,
        [userId, sessionId, jids]
      )
    : null;

  if (row) return mapChatSettings(row);

  return {
    sessionId,
    chatJid: jids[0] || null,
    botPaused: false,
    pausedAt: null,
    pausedBy: null,
    note: null,
    status: 'prospect',
    statusAt: null,
    statusBy: null,
  };
}

// Only the held chats, for badging the chat list. Returns an array of JIDs.
export async function listHeldChats(userId, sessionId) {
  const { rows } = await query(
    `SELECT chat_jid, paused_at, paused_by, note FROM chat_settings
      WHERE user_id = $1 AND session_id = $2 AND bot_paused`,
    [userId, sessionId]
  );
  return rows.map(r => ({
    chatJid: r.chat_jid,
    pausedAt: r.paused_at,
    pausedBy: r.paused_by,
    note: r.note,
  }));
}

export async function setChatHold(userId, sessionId, chatJid, { botPaused, pausedBy, note }) {
  const row = await queryOne(
    `INSERT INTO chat_settings (user_id, session_id, chat_jid, bot_paused, paused_at, paused_by, note)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN now() ELSE NULL END, $5, $6)
     ON CONFLICT (user_id, session_id, chat_jid) DO UPDATE SET
       bot_paused = EXCLUDED.bot_paused,
       -- Preserve the original hold time across a note edit; clear it on release.
       paused_at  = CASE
                      WHEN NOT EXCLUDED.bot_paused THEN NULL
                      WHEN chat_settings.bot_paused THEN chat_settings.paused_at
                      ELSE now()
                    END,
       paused_by  = CASE WHEN EXCLUDED.bot_paused THEN EXCLUDED.paused_by ELSE NULL END,
       note       = CASE WHEN EXCLUDED.bot_paused THEN EXCLUDED.note ELSE NULL END
     RETURNING *`,
    [userId, sessionId, chatJid, Boolean(botPaused), pausedBy || null, note || null]
  );
  return mapChatSettings(row);
}

export const CHAT_STATUSES = ['prospect', 'closed_won', 'dropped'];

/**
 * Move a conversation's commercial state.
 *
 * Shares the chat_settings row with the agent hold, so the INSERT lists only the
 * status columns and the ON CONFLICT touches only those — a status change must not
 * release a hold, and vice versa. Both operations use ON CONFLICT on the same natural
 * key, so whichever happens first creates the row.
 */
export async function setChatStatus(userId, sessionId, chatJid, { status, statusBy }) {
  const value = CHAT_STATUSES.includes(status) ? status : 'prospect';

  const row = await queryOne(
    `INSERT INTO chat_settings (user_id, session_id, chat_jid, status, status_at, status_by)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (user_id, session_id, chat_jid) DO UPDATE SET
       status    = EXCLUDED.status,
       -- Only stamped when the state actually moves, so re-marking a won deal does not
       -- keep resetting the date it was won.
       status_at = CASE
                     WHEN chat_settings.status IS DISTINCT FROM EXCLUDED.status THEN now()
                     ELSE chat_settings.status_at
                   END,
       status_by = CASE
                     WHEN chat_settings.status IS DISTINCT FROM EXCLUDED.status THEN EXCLUDED.status_by
                     ELSE chat_settings.status_by
                   END
     RETURNING *`,
    [userId, sessionId, chatJid, value, statusBy || null]
  );
  return mapChatSettings(row);
}

/**
 * Every conversation with a status set, for badging the chat list and counting.
 *
 * Rows without a status are omitted rather than reported as 'prospect': absence is the
 * default, so returning them would mean returning every chat ever touched.
 */
export async function listChatStatuses(userId, sessionId) {
  const { rows } = await query(
    `SELECT chat_jid, status, status_at, status_by FROM chat_settings
      WHERE user_id = $1 AND session_id = $2 AND status IS NOT NULL`,
    [userId, sessionId]
  );
  return rows.map(r => ({
    chatJid: r.chat_jid,
    status: r.status,
    statusAt: r.status_at,
    statusBy: r.status_by,
  }));
}

// Remove a hold row entirely. Used to collapse a duplicate @lid/phone row into
// the single canonical row after a hold or release write, so one conversation
// never carries two chat_settings rows that could disagree.
export async function clearChatHold(userId, sessionId, chatJid) {
  await query(
    `DELETE FROM chat_settings
      WHERE user_id = $1 AND session_id = $2 AND chat_jid = $3`,
    [userId, sessionId, chatJid]
  );
}

// True when automated replies are currently suppressed for this conversation.
//
// Accepts one JID or an array of them. A held chat is stored under whichever JID
// the dashboard happened to show (@lid on the main account), while the sender
// addresses it by phone JID (or vice versa) — so callers pass every equivalent
// form and we match any.
export async function isChatHeld(userId, sessionId, chatJids) {
  const jids = (Array.isArray(chatJids) ? chatJids : [chatJids]).filter(Boolean);
  if (jids.length === 0) return false;
  const row = await queryOne(
    `SELECT 1 FROM chat_settings
      WHERE user_id = $1 AND session_id = $2 AND chat_jid = ANY($3::text[]) AND bot_paused`,
    [userId, sessionId, jids]
  );
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// audit log
// ---------------------------------------------------------------------------
// Best-effort: a failure to write an audit row must never fail the action it
// was recording, but it should be loud in the logs.
export async function recordAudit({ actorUserId, actorEmail, action, targetUserId, detail, ip }) {
  try {
    await query(
      `INSERT INTO audit_log (actor_user_id, actor_email, action, target_user_id, detail, ip)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        actorUserId || null, actorEmail || null, action,
        targetUserId || null, detail ? JSON.stringify(detail) : null, ip || null,
      ]
    );
  } catch (err) {
    console.error(`[Audit] Failed to record "${action}":`, err.message);
  }
}

export async function listAudit(limit = 200) {
  const { rows } = await query(
    'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// feature flags
// ---------------------------------------------------------------------------
// Storage only. What a status or an override *means* lives in ./features.js, so the
// precedence rules can be checked without a database.
//
// Both tables are small — one row per configured feature, and a handful of deliberate
// exceptions — so these are plain reads with no caching. If a flag lookup ever shows up in
// the slow-query log, cache the global map and invalidate it in setFeatureFlag; the
// per-account read is already a primary-key hit.

export function mapFeatureFlag(row) {
  if (!row) return null;
  return {
    key: row.key,
    status: row.status,
    note: row.note ?? null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? null,
  };
}

/** Every configured flag. Unconfigured features are simply absent; the resolver defaults them. */
export async function listFeatureFlags() {
  const { rows } = await query('SELECT * FROM feature_flags ORDER BY key');
  return rows.map(mapFeatureFlag);
}

export async function setFeatureFlag(key, { status, note, updatedBy }) {
  const row = await queryOne(
    `INSERT INTO feature_flags (key, status, note, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET
       status     = EXCLUDED.status,
       note       = EXCLUDED.note,
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [key, status, note || null, updatedBy || null]
  );
  return mapFeatureFlag(row);
}

/**
 * Every account exception, with the account's identity joined in.
 *
 * The console lists exceptions per feature and has to name the customer, so joining here
 * avoids the caller cross-referencing against a separately fetched user list — and avoids
 * showing a bare uid when that list is stale.
 */
export async function listFeatureAccess() {
  const { rows } = await query(
    `SELECT fa.feature_key, fa.user_id, fa.access, fa.created_at, fa.updated_at,
            u.email, u.name
       FROM feature_access fa
       JOIN users u ON u.id = fa.user_id
      ORDER BY fa.feature_key, u.email`
  );
  return rows.map(r => ({
    featureKey: r.feature_key,
    userId: r.user_id,
    access: r.access,
    email: r.email,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/** The exceptions for one account, which is what resolving that account's features needs. */
export async function listFeatureAccessForUser(userId) {
  const { rows } = await query(
    'SELECT feature_key, access FROM feature_access WHERE user_id = $1',
    [userId]
  );
  return rows.map(r => ({ featureKey: r.feature_key, access: r.access }));
}

export async function setFeatureAccess(featureKey, userId, { access, grantedBy }) {
  const row = await queryOne(
    `INSERT INTO feature_access (user_id, feature_key, access, granted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, feature_key) DO UPDATE SET
       access     = EXCLUDED.access,
       granted_by = EXCLUDED.granted_by
     RETURNING *`,
    [userId, featureKey, access, grantedBy || null]
  );
  return {
    featureKey: row.feature_key,
    userId: row.user_id,
    access: row.access,
  };
}

export async function clearFeatureAccess(featureKey, userId) {
  const { rowCount } = await query(
    'DELETE FROM feature_access WHERE user_id = $1 AND feature_key = $2',
    [userId, featureKey]
  );
  return rowCount > 0;
}

/**
 * The effective status of every feature for one account, ready to send to a client.
 *
 * Takes the workspace id, not the caller's own uid: an invited agent must see exactly what
 * their supervisor's account has, for the same reason the plan and quota are resolved that
 * way. Passing the member's id would give them an unconfigured parallel set.
 */
export async function resolveFeaturesForWorkspace(workspaceId) {
  const [flags, overrides] = await Promise.all([
    listFeatureFlags(),
    listFeatureAccessForUser(workspaceId),
  ]);
  return resolveFeatures({ flags, overrides });
}
