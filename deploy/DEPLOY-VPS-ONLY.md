# Deploying the whole app to the VPS (frontend + API, no Vercel)

Serves the frontend **and** the API from one Node process on one domain.
`server/index.js` already mounts `dist/` with an SPA fallback and correct cache
headers, so this is configuration and build work, not a code change.

This guide is written for the server confirmed by recon on 2026-08-30:

| | |
|---|---|
| Host | `srv1864578` at `187.77.127.199` |
| OS user | `root` (the existing pm2 apps run as root too) |
| Node / npm | v22.23.1 / 10.9.8 |
| Resources | 31 GB RAM, 387 GB disk, **no swap** |
| Reverse proxy | **nginx**, active on 80/443, certbot-managed. Caddy is installed but inactive |
| Already hosted | `thelabindonesia.my.id` (`/etc/nginx/sites-enabled/thelabindonesia`) |
| Already under pm2 | `webhook-deploy`, `weekly-schedule` |
| This project | **not deployed here yet** — fresh install |

> `DEPLOY.md` describes a *different, smaller* VPS (`43.157.208.221`, 1 GB RAM,
> Caddy). Where the two disagree, this file wins for this machine.

**Set your values.** This guide assumes the app is served at
`omnireach.my.id`. If you want a different hostname, find/replace it here and in
`deploy/nginx-single-origin.conf` before starting.

| Thing | Value |
|---|---|
| App domain | `omnireach.my.id` (+ `www.`) |
| Project root | `/root/wa-backend` |
| pm2 app name | `wa-backend` |
| Internal port | `5000` |

---

## Rules for this shared server

This box serves someone else's site and runs two other pm2 apps. Three things to
avoid:

1. **Never** `pm2 delete all`, `pm2 kill`, or `pm2 resurrect`. Add only.
2. **Never** remove or edit anything already in `/etc/nginx/sites-enabled/`.
   Ignore step 6 of `DEPLOY.md`, which says to delete the `default` site.
3. Port `5000` must be free. Recon showed only nginx on 80/443, so it is — but
   re-check before starting: `sudo ss -tulpn | grep ':5000 '` should print nothing.

Work inside tmux so a dropped SSH connection doesn't kill a build midway:

```bash
tmux new -s deploy      # reattach later with: tmux attach -t deploy
```

---

## 0. Prerequisites, off the server

**a. Push the code.** The frontend build and the admin features must be on
GitHub before the server can pull them. Confirm from your laptop:

```powershell
git log --oneline -1
git status --short        # should be clean
git push
```

**b. DNS.** Point the hostname at this box and wait for it to resolve. Certbot
fails if it does not:

```bash
dig +short omnireach.my.id
# expect 187.77.127.199
```

If `omnireach.my.id` currently points at Vercel or the old VPS, this is the
cutover moment — change the A record now and continue once it propagates.

**c. Postgres.** Authentication and all application data now live in Postgres,
not Firebase. Work through **`deploy/POSTGRES.md`** to install it and create the
role and database before continuing — the server will not start without a
reachable `DATABASE_URL` and a `JWT_SECRET`.

There is no Firebase console step any more, and no domain to authorise: the
hostname you serve from is entirely your own concern now.

---

## 1. Clone the repo

```bash
cd /root
git clone https://github.com/LaudzaFarhan/Omni-Channel.git wa-backend
cd wa-backend
git branch --show-current
```

Check out the branch that has the work, if it is not the default:

```bash
git checkout baileys-7-upgrade
```

If the repo is private, GitHub will prompt for credentials. Use a personal access
token as the password, or add a deploy key.

## 2. Install dependencies

Install **with** dev dependencies — `vite` is a devDependency and you need it to
build the frontend on this server. With 31 GB of RAM there is no reason not to
build here, so the `--omit=dev` in `DEPLOY.md` does not apply.

```bash
npm ci
```

## 3. Configure the environment

```bash
cp deploy/.env.server.example .env
nano .env
```

The frontend and backend share this one file, because pm2 loads it via
`--env-file` and Vite reads it at build time. Set:

```bash
# --- required: the server exits without these ---
DATABASE_URL=postgres://wa_app:PASSWORD@127.0.0.1:5432/wa_app

# Generate with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# Changing it later signs every user out, so keep it stable.
JWT_SECRET=

# --- server ---
PORT=5000
HOST=127.0.0.1
NODE_ENV=production
CORS_ORIGIN=https://omnireach.my.id
PUBLIC_URL=https://omnireach.my.id

# Addresses given the admin role at registration. The FIRST account registered
# becomes an approved admin regardless, so a fresh deployment is usable
# immediately. Admin API access is decided by the stored role, read from Postgres
# on every request.
ADMIN_EMAILS=your-admin@example.com

# --- frontend, read only at build time ---
# MUST be empty for single-origin: the app then calls /api on its own host.
# No Firebase values are needed any more.
VITE_API_URL=
```

