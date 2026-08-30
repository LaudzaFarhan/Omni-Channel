# Postgres setup

The app stores users, plans, transactions, refresh tokens and the audit log in
Postgres. It replaced Firestore, and the login system replaced Firebase Auth, so
this database is now the only place account data lives. **Back it up.**

The server refuses to start without `DATABASE_URL` and `JWT_SECRET` rather than
running in a state where every request fails.

---

## 1. Install Postgres

On the VPS (Ubuntu):

```bash
sudo apt-get update
sudo apt-get install -y postgresql postgresql-contrib
systemctl is-active postgresql        # expect: active
psql --version
```

Postgres 14 or newer. The schema uses `jsonb`, partial unique indexes and
`gen_random_uuid`-free ids, so nothing exotic is required.

## 2. Create the role and database

Pick a strong password and keep it out of your shell history (the leading space
prevents most shells recording the line):

```bash
 DB_PASS='paste-a-long-random-password-here'

sudo -u postgres psql <<SQL
CREATE ROLE wa_app WITH LOGIN PASSWORD '${DB_PASS}';
CREATE DATABASE wa_app OWNER wa_app;
SQL
```

Generate the password with:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Confirm the role can connect:

```bash
PGPASSWORD="$DB_PASS" psql -h 127.0.0.1 -U wa_app -d wa_app -c '\conninfo'
```

## 3. Configure the app

Add to `/root/wa-backend/.env`:

```bash
DATABASE_URL=postgres://wa_app:PASSWORD@127.0.0.1:5432/wa_app

# Signs access tokens. Generate with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# Changing this signs every user out. Treat it like a private key.
JWT_SECRET=

# Optional
JWT_ISSUER=wa-gateway
ACCESS_TOKEN_TTL=900          # seconds; 15 minutes
REFRESH_TOKEN_TTL_DAYS=30
DATABASE_POOL_MAX=10
DATABASE_SSL=false            # true for a managed provider over the internet
```

URL-encode any of `@ : / ? # [ ] %` that appear in the password, or wrap the
whole value in quotes and prefer a base64url password that avoids them.

Then:

```bash
chmod 600 /root/wa-backend/.env
```

## 4. Start the app

Migrations in `server/migrations/` run automatically on boot, tracked in a
`schema_migrations` table, so this is safe to repeat:

```bash
pm2 restart wa-backend --update-env
pm2 logs wa-backend --lines 30
```

Expect:

```
[DB] Connected to wa_app as wa_app (PostgreSQL 16.x)
[DB] Applied migration 001_init.sql
Multi-Tenant Server listening on http://127.0.0.1:5000
```

On later restarts the migration line becomes `[DB] Schema up to date`.

## 5. Create the first admin

The **first account registered becomes an approved admin automatically**, so a
fresh deployment is usable without editing the database. Register through the
app's sign-up form.

After that, admins come from either the `ADMIN_EMAILS` allow-list or promotion
through the Customers tab.

```bash
# Confirm what was created
sudo -u postgres psql -d wa_app -c "SELECT email, role, is_approved, plan_id FROM users;"
```

## 6. Verify

```bash
sudo -u postgres psql -d wa_app -c "\dt"
```

Expect `users`, `plans`, `transactions`, `refresh_tokens`, `audit_log` and
`schema_migrations`. The two seeded plans should be present:

```bash
sudo -u postgres psql -d wa_app -c "SELECT id, name, message_limit, session_limit, is_default FROM plans;"
```

---

## Backups

This database now holds every account. Losing it means losing all logins.

```bash
sudo -u postgres pg_dump -Fc wa_app > /root/backups/wa_app-$(date +%F).dump
```

A nightly cron job:

```bash
sudo mkdir -p /root/backups
( sudo crontab -l 2>/dev/null; echo '15 3 * * * sudo -u postgres pg_dump -Fc wa_app > /root/backups/wa_app-$(date +\%F).dump && find /root/backups -name "wa_app-*.dump" -mtime +14 -delete' ) | sudo crontab -
```

Restore:

```bash
sudo -u postgres pg_restore -d wa_app --clean --if-exists /root/backups/wa_app-YYYY-MM-DD.dump
```

Back up `sessions/` on the same schedule — that holds the WhatsApp credentials
and is not in Postgres.

## Local development

No Postgres locally? Either install it, or point `DATABASE_URL` at a throwaway
database. Do **not** point local development at the production database; the
migration runner and the first-account bootstrap both write.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `DATABASE_URL is not set` | Missing from `.env`, or pm2 started before it was added. Use `pm2 restart wa-backend --update-env`. |
| `ECONNREFUSED 127.0.0.1:5432` | Postgres is not running: `systemctl status postgresql`. |
| `password authentication failed` | Wrong password, or unescaped special characters in the URL. |
| `permission denied for table` | The database was created with a different owner. It must be owned by `wa_app`. |
| `JWT_SECRET is too short` | Use at least 32 characters; 64 is better. |
| Everyone signed out after a deploy | `JWT_SECRET` changed. It must stay stable across restarts. |
| `relation "users" does not exist` | Migrations did not run. Check the boot log for `[DB] Applied migration`. |
