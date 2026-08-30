import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { getStore } from './store.js';

const PORT = process.env.PORT || 5000;
// Bind to loopback by default so a VPS only exposes the app through its reverse
// proxy (nginx). Set HOST=0.0.0.0 to listen on all interfaces (e.g. in Docker).
const HOST = process.env.HOST || '127.0.0.1';

// Comma-separated list of allowed browser origins, e.g.
// CORS_ORIGIN=https://app.example.com,https://www.example.com
// Defaults to '*' to keep local development frictionless, but a warning is
// emitted at startup so this is never left wide open in production by accident.
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '*').trim();
const allowedOrigins = CORS_ORIGIN === '*'
  ? '*'
  : CORS_ORIGIN.split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);

process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});
// Trimmed because values pasted into a host's env UI often carry a trailing newline.
const FIREBASE_PROJECT_ID = (process.env.FIREBASE_PROJECT_ID || 'whatsapp-omni-f2918').trim();
const app = express();
const httpServer = createServer(app);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// HTTP Request logging
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Global Baileys version cache
let latestBaileysVersion = [2, 3000, 1017007846]; // default fallback
fetchLatestBaileysVersion().then(latest => {
  if (latest && latest.version) {
    latestBaileysVersion = latest.version;
    console.log(`[Baileys] Fetched latest WhatsApp Web version: ${latestBaileysVersion.join('.')}`);
  }
}).catch(err => {
  console.warn('[Baileys] Failed to fetch latest version on startup, using default fallback:', err.message);
});

// Cache for Google's Firebase public keys
let googlePublicKeys = {};
let keysExpireTime = 0;

// Fetch Google's public certificates dynamically
async function fetchGooglePublicKeys() {
  if (Date.now() < keysExpireTime && Object.keys(googlePublicKeys).length > 0) {
    return googlePublicKeys;
  }

  return new Promise((resolve, reject) => {
    https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const cacheControl = res.headers['cache-control'] || '';
          const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
          const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) * 1000 : 3600000;
          keysExpireTime = Date.now() + maxAge;
          googlePublicKeys = JSON.parse(data);
          resolve(googlePublicKeys);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Zero-dependency Firebase ID Token Verifier
async function verifyFirebaseIdToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // Validate claims
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) {
      throw new Error('Invalid issuer');
    }
    if (payload.aud !== FIREBASE_PROJECT_ID) {
      throw new Error('Invalid audience');
    }
    if (payload.exp < Date.now() / 1000) {
      throw new Error('Token expired');
    }

    // Verify signature against Google's public key
    const publicKeys = await fetchGooglePublicKeys();
    const cert = publicKeys[header.kid];
    if (!cert) throw new Error('Public certificate not found for key ID: ' + header.kid);

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(parts[0] + '.' + parts[1]);
    
    const isValid = verifier.verify(cert, parts[2], 'base64url');
    if (!isValid) throw new Error('Signature verification failed');

    // Map the standard user ID claims to 'uid' for downstream route compatibility
    payload.uid = payload.user_id || payload.sub;

    return payload; // Returns verified payload containing uid and email
  } catch (err) {
    console.error('[Auth] JWT Verification failed:', err);
    return null;
  }
}

// REST Auth Middleware
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  const token = authHeader.split('Bearer ')[1];
  const decoded = await verifyFirebaseIdToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
  req.user = decoded;
  // Kept so downstream middleware can read Firestore as the caller (see
  // adminMiddleware), rather than needing a service account.
  req.idToken = token;
  next();
}

// =============================================
// MULTI-SESSION SUPPORT
// =============================================
// activeSessions keyed by compositeKey = `${uid}_${sessionId}`
const activeSessions = {};

// Helper: build composite key
function sessionKey(uid, sessionId) {
  return `${uid}_${sessionId || 'default'}`;
}

// Debounced 'history-sync-complete' emitter.
// WhatsApp streams hundreds of contact/chat events during a sync; emitting on each
// one makes the client refetch in a tight loop (flickering). Coalesce bursts into
// at most one refresh signal per window.
const syncEmitTimers = {};
function emitSyncComplete(uid, sessionId) {
  const k = sessionKey(uid, sessionId);
  if (syncEmitTimers[k]) return; // already scheduled within the current window
  syncEmitTimers[k] = setTimeout(() => {
    delete syncEmitTimers[k];
    io.to(uid).emit('history-sync-complete', { sessionId });
  }, 700);
}