**No trailing spaces or newlines inside values.** A stray newline in
`DATABASE_URL` produces a confusing connection failure.

Then lock the file down, since it holds the database password and the signing key:

```bash
chmod 600 .env
```

## 4. Create the runtime directories

`sessions/` holds your WhatsApp credentials. Never delete it, and back it up.

```bash
mkdir -p sessions logs
chmod 700 sessions
```

### Migrating existing WhatsApp sessions

Skip this if no customer has ever connected a device, or if you accept everyone
re-scanning a QR code.

On the **old** server:

```bash
cd ~/wa-backend
tar czf ~/sessions-backup.tar.gz sessions
```

Copy it across and unpack **before** the first start:

```bash
# from your laptop
scp root@43.157.208.221:~/sessions-backup.tar.gz .
scp sessions-backup.tar.gz root@187.77.127.199:/root/

# on this server
cd /root/wa-backend
tar xzf /root/sessions-backup.tar.gz
chmod 700 sessions
ls sessions/          # expect auth_info_* directories
```

Only one server may hold a given WhatsApp session at a time. **Stop the old
backend first** (`pm2 stop wa-backend` there), or the two will fight over the
same credentials and both get logged out.

## 5. Build the frontend

```bash
cd /root/wa-backend
npm run build
ls -la dist/ dist/assets/
```

Expect `dist/index.html` plus hashed files in `dist/assets/`. `dist/` is
gitignored, so `git pull` will never clobber it.

## 6. Start under pm2

```bash
pm2 start ecosystem.config.cjs --env production
pm2 logs wa-backend --lines 30
```

Expect all three lines:

```
[Config] Serving frontend build from /root/wa-backend/dist
Multi-Tenant Server listening on http://127.0.0.1:5000
[Config] CORS allowed origins: https://omnireach.my.id
```

If you see `No dist/ directory found — API only`, step 5 did not produce a build
in the project root.

Verify over loopback before exposing it:

```bash
curl -s http://127.0.0.1:5000/api/health
# {"status":"ok",...}

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/
# 200

curl -s http://127.0.0.1:5000/api/nope
# {"error":"Unknown API endpoint: GET /api/nope"}   <- JSON, not HTML
```

Then persist across reboots. `pm2 save` writes all three apps, which is what you
want — it preserves the two that were already running:

```bash
pm2 list          # confirm webhook-deploy and weekly-schedule are still online
pm2 save
```

`pm2 startup` is presumably already configured on this box since other apps run
here; check with `systemctl is-enabled pm2-root`. Only run `pm2 startup` if that
comes back "disabled" or "not found".

## 7. Add the nginx site

```bash
sudo cp deploy/nginx-single-origin.conf /etc/nginx/sites-available/wa-app
sudo nano /etc/nginx/sites-available/wa-app     # set server_name to your domain
sudo ln -s /etc/nginx/sites-available/wa-app /etc/nginx/sites-enabled/
```

Test **before** reloading. A bad config takes down `thelabindonesia.my.id` too,
so never reload without a passing `-t`:

```bash
sudo nginx -t
```

If that passes:

```bash
sudo systemctl reload nginx
curl -s -o /dev/null -w '%{http_code}\n' https://thelabindonesia.my.id/   # still 200
```

Now issue the certificate. Certbot edits the file to add the TLS block:

```bash
sudo certbot --nginx -d omnireach.my.id -d www.omnireach.my.id
sudo nginx -t && sudo systemctl reload nginx
```

## 8. Import existing Firebase data (only if migrating)

Skip this on a fresh deployment.

Export your Firestore `users`, `plans` and `transactions` collections to a single
JSON file, copy it to the server, then:

```bash
cd /root/wa-backend
node server/migrate-from-firestore.js /root/firestore-export.json --dry-run
node server/migrate-from-firestore.js /root/firestore-export.json
```

Always run `--dry-run` first: it reports what it would import and flags plan
mismatches without writing anything.

Each account keeps its Firebase UID as its primary key, so already-connected
WhatsApp devices keep working. **Passwords do not carry over** — Firebase's
scrypt hashes are derived with its own signer key and cannot be verified here, so
imported accounts are flagged and must set a new password before signing in. The
script prints how many are affected and how to clear the flag.

## 9. Verify end to end

From your laptop:

```powershell
curl.exe -s https://omnireach.my.id/api/health
curl.exe -s https://omnireach.my.id/api/nope
curl.exe -sI https://omnireach.my.id/
```

Then in a browser at `https://omnireach.my.id`:

