// One-off import of existing Firestore data into Postgres.
//
// Usage:
//   node server/migrate-from-firestore.js path/to/firestore-export.json
//   node server/migrate-from-firestore.js export.json --dry-run
//
// Passwords cannot be carried over. Firebase exports password hashes as scrypt
// derived with the project's own signer key, which this server has no way to
// verify. Imported accounts are therefore flagged must_reset_password, which
// blocks login with a clear message until an admin sets a new one. Everything
// else — identity, role, approval, plan, limit overrides, usage counters,
// created dates and transactions — carries across.
//
// Critically, each user keeps their Firebase UID as their primary key. Baileys
// names credential directories sessions/auth_info_${uid}_${sessionId}, so
// preserving the id means already-connected WhatsApp devices keep working and
// nobody has to re-scan a QR code.
//
// Expected input: a JSON file shaped like either
//   { "users": [ ... ], "plans": [ ... ], "transactions": [ ... ] }
// or the nested form the Firebase console/CLI produces
//   { "__collections__": { "users": { "<id>": {...} }, ... } }
//
// See deploy/POSTGRES.md for how to produce the export.

import fs from 'fs';
import path from 'path';
import { query, withTransaction, verifyConnection, runMigrations, closePool } from './db.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const inputPath = args.find(a => !a.startsWith('--'));

if (!inputPath) {
  console.error('Usage: node server/migrate-from-firestore.js <export.json> [--dry-run]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// input normalisation
// ---------------------------------------------------------------------------
// Firestore exports represent timestamps in several shapes depending on the tool
// that produced them.
function toDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof value === 'number') {
    // Seconds or milliseconds since the epoch.
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  if (value.__time__) return toDate(value.__time__);
  return null;
}

function toInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

// Accepts either the flat array form or the nested __collections__ form.
function extractCollection(raw, name) {
  if (Array.isArray(raw[name])) {
    return raw[name].map(doc => ({ id: doc.id || doc.uid || doc.transactionId, data: doc }));
  }

  const nested = raw.__collections__?.[name] || raw.collections?.[name];
  if (nested && typeof nested === 'object') {
    return Object.entries(nested).map(([id, data]) => ({ id, data }));
  }

  return [];
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------
async function importPlans(plans) {
  let created = 0;
  let skipped = 0;

  for (const { id, data } of plans) {
    const planId = String(id || data.id || '').trim().toLowerCase();
    if (!planId) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] plan ${planId} (${data.name || planId})`);
      created += 1;
      continue;
    }

    // Existing rows win: migration 001 already seeded free/premium, and an admin
    // may have tuned them since. Nothing here overwrites a live plan.
    await query(
      `INSERT INTO plans (id, name, description, price, currency, message_limit,
                          session_limit, trial_days, features, is_default, archived, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        planId,
        data.name || planId,
        data.description || '',
        toInt(data.price) ?? 0,
        data.currency || 'IDR',
        toInt(data.messageLimit) ?? 500,
        Math.max(1, toInt(data.sessionLimit) ?? 1),
        toInt(data.trialDays) ?? 0,
        JSON.stringify(Array.isArray(data.features) ? data.features : []),
        Boolean(data.isDefault),
        Boolean(data.archived),
        toInt(data.sortOrder) ?? 100,
      ]
    );
    created += 1;
  }

  return { created, skipped };
}

async function importUsers(users, knownPlanIds) {
  let imported = 0;
  let skipped = 0;
  const problems = [];

  for (const { id, data } of users) {
    const uid = String(data.uid || id || '').trim();
    const email = String(data.email || '').trim().toLowerCase();

    if (!uid || !email) {
      problems.push(`skipped a record with no uid or email (id: ${id})`);
      skipped += 1;
      continue;
    }

    // tier doubled as the plan id before the plans collection existed.
    let planId = String(data.planId || data.tier || 'free').trim().toLowerCase();
    if (!knownPlanIds.has(planId)) {
      problems.push(`${email}: plan "${planId}" does not exist, assigning free`);
      planId = 'free';
    }

    const role = data.role === 'admin' ? 'admin' : 'customer';

    if (dryRun) {
      console.log(`  [dry-run] user ${email} (${role}, plan ${planId}, uid ${uid})`);
      imported += 1;
      continue;
    }

    try {
      await query(
        `INSERT INTO users (id, email, name, password_hash, role, is_approved, plan_id,
                            message_limit, session_limit, messages_sent, trial_expired,
                            must_reset_password, created_at)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,TRUE,COALESCE($11, now()))
         ON CONFLICT (id) DO NOTHING`,
        [
          uid,
          email,
          data.name || email.split('@')[0],
          role,
          Boolean(data.isApproved),
          planId,
          // A missing field meant "inherit from the plan"; keep that as NULL
          // rather than freezing today's plan value into the row.
          toInt(data.messageLimit),
          toInt(data.sessionLimit),
          toInt(data.messagesSent) ?? 0,
          Boolean(data.trialExpired),
          toDate(data.createdAt),
        ]
      );
      imported += 1;
    } catch (err) {
      // A duplicate email with a different uid is the likely cause, and it needs
      // a human decision rather than a guess.
      problems.push(`${email}: ${err.message}`);
      skipped += 1;
    }
  }

  return { imported, skipped, problems };
}