async function getOrInitWASocket(uid, sessionId = 'default') {
  const key = sessionKey(uid, sessionId);

  if (activeSessions[key] && activeSessions[key].sock) {
    return activeSessions[key];
  }

  console.log(`[Baileys - ${key}] Initializing socket connection...`);

  // Preserve reconnect bookkeeping across re-inits so backoff keeps escalating
  // instead of resetting on every attempt.
  const prevAttempts = activeSessions[key]?.reconnectAttempts || 0;
  if (activeSessions[key]?.reconnectTimer) {
    clearTimeout(activeSessions[key].reconnectTimer);
  }

  // Set default placeholder
  activeSessions[key] = {
    sock: null,
    status: 'connecting',
    qr: null,
    user: null,
    uid,
    sessionId,
    reconnectAttempts: prevAttempts,
    reconnectTimer: null,
  };

  try {
    const authFolder = path.resolve(`sessions/auth_info_${key}`);
    if (!fs.existsSync(path.resolve('sessions'))) {
      fs.mkdirSync(path.resolve('sessions'), { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    // Use cached WhatsApp version to prevent network blocking during socket connection
    const version = latestBaileysVersion;

    const makeWASocketFunc = makeWASocket.default || makeWASocket;
    const sock = makeWASocketFunc({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'info' }),
      syncFullHistory: true,
      shouldSyncHistoryMessage: () => true,
    });

    activeSessions[key].sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      const session = activeSessions[key];
      if (!session) return; // session deleted during logout

      // Guard: Ignore events from obsolete socket instances to prevent connection conflicts (e.g. Code 440)
      if (session.sock !== sock) {
        console.log(`[Baileys - ${key}] Ignoring connection.update (connection: ${connection}) for obsolete socket instance.`);
        return;
      }

      if (qr) {
        session.status = 'qr';
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          session.qr = qrDataUrl;
          io.to(uid).emit('status-change', { sessionId, status: 'qr', qr: qrDataUrl });
        } catch (err) {
          console.error(`[Baileys - ${key}] Failed to generate QR:`, err);
        }
      }

      if (connection === 'connecting') {
        session.status = 'connecting';
        io.to(uid).emit('status-change', { sessionId, status: 'connecting' });
      }

      if (connection === 'open') {
        session.status = 'connected';
        session.qr = null;
        session.user = sock.user;
        session.reconnectAttempts = 0; // healthy connection resets backoff
        io.to(uid).emit('status-change', { sessionId, status: 'connected', user: sock.user });
        console.log(`[Baileys - ${key}] Connection successfully opened!`);
      }

      if (connection === 'close') {
        // Ignore close events from a socket that has already been superseded by a
        // newer one (prevents duplicate/overlapping reconnect loops).
        if (activeSessions[key] && activeSessions[key].sock && activeSessions[key].sock !== sock) {
          return;
        }

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[Baileys - ${key}] Connection closed. Code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

        session.status = 'disconnected';
        session.qr = null;
        session.user = null;
        session.sock = null;
        io.to(uid).emit('status-change', { sessionId, status: 'disconnected', reason: statusCode });

        if (shouldReconnect) {
          // Exponential backoff (1s, 2s, 4s ... capped at 30s) so a flapping
          // connection can't spin in a tight loop and miss live messages.
          const attempts = (session.reconnectAttempts || 0) + 1;
          session.reconnectAttempts = attempts;
          const delay = Math.min(30000, 1000 * Math.pow(2, attempts - 1));
          console.log(`[Baileys - ${key}] Scheduling reconnect in ${delay}ms (attempt ${attempts}).`);

          if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
          session.reconnectTimer = setTimeout(() => {
            // Only reconnect if the session still exists and isn't already connected.
            const current = activeSessions[key];
            if (current && !current.sock) {
              getOrInitWASocket(uid, sessionId);
            }
          }, delay);
        } else {
          logoutSession(uid, sessionId);
        }
      }
    });

    const fetchGroupMetadataIfNeeded = async (jid, currentName) => {
      const rawIdNum = jid.split('@')[0];
      if (currentName && currentName !== jid && currentName !== rawIdNum) {
        return; // Already has a clean group name, skip network request
      }

      try {
        console.log(`[Baileys - ${key}] Fetching metadata for group: ${jid}`);
        const metadata = await sock.groupMetadata(jid);
        if (metadata && metadata.subject) {
          const store = getStore(key);
          store.addChat({
            id: jid,
            name: metadata.subject
          });
          emitSyncComplete(uid, sessionId);
        }
      } catch (err) {
        console.warn(`[Baileys - ${key}] Failed to fetch group metadata for ${jid}:`, err.message);
      }
    };

    sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
      console.log(`[Baileys - ${key}] Syncing history: ${chats?.length || 0} chats, ${messages?.length || 0} messages`);
      const store = getStore(key);
      if (contacts) contacts.forEach(c => store.addContact(c));
      if (chats) {
        chats.forEach(c => {
          store.addChat(c);
          if (c.id.endsWith('@g.us')) {
            fetchGroupMetadataIfNeeded(c.id, c.name);
          }
        });
      }
      if (messages) {
        messages.forEach(m => {
          store.addMessage(m.key.remoteJid, m);
        });
      }
      emitSyncComplete(uid, sessionId);
    });

    sock.ev.on('chats.upsert', (newChats) => {
      const store = getStore(key);
      newChats.forEach(c => {
        store.addChat(c);
        if (c.id.endsWith('@g.us')) {
          fetchGroupMetadataIfNeeded(c.id, c.name);
        }
      });
      emitSyncComplete(uid, sessionId);
    });

    sock.ev.on('chats.update', (updates) => {
      const store = getStore(key);
      updates.forEach(u => {
        store.addChat(u);
        if (u.id.endsWith('@g.us')) {
          const existing = store.chats[u.id];
          fetchGroupMetadataIfNeeded(u.id, u.name || existing?.name);
        }
      });
      emitSyncComplete(uid, sessionId);
    });

    sock.ev.on('contacts.upsert', (newContacts) => {
      const store = getStore(key);
      newContacts.forEach(c => {
        // Log full contact to discover LID-to-phone mappings
        if (c.id?.endsWith('@lid') || c.lid) {
          console.log(`[Baileys - ${key}] Contact upsert with LID:`, JSON.stringify({ id: c.id, name: c.name, notify: c.notify, verifiedName: c.verifiedName, lid: c.lid, phone: c.phone, number: c.number }));
        }
        store.addContact(c);
      });
      emitSyncComplete(uid, sessionId);
    });

    sock.ev.on('contacts.update', (updates) => {
      const store = getStore(key);
      updates.forEach(u => {
        if (u.id?.endsWith('@lid') || u.lid) {
          console.log(`[Baileys - ${key}] Contact update with LID:`, JSON.stringify({ id: u.id, name: u.name, notify: u.notify, verifiedName: u.verifiedName, lid: u.lid, phone: u.phone, number: u.number }));
        }
        store.addContact(u);
      });
      emitSyncComplete(uid, sessionId);
    });

    // Explicit LID <-> phone number mapping shared by WhatsApp
    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      if (!lid || !jid) return;
      console.log(`[Baileys - ${key}] Phone number share: ${lid} -> ${jid}`);
      const store = getStore(key);
      store.addPhoneNumberShare(lid, jid);
      emitSyncComplete(uid, sessionId);
    });

    // After connection is opened, re-apply the contact-derived LID mappings to
    // any chats that synced before their contact record arrived, then refresh clients.
    const resolveLidContacts = () => {
      const store = getStore(key);
      let resolved = 0;
      Object.keys(store.chats).forEach(jid => {
        if (jid.endsWith('@lid')) {
          const before = store.chats[jid].name;
          store._applyMappingToChat(jid);
          if (store.chats[jid].name !== before) resolved++;
        }
      });

      const stillUnresolved = store.getUnresolvedLids().length;
      console.log(`[Baileys - ${key}] LID resolution pass: ${resolved} chats updated, ${stillUnresolved} LIDs still without a phone number.`);
      store.save();
      emitSyncComplete(uid, sessionId);
    };

    // Resolve @lid chats to real phone numbers.
    //
    // Baileys v7 maintains a LID <-> phone mapping store (populated from the
    // WhatsApp session itself), which can translate a LID directly. That is the
    // only reliable way to do it: WhatsApp never exposes a bulk "reverse a LID"
    // API, and LID-only accounts no longer receive phone numbers in contacts.
    //
    // Falls back to the phone -> LID USync lookup on older Baileys, which can
    // still pair up any numbers we happen to know already.
    const resolveLidsToPhoneNumbers = async () => {
      const store = getStore(key);
      const unresolved = store.getUnresolvedLids();
      if (unresolved.length === 0) return;

      const lidStore = sock.signalRepository?.lidMapping;
      let learned = 0;

      if (lidStore && typeof lidStore.getPNForLID === 'function') {
        console.log(`[Baileys - ${key}] Resolving ${unresolved.length} LIDs via the Baileys LID mapping store...`);

        // Prefer the bulk API when available, otherwise resolve one at a time.
        if (typeof lidStore.getPNsForLIDs === 'function') {
          const CHUNK = 50;
          for (let i = 0; i < unresolved.length; i += CHUNK) {
            const chunk = unresolved.slice(i, i + CHUNK);
            try {
              const pairs = await lidStore.getPNsForLIDs(chunk);
              for (const pair of pairs || []) {
                if (pair?.lid && pair?.pn) {
                  store.addPhoneNumberShare(pair.lid, pair.pn);
                  learned++;
                }
              }
            } catch (err) {
              console.warn(`[Baileys - ${key}] Bulk LID lookup failed:`, err.message);
            }
          }
        }

        // Fill any gaps individually.
        for (const lid of store.getUnresolvedLids()) {
          try {
            const pn = await lidStore.getPNForLID(lid);
            if (pn) {
              store.addPhoneNumberShare(lid, pn);
              learned++;
            }
          } catch {
            // best effort per contact
          }
        }
      } else {
        // Legacy path: ask WhatsApp for the LID of each number we already know.
        const candidates = store.getUnmappedPhoneJids();
        console.log(`[Baileys - ${key}] LID mapping store unavailable; trying USync on ${candidates.length} known numbers.`);

        const BATCH_SIZE = 20;
        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
          const batch = candidates.slice(i, i + BATCH_SIZE);
          try {
            const results = await sock.onWhatsApp(...batch);
            for (const entry of results || []) {
              const lidRaw = typeof entry.lid === 'string' ? entry.lid : entry.lid?.toString?.();
              if (!lidRaw || !entry.jid) continue;
              const lid = lidRaw.includes('@') ? lidRaw : `${lidRaw}@lid`;
              store.addPhoneNumberShare(lid, entry.jid, store.getPendingName(entry.jid));
              learned++;
            }
          } catch (err) {
            console.warn(`[Baileys - ${key}] USync batch failed:`, err.message);
          }
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      const remaining = store.getUnresolvedLids().length;
      console.log(`[Baileys - ${key}] LID resolution: learned ${learned} phone numbers; unresolved ${unresolved.length} -> ${remaining}.`);

      resolveLidContacts();
    };

    // Run LID resolution 10 seconds after connection to allow sync to complete
    setTimeout(() => {
      if (activeSessions[key]?.status === 'connected') {
        try {
          resolveLidContacts();
        } catch (err) {
          console.warn(`[Baileys - ${key}] LID resolution error:`, err.message);
        }
      }
    }, 10000);

    // Expose the resolver so the REST endpoint can trigger it on demand.
    activeSessions[key].resolveLids = resolveLidsToPhoneNumbers;

    // Then look up LIDs for known phone numbers once the history sync has had
    // time to populate contacts. Runs in the background; failures are non-fatal.
    setTimeout(() => {
      if (activeSessions[key]?.status === 'connected') {
        resolveLidsToPhoneNumbers().catch(err => {
          console.warn(`[Baileys - ${key}] USync LID resolution error:`, err.message);
        });
      }
    }, 45000);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify' || type === 'append') {
        const store = getStore(key);
        for (const msg of messages) {
          const jid = msg.key.remoteJid;
          
          if (!msg.key.fromMe && msg.pushName) {
            store.addContact({ id: jid, name: msg.pushName });
          }

          store.addMessage(jid, msg);
          io.to(uid).emit('new-message', { sessionId, jid, message: msg });
        }
      }
    });

    sock.ev.on('messages.update', updates => {
      const store = getStore(key);
      for (const update of updates) {
        const jid = update.key.remoteJid;
        const msgId = update.key.id;
        
        // Sync message update to database store
        store.updateMessage(jid, msgId, update.update);
        
        // If this message is the last message of the chat, update the chat's lastMessageStatus too
        const chat = store.chats[jid];
        const msgs = store.messages[jid] || [];
        const lastMsg = msgs[msgs.length - 1];
        if (chat && lastMsg && lastMsg.key.id === msgId) {
          store.addChat({
            id: jid,
            lastMessageStatus: update.update.status
          });
        }

        io.to(uid).emit('message-update', { sessionId, ...update });
      }
    });

    sock.ev.on('groups.update', (updates) => {
      const store = getStore(key);
      updates.forEach(u => {
        if (u.subject) {
          console.log(`[Baileys - ${key}] Real-time group subject updated: ${u.id} -> ${u.subject}`);
          store.addChat({
            id: u.id,
            name: u.subject
          });
          emitSyncComplete(uid, sessionId);
        }
      });
    });

    return activeSessions[key];
  } catch (err) {
    console.error(`[Baileys - ${key}] Setup error:`, err);
    if (activeSessions[key]) {
      activeSessions[key].status = 'disconnected';
      io.to(uid).emit('status-change', { sessionId, status: 'disconnected', error: err.message });
    }
  }
}

