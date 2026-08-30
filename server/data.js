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
    mustResetPassword: row.must_reset_password,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
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
  };
}

const USER_COLUMNS = `
  id, email, name, role, is_approved, plan_id, message_limit, session_limit,
  messages_sent, trial_expired, must_reset_password, created_at, last_login_at
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
}) {
  const row = await queryOne(
    `INSERT INTO users (id, email, name, password_hash, role, is_approved, plan_id, must_reset_password, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))
     RETURNING ${USER_COLUMNS}`,
    [id, email, name, passwordHash, role, isApproved, planId, mustResetPassword, createdAt]
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
export async function resolveSessionLimitFor(userId) {
  const row = await queryOne(
    `SELECT COALESCE(u.session_limit, p.session_limit, 1) AS limit_value
       FROM users u LEFT JOIN plans p ON p.id = u.plan_id
      WHERE u.id = $1`,
    [userId]
  );
  return row ? Math.max(1, Number(row.limit_value)) : 1;
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
                          session_limit, trial_days, features, is_default, archived, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
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
         sort_order = EXCLUDED.sort_order
       RETURNING *`,
      [
        plan.id, plan.name, plan.description || '', plan.price || 0,
        plan.currency || 'IDR', plan.messageLimit, plan.sessionLimit,
        plan.trialDays || 0, JSON.stringify(plan.features || []),
        Boolean(plan.isDefault), Boolean(plan.archived), plan.sortOrder ?? 100,
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
    `INSERT INTO transactions (id, user_id, email, item, type, amount, currency, status, payment_url, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       payment_url = COALESCE(EXCLUDED.payment_url, transactions.payment_url),
       amount = EXCLUDED.amount,
       raw = COALESCE(EXCLUDED.raw, transactions.raw)
     RETURNING *`,
    [
      tx.transactionId, tx.uid || null, tx.email || null, tx.item || null,
      tx.type || null, tx.amount || 0, tx.currency || 'IDR',
      tx.status || 'PENDING', tx.paymentUrl || null,
      tx.raw ? JSON.stringify(tx.raw) : null,
    ]
  );
  return mapTransaction(row);
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
  };
}

// A missing row means "not held", so this returns a synthetic default rather than
// null. Callers can then treat every chat uniformly.
export async function getChatSettings(userId, sessionId, chatJid) {
  const row = await queryOne(
    `SELECT * FROM chat_settings
      WHERE user_id = $1 AND session_id = $2 AND chat_jid = $3`,
    [userId, sessionId, chatJid]
  );

  return row ? mapChatSettings(row) : {
    sessionId,
    chatJid,
    botPaused: false,
    pausedAt: null,
    pausedBy: null,
    note: null,
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

// True when automated replies are currently suppressed for this conversation.
export async function isChatHeld(userId, sessionId, chatJid) {
  const row = await queryOne(
    `SELECT 1 FROM chat_settings
      WHERE user_id = $1 AND session_id = $2 AND chat_jid = $3 AND bot_paused`,
    [userId, sessionId, chatJid]
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
