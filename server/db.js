// Postgres access layer.
//
// Replaces Firestore. One pool for the process, a thin query helper, and a
// migration runner that applies server/migrations/*.sql in filename order.
//
// Configuration: DATABASE_URL, e.g.
//   DATABASE_URL=postgres://wa_app:secret@127.0.0.1:5432/wa_app
//
// The app fails to start without it rather than silently running with no
// persistence, which is what the old file-backed transaction store did.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();

// Managed Postgres providers usually require TLS; a local socket does not.
// DATABASE_SSL=true forces it on.
const useSsl = (process.env.DATABASE_SSL || '').trim().toLowerCase() === 'true';

let pool = null;

export function isConfigured() {
  return Boolean(DATABASE_URL);
}

export function getPool() {
  if (!DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. The app stores users, plans and transactions in ' +
      'Postgres — see deploy/POSTGRES.md for the setup steps.'
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // An idle client erroring (server restart, network blip) must not take the
    // process down. The pool discards it and the next query gets a fresh one.
    pool.on('error', (err) => {
      console.error('[DB] Idle client error:', err.message);
    });
  }

  return pool;
}

// Parameterised query. Always pass values as $1, $2 — never interpolate.
export async function query(text, params) {
  const started = Date.now();
  try {
    const result = await getPool().query(text, params);
    const ms = Date.now() - started;
    if (ms > 500) {
      console.warn(`[DB] Slow query (${ms}ms): ${text.split('\n')[0].slice(0, 120)}`);
    }
    return result;
  } catch (err) {
    // Log the statement but never the parameters, which may hold a password
    // hash or a customer's details.
    console.error(`[DB] Query failed: ${text.split('\n')[0].slice(0, 160)} — ${err.message}`);
    throw err;
  }
}

// Convenience: first row or null.
export async function queryOne(text, params) {
  const { rows } = await query(text, params);
  return rows[0] || null;
}

// Run a set of statements in a transaction. The callback receives a client;
// use client.query. Rolls back on any throw.
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[DB] Rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// migrations
// ---------------------------------------------------------------------------
// Each file in server/migrations is applied once, in filename order, and
// recorded in schema_migrations. Safe to run on every boot.
export async function runMigrations() {
  const dir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(dir)) {
    console.warn('[DB] No migrations directory found, skipping.');
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(r => r.filename));

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  let count = 0;
  for (const filename of files) {
    if (applied.has(filename)) continue;

    const sql = fs.readFileSync(path.join(dir, filename), 'utf-8');

    // One transaction per file, so a failure leaves no partial schema.
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
    });

    console.log(`[DB] Applied migration ${filename}`);
    count += 1;
  }

  if (count === 0) {
    console.log(`[DB] Schema up to date (${files.length} migration${files.length === 1 ? '' : 's'}).`);
  }
}

// Verify connectivity and report which database we are attached to, so a
// misconfigured DATABASE_URL is obvious in the startup log rather than at the
// first request.
export async function verifyConnection() {
  const row = await queryOne(
    'SELECT current_database() AS db, current_user AS usr, version() AS version'
  );
  const pgVersion = String(row.version).split(' ').slice(0, 2).join(' ');
  console.log(`[DB] Connected to ${row.db} as ${row.usr} (${pgVersion})`);
  return row;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Periodically drop refresh tokens that are expired or long revoked, so the
// table does not grow without bound.
export async function pruneRefreshTokens() {
  const { rowCount } = await query(
    `DELETE FROM refresh_tokens
      WHERE expires_at < now() - INTERVAL '7 days'
         OR (revoked_at IS NOT NULL AND revoked_at < now() - INTERVAL '7 days')`
  );
  if (rowCount > 0) {
    console.log(`[DB] Pruned ${rowCount} expired refresh token${rowCount === 1 ? '' : 's'}.`);
  }
  return rowCount;
}