function logoutSession(uid, sessionId = 'default') {
  const key = sessionKey(uid, sessionId);
  console.log(`[Baileys - ${key}] Logging out and deleting session data...`);
  const session = activeSessions[key];
  
  if (session) {
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
    }
    if (session.sock) {
      try {
        session.sock.logout();
      } catch (e) {}
    }
    delete activeSessions[key];
  }

  const authFolder = path.resolve(`sessions/auth_info_${key}`);
  if (fs.existsSync(authFolder)) {
    fs.rmSync(authFolder, { recursive: true, force: true });
  }

  const store = getStore(key);
  store.clear();

  io.to(uid).emit('status-change', { sessionId, status: 'disconnected' });
  io.to(uid).emit('store-cleared', { sessionId });
}

// =============================================
// FIRESTORE REST ACCESS
// =============================================
// Reads go out with the caller's own ID token, so the same security rules that
// protect the browser apply here. No service account key is involved.
function firestoreGetDocument(docPath, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${docPath}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const body = JSON.parse(data);
            return resolve({ ok: true, fields: body.fields || {} });
          } catch (e) {
            console.error(`[Firestore REST] Error parsing ${docPath}:`, e);
            return resolve({ ok: false, status: res.statusCode, fields: {} });
          }
        }
        // 404 is expected (missing plan, missing profile) and not worth a warning.
        if (res.statusCode !== 404) {
          console.warn(`[Firestore REST] Failed to fetch ${docPath} (HTTP ${res.statusCode}):`, data);
        }
        resolve({ ok: false, status: res.statusCode, fields: {} });
      });
    });

    req.on('error', (err) => {
      console.error(`[Firestore REST] Request error for ${docPath}:`, err);
      resolve({ ok: false, status: 0, fields: {} });
    });

    req.end();
  });
}