async function importTransactions(transactions, knownUserIds) {
  let imported = 0;
  let skipped = 0;

  for (const { id, data } of transactions) {
    const txId = String(data.transactionId || data.id || id || '').trim();
    if (!txId) {
      skipped += 1;
      continue;
    }

    // Orphan transactions are kept with a null user_id rather than dropped, so
    // the revenue history stays intact.
    const userId = knownUserIds.has(data.uid) ? data.uid : null;

    if (dryRun) {
      console.log(`  [dry-run] transaction ${txId} (${data.status || 'PENDING'})`);
      imported += 1;
      continue;
    }

    await query(
      `INSERT INTO transactions (id, user_id, email, item, type, amount, currency,
                                 status, payment_url, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, now()))
       ON CONFLICT (id) DO NOTHING`,
      [
        txId,
        userId,
        data.email || null,
        data.item || null,
        data.type || null,
        toInt(data.amount) ?? 0,
        data.currency || 'IDR',
        data.status || 'PENDING',
        data.paymentUrl || null,
        toDate(data.createdAt),
      ]
    );
    imported += 1;
  }

  return { imported, skipped };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    console.error(`Export file not found: ${resolved}`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (err) {
    console.error(`Could not parse ${resolved}: ${err.message}`);
    process.exit(1);
  }

  const users = extractCollection(raw, 'users');
  const plans = extractCollection(raw, 'plans');
  const transactions = extractCollection(raw, 'transactions');

  console.log(`\nRead ${resolved}`);
  console.log(`  users:        ${users.length}`);
  console.log(`  plans:        ${plans.length}`);
  console.log(`  transactions: ${transactions.length}`);

  if (users.length === 0 && plans.length === 0 && transactions.length === 0) {
    console.error('\nNothing to import. Expected top-level "users"/"plans"/"transactions" arrays, ' +
                  'or a "__collections__" object. Check the export format.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing will be written.\n');
  }

  await verifyConnection();
  await runMigrations();

  console.log('\nPlans');
  const planResult = await importPlans(plans);
  console.log(`  ${planResult.created} processed, ${planResult.skipped} skipped`);

  // Read back the authoritative plan list, including the ones migration 001
  // seeded, so user rows can be validated against it.
  const { rows: planRows } = await query('SELECT id FROM plans');
  const knownPlanIds = new Set(planRows.map(r => r.id));

  console.log('\nUsers');
  const userResult = await importUsers(users, knownPlanIds);
  console.log(`  ${userResult.imported} imported, ${userResult.skipped} skipped`);

  const { rows: userRows } = await query('SELECT id FROM users');
  const knownUserIds = new Set(userRows.map(r => r.id));

  console.log('\nTransactions');
  const txResult = await importTransactions(transactions, knownUserIds);
  console.log(`  ${txResult.imported} imported, ${txResult.skipped} skipped`);

  if (userResult.problems.length > 0) {
    console.log('\nNeeds attention:');
    userResult.problems.forEach(p => console.log(`  - ${p}`));
  }

  if (!dryRun) {
    const { rows } = await query(
      'SELECT count(*)::int AS n FROM users WHERE must_reset_password'
    );
    console.log(
      `\n${rows[0].n} imported account${rows[0].n === 1 ? '' : 's'} cannot sign in until a password is set.`
    );
    console.log('Firebase password hashes are not verifiable here, so each user needs a new password.');
    console.log('Clear the flag for one account with:');
    console.log("  UPDATE users SET must_reset_password = FALSE, password_hash = NULL WHERE email = 'x@y.z';");
    console.log('then have them register again with the same address, or add a reset flow.');
  }

  console.log('\nDone.\n');
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\nMigration failed:', err.message);
    await closePool().catch(() => {});
    process.exit(1);
  });
