# VPS Deployment — WhatsApp Backend

The frontend stays on Vercel. Only the backend (Express + Socket.IO + Baileys)
runs on the VPS, because Baileys holds a long-lived WebSocket to WhatsApp and
stores auth files on disk — neither works on serverless.

Target: Ubuntu 22.04 / 24.04, 1 vCPU, 1 GB RAM, ~10 GB disk.

Replace `api.example.com` and `deploy` (the user) with your real values.

---

## 1. Server prerequisites

SSH in as root, then create a non-root user and install Node 22 + nginx.

```bash
adduser deploy
usermod -aG sudo deploy

# Node 22 (needed for --env-file support)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs nginx git
npm install -g pm2

node -v   # expect v22.x
```

## 2. Firewall

Allow SSH and HTTP/HTTPS only. Port 5000 stays closed — nginx reaches the app
over loopback.

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

## 3. Get the code

```bash
su - deploy
git clone https://github.com/LaudzaFarhan/Omni-Channel.git ~/wa-backend
cd ~/wa-backend
npm ci --omit=dev
```

## 4. Configure the backend

```bash
cp deploy/.env.server.example .env
nano .env
```

Set `CORS_ORIGIN` to your Vercel URL and confirm `FIREBASE_PROJECT_ID`.
Make sure the file has **no trailing spaces or newlines inside values**.

Create the session and log directories. `sessions/` holds your WhatsApp
credentials — back it up and never delete it, or you must re-scan the QR.

```bash
mkdir -p sessions logs
chmod 700 sessions
```

## 5. Start under pm2

```bash
pm2 start ecosystem.config.cjs --env production
pm2 logs wa-backend --lines 50
```

Expect to see:

```
Multi-Tenant Server listening on http://127.0.0.1:5000
[Config] CORS allowed origins: https://your-frontend.vercel.app
```

Verify locally, then enable boot persistence:

```bash
curl http://127.0.0.1:5000/api/health
# {"status":"ok","uptimeSeconds":5,"activeWhatsAppSessions":0}

pm2 save
pm2 startup    # run the command it prints, as root
pm2 install pm2-logrotate
```

## 6. nginx + TLS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/wa-backend
sudo nano /etc/nginx/sites-available/wa-backend   # set your domain
sudo ln -s /etc/nginx/sites-available/wa-backend /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Point your domain's DNS A record at the VPS IP, wait for it to resolve, then:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.example.com
```

Confirm from your laptop:

```bash
curl https://api.example.com/api/health
```

## 7. Point the frontend at the VPS

In the Vercel dashboard → Settings → Environment Variables:

```
VITE_API_URL = https://api.example.com
```

Re-paste the Firebase values too if any contain a stray newline (that was the
cause of the earlier `identitytoolkit` 400 errors). Then redeploy:

```bash
vercel --prod
```

Open the site, hard-reload, and scan the WhatsApp QR. The session now lives on
the VPS and stays connected once your browser is closed.

---

## Updating

```bash
cd ~/wa-backend
git pull
npm ci --omit=dev
pm2 restart wa-backend
```

`sessions/` is gitignored, so updates never touch your WhatsApp auth.

## Operations

```bash
pm2 status
pm2 logs wa-backend
pm2 restart wa-backend
pm2 monit
```

Back up WhatsApp auth regularly:

```bash
tar czf ~/sessions-backup-$(date +%F).tar.gz -C ~/wa-backend sessions
```

## Troubleshooting

- **Socket.IO won't connect / falls back to polling** — the `Upgrade` and
  `Connection` headers are missing. Check the `/socket.io/` block in nginx.
- **CORS errors in the browser** — `CORS_ORIGIN` must match the frontend origin
  exactly: scheme, host, no trailing slash. Restart after editing `.env`.
- **QR appears on every restart** — `sessions/` is not persisting. Confirm pm2's
  `cwd` is the project root and the directory is writable.
- **401 on every API call** — `FIREBASE_PROJECT_ID` on the server does not match
  the frontend's Firebase project.
- **502 from nginx** — the Node process is down; check `pm2 logs wa-backend`.

## Scaling note

Keep this as a single pm2 process (`instances: 1`, fork mode). Baileys holds
per-session socket state in memory and writes shared auth files, so multiple
workers would open duplicate WhatsApp connections and corrupt each other.