// Firestore REST wraps every value in a type tag ({ integerValue: "5" }).
function fsNumber(field) {
  if (!field) return undefined;
  const raw = field.integerValue ?? field.doubleValue;
  if (raw === undefined || raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fsString(field) {
  return field?.stringValue ?? undefined;
}

function fsBool(field) {
  return field?.booleanValue ?? undefined;
}

async function fetchUserProfile(uid, token) {
  const { ok, fields } = await firestoreGetDocument(`users/${uid}`, token);
  if (!ok) return null;
  return {
    uid,
    email: fsString(fields.email),
    name: fsString(fields.name),
    role: fsString(fields.role),
    isApproved: fsBool(fields.isApproved),
    tier: fsString(fields.tier),
    planId: fsString(fields.planId),
    sessionLimit: fsNumber(fields.sessionLimit),
    messageLimit: fsNumber(fields.messageLimit),
    messagesSent: fsNumber(fields.messagesSent),
  };
}

// Plan documents change rarely but are read on every socket connect, so cache
// them briefly to avoid an extra round trip per browser tab.
const PLAN_CACHE_TTL_MS = 60000;
const planCache = new Map(); // planId -> { expires, plan }

async function fetchPlan(planId, token) {
  if (!planId) return null;

  const cached = planCache.get(planId);
  if (cached && cached.expires > Date.now()) return cached.plan;

  const { ok, fields } = await firestoreGetDocument(`plans/${planId}`, token);
  const plan = ok
    ? {
        id: planId,
        name: fsString(fields.name) || planId,
        sessionLimit: fsNumber(fields.sessionLimit),
        messageLimit: fsNumber(fields.messageLimit),
      }
    : null;

  planCache.set(planId, { expires: Date.now() + PLAN_CACHE_TTL_MS, plan });
  return plan;
}

// Effective device limit for a user.
//
// Mirrors resolveEffectiveLimits() in src/utils/plans.js: an explicit
// sessionLimit on the user document wins, otherwise the value comes from their
// plan, otherwise the historical default of one device.
const DEFAULT_SESSION_LIMIT = 1;

async function resolveSessionLimit(uid, token, profileHint) {
  try {
    const profile = profileHint || await fetchUserProfile(uid, token);
    if (!profile) return DEFAULT_SESSION_LIMIT;

    if (Number.isFinite(profile.sessionLimit)) {
      return Math.max(1, profile.sessionLimit);
    }

    const planId = profile.planId || profile.tier;
    const plan = await fetchPlan(planId, token);
    if (plan && Number.isFinite(plan.sessionLimit)) {
      return Math.max(1, plan.sessionLimit);
    }

    return DEFAULT_SESSION_LIMIT;
  } catch (err) {
    console.error('[Limits] Failed to resolve session limit:', err);
    return DEFAULT_SESSION_LIMIT;
  }
}

// =============================================
// ADMIN AUTHORIZATION
// =============================================
// Comma-separated ADMIN_EMAILS, defaulting to the same addresses as
// isAdminEmail() in firestore.rules. Keep the three lists in sync:
// firestore.rules, src/utils/adminAccess.js, and this one.
const BUILT_IN_ADMIN_EMAILS = ['owner@admin.com', 'adminthelab@gmail.com'];
const ADMIN_EMAILS = Array.from(new Set([
  ...BUILT_IN_ADMIN_EMAILS,
  ...(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
]));

function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
}

// Guards /api/admin/*. Runs after authMiddleware, so req.user and req.idToken
// are already populated. Requires BOTH an allow-listed verified email and a
// stored role of 'admin', matching the isAdmin() rule in firestore.rules — a
// tampered role field alone grants nothing.
async function adminMiddleware(req, res, next) {
  const email = req.user?.email;

  if (!isAdminEmail(email)) {
    console.warn(`[Admin] Rejected ${req.method} ${req.path} for non-allow-listed address: ${email || 'unknown'}`);
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  const profile = await fetchUserProfile(req.user.uid, req.idToken);
  if (!profile || profile.role !== 'admin') {
    console.warn(`[Admin] Rejected ${req.method} ${req.path}: ${email} is allow-listed but role is '${profile?.role || 'missing'}'`);
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }

  req.adminProfile = profile;
  next();
}

// Socket.io JWT Authentication Middleware
io.use(async (socket, next) => {
  console.log(`[Socket] Connection attempt from socket ID ${socket.id}`);
  const token = socket.handshake.auth.token || socket.handshake.headers['x-auth-token'];
  if (!token) {
    console.warn(`[Socket] Rejected: Missing auth token from socket ID ${socket.id}`);
    return next(new Error('Authentication error: Missing token'));
  }
  const decoded = await verifyFirebaseIdToken(token);
  if (!decoded) {
    console.warn(`[Socket] Rejected: Invalid auth token from socket ID ${socket.id}`);
    return next(new Error('Authentication error: Invalid token'));
  }
  socket.user = decoded;
  socket.token = token;
  next();
});

io.on('connection', async (socket) => {
  const uid = socket.user.uid;
  const token = socket.token;

  // Device limit comes from the user's override if set, otherwise their plan.
  const sessionLimit = await resolveSessionLimit(uid, token);

  // Check if active sockets for this user ID >= sessionLimit
  const activeSockets = io.sockets.adapter.rooms.get(uid);
  if (activeSockets && activeSockets.size >= sessionLimit) {
    console.warn(`[Socket] Connection rejected for ${socket.id} (user: ${uid}) - Session limit (${sessionLimit}) reached.`);
    socket.emit('session-blocked', { 
      message: `This account is already logged in on ${sessionLimit} device${sessionLimit > 1 ? 's' : ''}.` 
    });
    socket.disconnect(true);
    return;
  }

  socket.join(uid);
  console.log(`[Socket] User JID Room Joined: ${uid} (Limit: ${sessionLimit})`);

  // Broadcast current active session count to all user's sockets
  const roomSockets = io.sockets.adapter.rooms.get(uid);
  io.to(uid).emit('session-count-update', { count: roomSockets ? roomSockets.size : 1 });

  // Send all existing WA session statuses to the newly connected browser tab
  const userSessions = Object.entries(activeSessions)
    .filter(([k, v]) => v.uid === uid)
    .map(([k, v]) => ({
      sessionId: v.sessionId,
      status: v.status,
      qr: v.qr,
      user: v.user,
    }));
  socket.emit('all-sessions', userSessions);

  // Listen for client requesting to init a specific WA session
  socket.on('init-session', (data) => {
    const sid = data?.sessionId || 'default';
    console.log(`[Socket] Client requested init-session: ${uid}/${sid}`);
    getOrInitWASocket(uid, sid);
  });

  // Listen for client requesting to disconnect a specific WA session
  socket.on('logout-session', (data) => {
    const sid = data?.sessionId || 'default';
    console.log(`[Socket] Client requested logout-session: ${uid}/${sid}`);
    logoutSession(uid, sid);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] User JID Room Disconnected: ${uid}`);
    const remainingSockets = io.sockets.adapter.rooms.get(uid);
    io.to(uid).emit('session-count-update', { count: remainingSockets ? remainingSockets.size : 0 });
  });
});

// Lazy-load group metadata helper to sync group subjects
async function fetchGroupMetadata(uid, sessionId, jid) {
  const key = sessionKey(uid, sessionId);
  const session = activeSessions[key];
  if (!session || !session.sock) return;
  
  try {
    const metadata = await session.sock.groupMetadata(jid);
    if (metadata && metadata.subject) {
      const store = getStore(key);
      const existing = store.chats[jid];
      if (!existing || existing.name !== metadata.subject) {
        console.log(`[Baileys - ${key}] Lazy-loaded group name update for ${jid}: ${metadata.subject}`);
        store.addChat({
          id: jid,
          name: metadata.subject
        });
        emitSyncComplete(uid, sessionId);
      }
    }
  } catch (err) {
    console.warn(`[Baileys - ${key}] Failed to lazy-load group metadata for ${jid}:`, err.message);
  }
}

// =============================================
// REST API — all endpoints accept ?sessionId= query param
// =============================================

// Get all WA sessions for the user
app.get('/api/sessions', authMiddleware, (req, res) => {
  const uid = req.user.uid;
  const userSessionEntries = Object.entries(activeSessions)
    .filter(([k, v]) => v.uid === uid)
    .map(([k, v]) => ({
      sessionId: v.sessionId,
      status: v.status,
      qr: v.qr,
      user: v.user,
    }));
  res.json(userSessionEntries);
});

app.get('/api/status', authMiddleware, (req, res) => {
  const uid = req.user.uid;
  const sid = req.query.sessionId || 'default';
  const key = sessionKey(uid, sid);
  const session = activeSessions[key] || { status: 'disconnected', qr: null, user: null };
  // Trigger socket init if it hasn't been booted yet
  getOrInitWASocket(uid, sid);
  res.json({
    sessionId: sid,
    status: session.status,
    qr: session.qr,
    user: session.user
  });
});

app.get('/api/chats', authMiddleware, (req, res) => {
  const uid = req.user.uid;
  const sid = req.query.sessionId || 'default';
  const key = sessionKey(uid, sid);
  const store = getStore(key);
  const sortedChats = Object.values(store.chats).sort((a, b) => {
    return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
  });
  res.json(sortedChats);
});

app.get('/api/chats/:jid/messages', authMiddleware, (req, res) => {
  const uid = req.user.uid;
  const sid = req.query.sessionId || 'default';
  const key = sessionKey(uid, sid);
  const store = getStore(key);
  const jid = req.params.jid;

  // Trigger lazy metadata sync in the background if group chat
  if (jid.endsWith('@g.us')) {
    fetchGroupMetadata(uid, sid, jid);
  }

  res.json(store.messages[jid] || []);
});

app.post('/api/messages/send', authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const sid = req.body.sessionId || req.query.sessionId || 'default';
  const key = sessionKey(uid, sid);
  const { to, text, file } = req.body;
  const session = activeSessions[key];

  if (!session || !session.sock) {
    return res.status(500).json({ error: 'WhatsApp client is not initialized' });
  }
  if (session.status !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp is not connected' });
  }
  if (!to) {
    return res.status(400).json({ error: 'Missing to (recipient JID)' });
  }

  try {
    let jid = to;
    if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us') && !jid.endsWith('@lid')) {
      const cleanNum = to.replace(/\D/g, '');
      jid = `${cleanNum}@s.whatsapp.net`;
    }

    let response;
    if (file && file.base64) {
      const mimeType = file.type;
      const base64Data = file.base64.split(';base64,').pop();
      const buffer = Buffer.from(base64Data, 'base64');

      if (mimeType.startsWith('image/')) {
        response = await session.sock.sendMessage(jid, { image: buffer, caption: text });
      } else if (mimeType.startsWith('video/')) {
        response = await session.sock.sendMessage(jid, { video: buffer, caption: text });
      } else if (mimeType.startsWith('audio/')) {
        response = await session.sock.sendMessage(jid, { audio: buffer, mimetype: mimeType });
      } else {
        response = await session.sock.sendMessage(jid, { 
          document: buffer, 
          mimetype: mimeType, 
          fileName: file.name 
        });
      }
    } else {
      if (!text) {
        return res.status(400).json({ error: 'Missing text or file content' });
      }
      response = await session.sock.sendMessage(jid, { text });
    }
    
    // Cache the message
    const store = getStore(key);
    store.addMessage(jid, response);
    io.to(uid).emit('new-message', { sessionId: sid, jid, message: response });

    res.json({ success: true, message: response });
  } catch (err) {
    console.error(`[Baileys - ${key}] Failed to send message:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/media/download', authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const sid = req.body.sessionId || req.query.sessionId || 'default';
  const key = sessionKey(uid, sid);
  const session = activeSessions[key];

  if (!session || !session.sock) {
    return res.status(500).json({ error: 'WhatsApp client is not initialized' });
  }

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Missing message object' });
  }

  try {
    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger: pino({ level: 'silent' }),
        reuploadRequest: session.sock.updateMediaMessage
      }
    );

    // Determine content type
    const msg = message.message;
    let contentType = 'application/octet-stream';
    if (msg?.imageMessage) contentType = msg.imageMessage.mimetype || 'image/jpeg';
    else if (msg?.videoMessage) contentType = msg.videoMessage.mimetype || 'video/mp4';
    else if (msg?.audioMessage) contentType = msg.audioMessage.mimetype || 'audio/ogg';
    else if (msg?.documentMessage) contentType = msg.documentMessage.mimetype || 'application/octet-stream';
    else if (msg?.stickerMessage) contentType = msg.stickerMessage.mimetype || 'image/webp';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error(`[Media - ${key}] Failed to download media:`, err.message);
    res.status(500).json({ error: 'Failed to download media: ' + err.message });
  }
});

app.post('/api/sync', authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const sid = req.body.sessionId || req.query.sessionId || 'default';
  const key = sessionKey(uid, sid);
  const session = activeSessions[key];

  if (!session) {
    return res.status(404).json({ error: 'WhatsApp session not found' });
  }

  try {
    console.log(`[Baileys - ${key}] Manual history sync requested. Re-connecting socket...`);
    
    // Close the socket connection if open
    if (session.sock) {
      try {
        session.sock.end(new Error('Manual sync requested'));
      } catch (err) {
        console.warn(`[Baileys - ${key}] Error ending socket:`, err.message);
      }
      session.sock = null;
    }

    // Reset session states
    session.status = 'connecting';
    session.qr = null;
    io.to(uid).emit('status-change', { sessionId: sid, status: 'connecting' });

    // Initialize socket connection again
    getOrInitWASocket(uid, sid);

    res.json({ success: true, message: 'Sync started successfully' });
  } catch (err) {
    console.error(`[Baileys - ${key}] Failed to sync history:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', authMiddleware, (req, res) => {
  const uid = req.user.uid;
  const sid = req.body.sessionId || req.query.sessionId || 'default';
  try {
    logoutSession(uid, sid);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================
// MAYAR PAYMENT GATEWAY INTEGRATION
// =============================================
// Public origin of the deployed app, used as the post-payment return URL when
// the request carries no Referer. Set this to your domain so the hardcoded
// fallback is never relied on.
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://www.omnireach.my.id').trim().replace(/\/+$/, '');

const MAYAR_API_KEY = (process.env.MAYAR_API_KEY || '').trim();
const MAYAR_WEBHOOK_TOKEN = (process.env.MAYAR_WEBHOOK_TOKEN || '').trim();
const MAYAR_PAYMENT_LINK = (process.env.MAYAR_PAYMENT_LINK || '').trim();

// Transactions Store Helper (File-backed fallback)
const transactionsFilePath = path.resolve('sessions/transactions.json');

function loadTransactionsStore() {
  try {
    const sessionsDir = path.resolve('sessions');
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
    if (fs.existsSync(transactionsFilePath)) {
      return JSON.parse(fs.readFileSync(transactionsFilePath, 'utf-8')) || [];
    }
  } catch (e) {
    console.error('[Transactions Store] Error reading transactions.json:', e);
  }
  return [];
}

function saveTransactionRecord(record) {
  try {
    const list = loadTransactionsStore();
    const existingIndex = list.findIndex(t => t.transactionId === record.transactionId || (t.id && t.id === record.transactionId));
    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...record };
    } else {
      list.unshift(record);
    }
    fs.writeFileSync(transactionsFilePath, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Transactions Store] Error saving transaction:', e);
  }
}

app.get('/api/mayar/config', (req, res) => {
  res.json({
    configured: Boolean(MAYAR_API_KEY || MAYAR_PAYMENT_LINK),
    hasWebhookToken: Boolean(MAYAR_WEBHOOK_TOKEN)
  });
});

app.get('/api/transactions', authMiddleware, (req, res) => {
  const uid = req.user.uid;
  const allTx = loadTransactionsStore();
  const userTx = allTx.filter(t => t.uid === uid);
  res.json(userTx);
});

app.post('/api/mayar/create-checkout', authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const userEmail = req.user.email;
  const { type, amount, description } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const transactionId = 'MAYAR-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const checkoutPayload = {
    name: userEmail ? userEmail.split('@')[0] : 'Customer',
    email: userEmail,
    amount: amount,
    description: description || (type === 'session' ? 'Device Session License' : 'Premium Subscription Upgrade'),
    redirectUrl: req.headers.referer || PUBLIC_URL
  };

  try {
    let paymentUrl = '';
    
    // 1) Use MAYAR_PAYMENT_LINK if set in .env
    if (MAYAR_PAYMENT_LINK) {
      const sep = MAYAR_PAYMENT_LINK.includes('?') ? '&' : '?';
      paymentUrl = `${MAYAR_PAYMENT_LINK}${sep}email=${encodeURIComponent(userEmail || '')}&ref=${transactionId}`;
    }

    // 2) Call Mayar Headless API if API Key is available
    if (!paymentUrl && MAYAR_API_KEY) {
      try {
        const mayarRes = await fetch('https://api.mayar.id/hl/v1/payment/create', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${MAYAR_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(checkoutPayload)
        });

        if (mayarRes.ok) {
          const mayarData = await mayarRes.json();
          paymentUrl = mayarData.data?.link || mayarData.data?.url || mayarData.paymentUrl || '';
        } else {
          console.warn('[Mayar API] Request returned status:', mayarRes.status);
        }
      } catch (apiErr) {
        console.error('[Mayar API] Error reaching Mayar endpoint:', apiErr.message);
      }
    }

    // Save transaction to server store
    const txRecord = {
      transactionId,
      uid,
      email: userEmail || '',
      item: checkoutPayload.description,
      type,
      amount: amount,
      currency: 'IDR',
      status: 'PENDING',
      paymentUrl,
      createdAt: new Date().toISOString()
    };
    saveTransactionRecord(txRecord);

    if (!paymentUrl) {
      return res.json({
        success: false,
        isConfigError: true,
        transactionId,
        message: 'Mayar Secret API Key (mayar_sec_...) or MAYAR_PAYMENT_LINK required in .env'
      });
    }

    res.json({
      success: true,
      transactionId,
      paymentUrl,
      amount,
      type,
      description: checkoutPayload.description
    });
  } catch (err) {
    console.error('[Mayar Checkout] Error creating checkout:', err);
    res.status(500).json({ error: 'Failed to create payment checkout link' });
  }
});

// Unauthenticated Mayar Webhook receiver endpoint
app.post('/api/webhooks/mayar', async (req, res) => {
  const token = req.headers['x-mayar-token'] || req.headers['authorization'] || req.query.token || '';
  
  // Verify token if configured
  if (MAYAR_WEBHOOK_TOKEN && !token.includes(MAYAR_WEBHOOK_TOKEN) && token !== MAYAR_WEBHOOK_TOKEN) {
    console.warn('[Mayar Webhook] Received webhook with invalid authorization token');
    return res.status(401).json({ error: 'Unauthorized webhook token' });
  }

  const payload = req.body || {};
  console.log('[Mayar Webhook] Processing event:', payload.event || payload.status || 'payment_event');

  try {
    const status = (payload.status || payload.event || '').toUpperCase();
    const isPaid = status.includes('PAID') || status.includes('SUCCESS') || status.includes('PAYMENT.RECEIVED');

    if (isPaid) {
      const email = payload.customerEmail || payload.data?.customerEmail || payload.email;
      const type = payload.metadata?.type || payload.data?.metadata?.type || 'session';
      const uid = payload.metadata?.uid || payload.data?.metadata?.uid;

      console.log(`[Mayar Webhook] Payment SUCCESS for ${email || uid || 'customer'}. Fulfilling product...`);

      if (uid) {
        io.to(uid).emit('payment-success', {
          transactionId: payload.id || payload.transactionId,
          type,
          timestamp: new Date().toISOString()
        });
      }
    }

    res.json({ success: true, message: 'Webhook processed successfully' });
  } catch (err) {
    console.error('[Mayar Webhook] Processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Manually trigger LID -> phone resolution for the active session.
// Useful right after a big history sync, without waiting for a reconnect.
app.post('/api/resolve-contacts', authMiddleware, async (req, res) => {
  const uid = req.user.uid;
  const sid = req.body?.sessionId || req.query.sessionId || 'default';
  const key = sessionKey(uid, sid);
  const session = activeSessions[key];

  if (!session || !session.sock || session.status !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp is not connected' });
  }

  const store = getStore(key);
  const before = store.getUnresolvedLids().length;

  // Run in the background: a full lookup can take minutes with rate limiting.
  if (typeof session.resolveLids === 'function') {
    session.resolveLids().catch(err =>
      console.warn(`[Baileys - ${key}] Manual LID resolution failed:`, err.message)
    );
  }

  res.json({
    started: true,
    unresolvedLids: before,
    knownUnmappedNumbers: store.getUnmappedPhoneJids().length,
  });
});

// =============================================
// ADMIN API — every route requires an allow-listed admin (see adminMiddleware)
// =============================================

// Recursive directory size, used to surface how much disk the Baileys
// credential folders and chat stores are consuming.
function directorySize(dirPath) {
  let total = 0;
  let files = 0;
  try {
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nested = directorySize(full);
        total += nested.bytes;
        files += nested.files;
      } else {
        try {
          total += fs.statSync(full).size;
          files += 1;
        } catch {
          // File vanished between readdir and stat; ignore.
        }
      }
    }
  } catch (err) {
    console.warn(`[Admin] Could not measure ${dirPath}:`, err.message);
  }
  return { bytes: total, files };
}

// Describe one in-memory WhatsApp session for the admin console. The customer's
// email is deliberately not resolved here: the console already holds the user
// registry from Firestore and joins on uid, which avoids a REST read per session.
function describeSession(key, session) {
  let chatCount = 0;
  let messageCount = 0;
  let contactCount = 0;
  let unresolvedLids = 0;

  try {
    const store = getStore(key);
    chatCount = Object.keys(store.chats || {}).length;
    contactCount = Object.keys(store.contacts || {}).length;
    messageCount = Object.values(store.messages || {})
      .reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    unresolvedLids = typeof store.getUnresolvedLids === 'function'
      ? store.getUnresolvedLids().length
      : 0;
  } catch (err) {
    console.warn(`[Admin] Could not read store for ${key}:`, err.message);
  }

  return {
    key,
    uid: session.uid,
    sessionId: session.sessionId,
    status: session.status,
    // The connected WhatsApp account, when the socket has authenticated.
    waNumber: session.user?.id ? String(session.user.id).split(':')[0].split('@')[0] : null,
    waName: session.user?.name || session.user?.verifiedName || null,
    hasPendingQr: Boolean(session.qr),
    reconnectAttempts: session.reconnectAttempts || 0,
    connectedBrowsers: io.sockets.adapter.rooms.get(session.uid)?.size || 0,
    chatCount,
    messageCount,
    contactCount,
    unresolvedLids,
  };
}

// Every live WhatsApp session across all tenants.
app.get('/api/admin/sessions', authMiddleware, adminMiddleware, (req, res) => {
  const sessions = Object.entries(activeSessions).map(([key, session]) => describeSession(key, session));

  // Connected first, then by owner, so problem sessions surface at a glance.
  const statusRank = { connected: 0, connecting: 1, qr: 2, disconnected: 3 };
  sessions.sort((a, b) => {
    const rank = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (rank !== 0) return rank;
    return String(a.uid).localeCompare(String(b.uid));
  });

  res.json({
    sessions,
    summary: {
      total: sessions.length,
      connected: sessions.filter(s => s.status === 'connected').length,
      awaitingQr: sessions.filter(s => s.hasPendingQr).length,
      distinctUsers: new Set(sessions.map(s => s.uid)).size,
      onlineBrowsers: io.sockets.sockets.size,
    },
  });
});

// Force a customer's WhatsApp session to disconnect.
//
// Only sessions the server is already tracking can be targeted. That keeps the
// caller from influencing the filesystem path that logoutSession() deletes.
app.post('/api/admin/sessions/logout', authMiddleware, adminMiddleware, (req, res) => {
  const { uid, sessionId } = req.body || {};

  if (!uid || typeof uid !== 'string') {
    return res.status(400).json({ error: 'uid is required' });
  }

  const key = sessionKey(uid, sessionId);
  const session = activeSessions[key];
  if (!session) {
    return res.status(404).json({ error: 'No active session with that id' });
  }

  console.log(`[Admin] ${req.user.email} is force-disconnecting session ${key}`);
  logoutSession(session.uid, session.sessionId);

  res.json({ success: true, key });
});

// Server-side operational snapshot for the admin console.
app.get('/api/admin/overview', authMiddleware, adminMiddleware, (req, res) => {
  const sessionsDir = path.resolve('sessions');
  const disk = fs.existsSync(sessionsDir) ? directorySize(sessionsDir) : { bytes: 0, files: 0 };
  const memory = process.memoryUsage();
  const statuses = {};
  Object.values(activeSessions).forEach((s) => {
    statuses[s.status] = (statuses[s.status] || 0) + 1;
  });

  res.json({
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    baileysVersion: latestBaileysVersion.join('.'),
    sessions: {
      tracked: Object.keys(activeSessions).length,
      byStatus: statuses,
    },
    onlineBrowsers: io.sockets.sockets.size,
    storage: {
      path: sessionsDir,
      bytes: disk.bytes,
      files: disk.files,
    },
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    },
    config: {
      corsOrigin: allowedOrigins === '*' ? '*' : allowedOrigins,
      firebaseProjectId: FIREBASE_PROJECT_ID,
      adminEmailCount: ADMIN_EMAILS.length,
      mayarConfigured: Boolean(MAYAR_API_KEY || MAYAR_PAYMENT_LINK),
      mayarWebhookTokenSet: Boolean(MAYAR_WEBHOOK_TOKEN),
    },
  });
});

// Unauthenticated health check for the reverse proxy / uptime monitoring.
// Intentionally exposes no session or customer data.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    activeWhatsAppSessions: Object.values(activeSessions).filter(s => s.status === 'connected').length,
  });
});

// An unknown /api path must never fall through to the SPA catch-all below.
// Returning index.html for a mistyped or removed endpoint makes the client fail
// with "Unexpected token '<'" instead of a readable error, which matters more now
// that the frontend is served from this same origin.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown API endpoint: ${req.method} /api${req.path}` });
});