1. Landing page renders, no 404s in the Network tab.
2. **Register an account.** On a fresh database the first one becomes an approved
   admin automatically.
3. Sign out and back in — this proves password hashing and token issuance work.
4. DevTools → Network → WS shows `/socket.io/` at status **101**.
5. Scan the WhatsApp QR; the session connects and survives a page reload.
6. Admin console shows Customers, Plans and Live Sessions, all returning data
   rather than a 403.
7. Plans tab lists Free and Premium (seeded by the migration).
8. Change a plan's message quota and confirm the Customers tab updates without a
   reload — that proves the `plans-updated` socket event replaced the Firestore
   subscription correctly.

A 403 on the admin tabs means that account's `role` is not `admin`:

```bash
sudo -u postgres psql -d wa_app -c "SELECT email, role, is_approved FROM users;"
sudo -u postgres psql -d wa_app -c "UPDATE users SET role='admin', is_approved=true WHERE email='you@example.com';"
```

## 10. Decommission Vercel

Only after step 9 passes, and after watching it for a day.

**Move DNS off Vercel first.** The nameservers are `ns1/ns2.vercel-dns.com`, so
deleting the project while DNS still points there stops the domain resolving
altogether — site, API and email. Recreate every record at the new provider
(Cloudflare's free tier, or your registrar), switch the nameservers, confirm
resolution, and only then touch the project.

1. Move DNS, and verify `dig +short NS omnireach.my.id` shows the new provider.
2. Vercel dashboard → project `omni-channel` → Settings → **Pause** (reversible)
   rather than delete.
3. Delete the project once you are confident. Optionally drop `.vercel/` and
   `vercel.json` from the repo.

Firebase can be shut down at the same time — nothing in the app calls it any
more. Export anything you want to keep from Firestore before you do, and note
that deleting the Firebase project makes the old passwords unrecoverable, so
complete step 8 first if you are migrating accounts.

---

## Redeploying afterwards

```bash
cd /root/wa-backend
git pull
npm ci                    # only when dependencies changed
npm run build             # only when the frontend changed
pm2 restart wa-backend
```

`sessions/` is gitignored, so WhatsApp credentials survive updates. Frontend-only
changes technically need no restart, since `express.static` reads from disk per
request and `index.html` is served `no-cache`.

Back up the credentials on a schedule:

```bash
tar czf /root/sessions-backup-$(date +%F).tar.gz -C /root/wa-backend sessions
```

## Rollback

```bash
cd /root/wa-backend
git log --oneline -5
git checkout <previous-sha>
npm ci && npm run build && pm2 restart wa-backend
```

Keeping the previous build as `dist.prev` before rebuilding makes a frontend-only
rollback near-instant.

## Consider adding swap

The box has 31 GB of RAM and **no swap**, so `vite build` is fine. But
`ecosystem.config.cjs` sets `max_memory_restart: '600M'`, and Baileys grows with
cached messages. Swap gives the kernel somewhere to go under pressure instead of
OOM-killing a process:

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Server exits at boot, `JWT_SECRET is not set` | Missing from `.env`. Generate one; see step 3. |
| Server exits at boot, `DATABASE_URL is not set` | Missing from `.env`, or pm2 started before it was added: `pm2 restart wa-backend --update-env`. |
| `ECONNREFUSED 127.0.0.1:5432` | Postgres is not running: `systemctl status postgresql`. |
| Everyone signed out after a deploy | `JWT_SECRET` changed. It must stay stable across restarts. |
| Imported users cannot sign in | Expected: Firebase passwords do not carry over. See step 8. |
| Blank page, 404s on `/assets/*` | No build. Check pm2 logs for `Serving frontend build`. |
| `Unexpected token '<'` in console | An API call hit the SPA fallback. With the `/api` 404 guard this returns JSON now — check the path. |
| Socket.IO stuck on polling | The `/socket.io/` block is missing or below `location /`. Order matters. |
| CORS errors | `CORS_ORIGIN` must match the origin exactly: scheme, host, no trailing slash. Restart after editing. |
| 502 from nginx | Node is down: `pm2 logs wa-backend`. |
| nginx won't reload, "duplicate map" | Another site defines `$connection_upgrade`. Ours uses `$wa_connection_upgrade` to avoid this. |
| QR on every restart | `sessions/` not persisting. Confirm pm2's `cwd` is `/root/wa-backend` and the dir is writable. |
| Both servers keep logging out | Two backends share one `sessions/`. Stop the old one. |
| Plans tab empty | Migrations did not run. Check the boot log for `[DB] Applied migration`. |
| Admin tabs 403 | That account's `role` in Postgres is not `admin`. See step 9. |
| 401 on every API call | The access token expired and refresh failed. Sign out and in again; check the browser console. |