// Serve the frontend build. Present when the app is deployed as a single origin
// (frontend + API from this process); absent during local development, where
// Vite serves the frontend on port 3000 and proxies here.
const distPath = path.resolve('dist');
if (fs.existsSync(distPath)) {
  console.log(`[Config] Serving frontend build from ${distPath}`);

  app.use(express.static(distPath, {
    // Vite fingerprints asset filenames, so they can be cached indefinitely.
    // index.html must not be, or clients keep booting a stale bundle after a
    // deploy and never pick up the new asset hashes.
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  // Deep links (/dashboard, /login, ...) are served the SPA shell. This path
  // bypasses express.static, so the no-cache header has to be set again here or
  // a returning browser can boot a stale bundle that references deleted assets.
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  console.warn('[Config] No dist/ directory found — API only. Run `npm run build` to serve the frontend from this process.');
}

// Graceful shutdown so pm2/systemd restarts don't sever sockets abruptly.
const shutdown = (signal) => {
  console.log(`[Process] Received ${signal}, shutting down gracefully...`);
  httpServer.close(() => process.exit(0));
  // Force exit if connections refuse to close in time.
  setTimeout(() => process.exit(0), 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start Server
httpServer.listen(PORT, HOST, () => {
  console.log(`Multi-Tenant Server listening on http://${HOST}:${PORT}`);
  console.log(`[Config] Firebase project: ${FIREBASE_PROJECT_ID}`);
  console.log(`[Config] Sessions directory: ${path.resolve('sessions')}`);
  if (allowedOrigins === '*') {
    console.warn('[Config] CORS_ORIGIN is not set — allowing all origins. Set CORS_ORIGIN to your frontend URL in production.');
  } else {
    console.log(`[Config] CORS allowed origins: ${allowedOrigins.join(', ')}`);
  }
});
