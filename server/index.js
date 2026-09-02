import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import QRCode from 'qrcode';
import pino from 'pino';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { getStore } from './store.js';
import { buildConversationLog } from './conversationLog.js';

// Postgres replaces Firestore; local JWTs replace Firebase Auth.
import {
  runMigrations, verifyConnection, pruneRefreshTokens, closePool,
  query as dbQuery,
} from './db.js';
import { assertAuthConfigured, verifyAccessToken } from './auth.js';
import {
  resolveSessionLimitFor, consumeMessageQuota, saveTransaction,
  markTransactionStatus, findUserById, recordAudit, isChatHeld,
  findPlanById, updateUser, setPurchasedAgents, addPurchasedAgents,
  dispatchWorkspaceWebhook,
} from './data.js';
// Pricing arithmetic is shared with the browser so the customer is shown exactly
// the figure they will be charged. The server always recomputes it; the client's
// number is never trusted.
import {
  priceFor, invoiceLines, clampAgents, agentRange, isAddon, agentsGranted,
} from '../src/utils/pricing.js';
import {
  mayarConfig, reportMayarConfig, createInvoice, verifyWebhookToken, parseWebhookEvent,
} from './mayar.js';
import {
  authenticated, approved, admin, supervisor, supervisorFeature, clientIp,
} from './middleware.js';
import { sessionKey, userRoom } from './scope.js';
import { mountAuthRoutes } from './routes-auth.js';
import { mountDataRoutes } from './routes-data.js';
import { mountContactRoutes } from './routes-contacts.js';
import { mountTeamRoutes } from './routes-team.js';
import { mountDeveloperRoutes } from './routes-developer.js';
import { onUserConnected, onUserDisconnected, setUserPresence } from './presence.js';

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

// Authentication lives in server/auth.js (token signing and verification) and
// server/middleware.js (request guards). The Firebase ID token verifier and its
// Google public-key cache that used to sit here are gone: tokens are now issued
// and verified by this server, so there is no external key material to fetch.

// =============================================
// MULTI-SESSION SUPPORT
// =============================================
// activeSessions keyed by compositeKey = `${ownerId}_${sessionId}`
//
// `ownerId` throughout this file is the WORKSPACE owner's user id â€” not
// necessarily the id of the person who made the request. A supervisor and every
// team member they invited share one workspace, so they share these WhatsApp
// sessions, these stores, this socket room and this message quota.
//
// Routes get it from `req.workspaceId` (see loadProfile in middleware.js), which
// is `owner_user_id ?? id`. Using the caller's own id here instead would hand each
// invited member an empty parallel tenant with no paired device.
//
// The parameter is named `ownerId` rather than `uid` deliberately: it used to be
// called `uid` when one user was one tenant, and leaving that name would have made
// every call site read as though it were scoped to the caller.
//
// sessionKey() and userRoom() live in ./scope.js so the route files share one
// definition instead of rebuilding the key by hand.
const activeSessions = {};

// Debounced 'history-sync-complete' emitter.
// WhatsApp streams hundreds of contact/chat events during a sync; emitting on each
// one makes the client refetch in a tight loop (flickering). Coalesce bursts into
// at most one refresh signal per window.
const syncEmitTimers = {};
function emitSyncComplete(ownerId, sessionId) {
  const k = sessionKey(ownerId, sessionId);
  if (syncEmitTimers[k]) return; // already scheduled within the current window
  syncEmitTimers[k] = setTimeout(() => {
    delete syncEmitTimers[k];
    io.to(ownerId).emit('history-sync-complete', { sessionId });
  }, 700);
}

async function getOrInitWASocket(ownerId, sessionId = 'default') {
  const key = sessionKey(ownerId, sessionId);

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
    uid: ownerId,
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
          io.to(ownerId).emit('status-change', { sessionId, status: 'qr', qr: qrDataUrl });
        } catch (err) {
          console.error(`[Baileys - ${key}] Failed to generate QR:`, err);
        }
      }

      if (connection === 'connecting') {
        session.status = 'connecting';
        io.to(ownerId).emit('status-change', { sessionId, status: 'connecting' });
      }

      if (connection === 'open') {
        session.status = 'connected';
        session.qr = null;
        session.user = sock.user;
        session.reconnectAttempts = 0; // healthy connection resets backoff
        io.to(ownerId).emit('status-change', { sessionId, status: 'connected', user: sock.user });
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
        io.to(ownerId).emit('status-change', { sessionId, status: 'disconnected', reason: statusCode });

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
              getOrInitWASocket(ownerId, sessionId);
            }
          }, delay);
        } else {
          logoutSession(ownerId, sessionId);
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
          emitSyncComplete(ownerId, sessionId);
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
      emitSyncComplete(ownerId, sessionId);
    });

    sock.ev.on('chats.upsert', (newChats) => {
      const store = getStore(key);
      newChats.forEach(c => {
        store.addChat(c);
        if (c.id.endsWith('@g.us')) {
          fetchGroupMetadataIfNeeded(c.id, c.name);
        }
      });
      emitSyncComplete(ownerId, sessionId);
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
      emitSyncComplete(ownerId, sessionId);
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
      emitSyncComplete(ownerId, sessionId);
    });

    sock.ev.on('contacts.update', (updates) => {
      const store = getStore(key);
      updates.forEach(u => {
        if (u.id?.endsWith('@lid') || u.lid) {
          console.log(`[Baileys - ${key}] Contact update with LID:`, JSON.stringify({ id: u.id, name: u.name, notify: u.notify, verifiedName: u.verifiedName, lid: u.lid, phone: u.phone, number: u.number }));
        }
        store.addContact(u);
      });
      emitSyncComplete(ownerId, sessionId);
    });

    // Explicit LID <-> phone number mapping shared by WhatsApp
    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
      if (!lid || !jid) return;
      console.log(`[Baileys - ${key}] Phone number share: ${lid} -> ${jid}`);
      const store = getStore(key);
      store.addPhoneNumberShare(lid, jid);
      emitSyncComplete(ownerId, sessionId);
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
      emitSyncComplete(ownerId, sessionId);
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
          const isGroup = typeof jid === 'string' && jid.endsWith('@g.us');

          if (!msg.key.fromMe && msg.pushName) {
            if (isGroup) {
              // In a group, pushName belongs to the PARTICIPANT who spoke, not to
              // the group. Attributing it to the group jid renamed the whole
              // conversation to whoever last sent a message, and meant the
              // sender was never learned at all.
              //
              // participantAlt is the v7 name for what v6 called participantPn.
              const participant = msg.key.participant
                || msg.key.participantAlt
                || msg.key.participantPn;

              if (participant) {
                store.addContact({ id: participant, name: msg.pushName });
              }
            } else {
              store.addContact({ id: jid, name: msg.pushName });
            }
          }

          store.addMessage(jid, msg);
          io.to(ownerId).emit('new-message', { sessionId, jid, message: msg });

          // Dispatch customer developer webhook for incoming/outgoing messages
          dispatchWorkspaceWebhook(
            ownerId,
            msg.key.fromMe ? 'message.sent' : 'message.received',
            { sessionId, jid, message: msg }
          );
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

        io.to(ownerId).emit('message-update', { sessionId, ...update });
      }

      // Dispatch customer developer webhook for message status updates (delivery/read receipts)
      dispatchWorkspaceWebhook(ownerId, 'message.status', { sessionId, updates });
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
          emitSyncComplete(ownerId, sessionId);
        }
      });
    });

    return activeSessions[key];
  } catch (err) {
    console.error(`[Baileys - ${key}] Setup error:`, err);
    if (activeSessions[key]) {
      activeSessions[key].status = 'disconnected';
      io.to(ownerId).emit('status-change', { sessionId, status: 'disconnected', error: err.message });
    }
  }
}

function logoutSession(ownerId, sessionId = 'default') {
  const key = sessionKey(ownerId, sessionId);
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

  io.to(ownerId).emit('status-change', { sessionId, status: 'disconnected' });
  io.to(ownerId).emit('store-cleared', { sessionId });
}

// Firestore REST access, the plan cache and the admin allow-list that used to
// live here are gone. Profiles, plans and the effective device limit now come
// from Postgres via server/data.js, and the admin gate is server/middleware.js
// (requireAdmin), which reads the live row instead of trusting a token claim.

// Socket.io authentication. Verifies this server's own access token, then
// confirms the account still exists and is approved â€” a revoked customer must
// not keep a live socket just because their token has not expired yet.
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers['x-auth-token'];
  if (!token) {
    console.warn(`[Socket] Rejected: Missing auth token from socket ID ${socket.id}`);
    return next(new Error('Authentication error: Missing token'));
  }

  const decoded = verifyAccessToken(token);
  if (!decoded) {
    console.warn(`[Socket] Rejected: Invalid auth token from socket ID ${socket.id}`);
    return next(new Error('Authentication error: Invalid token'));
  }

  try {
    const profile = await findUserById(decoded.uid);
    if (!profile) {
      return next(new Error('Authentication error: Account no longer exists'));
    }
    if (profile.role !== 'admin' && !profile.isApproved) {
      console.warn(`[Socket] Rejected ${profile.email}: account not approved`);
      return next(new Error('Authentication error: Account pending approval'));
    }

    // An invited member works inside their supervisor's workspace, so the
    // supervisor's approval gates them too â€” suspending an account has to take its
    // whole team offline, not just the owner. Mirrors requireApproved.
    if (profile.ownerUserId) {
      const owner = await findUserById(profile.ownerUserId);
      if (!owner) {
        return next(new Error('Authentication error: The account that invited you no longer exists'));
      }
      if (owner.role !== 'admin' && !owner.isApproved) {
        console.warn(`[Socket] Rejected ${profile.email}: workspace owner ${owner.email} is not approved`);
        return next(new Error('Authentication error: Account pending approval'));
      }
    }

    socket.user = decoded;
    socket.profile = profile;
    // Which workspace's events this socket should receive. Same value as
    // req.workspaceId on the HTTP side.
    socket.workspaceId = profile.workspaceId;
    socket.token = token;
    next();
  } catch (err) {
    console.error('[Socket] Profile lookup failed during handshake:', err.message);
    next(new Error('Authentication error: Service unavailable'));
  }
});

// Every socket joins two rooms:
//
//   workspaceId   shared with the whole team. WhatsApp status, new messages, quota
//                 changes, hold changes, contact changes â€” anything about the
//                 account rather than the person.
//   user:<uid>    just this person's tabs. Their own profile row, which must not
//                 be broadcast to colleagues. See userRoom() in ./scope.js.

// Distinct PEOPLE currently connected to a workspace, and whether a given person
// is already among them.
//
// This replaced a plain room-size check. Counting sockets conflated "how many
// colleagues are working" with "how many browser tabs are open", so an operator
// with the dashboard open twice consumed two agent slots and a three-person team
// could lock itself out by opening a second tab each. Now a seat is a person: any
// number of tabs from the same account is one seat.
function workspaceOccupants(workspaceId) {
  const room = io.sockets.adapter.rooms.get(workspaceId);
  const people = new Set();
  if (!room) return people;

  for (const socketId of room) {
    const existing = io.sockets.sockets.get(socketId);
    if (existing?.user?.uid) people.add(existing.user.uid);
  }
  return people;
}

io.on('connection', async (socket) => {
  const memberId = socket.user.uid;
  const workspaceId = socket.workspaceId;

  // Agent slots for the WORKSPACE: the supervisor's override, else what they
  // purchased, else what their plan includes. A member has no plan of their own.
  const seatLimit = await resolveSessionLimitFor(workspaceId);

  const occupants = workspaceOccupants(workspaceId);

  // Reconnecting, or opening another tab, costs nothing â€” they already hold a seat.
  if (!occupants.has(memberId) && occupants.size >= seatLimit) {
    console.warn(
      `[Socket] Rejected ${socket.profile.email} (${socket.id}): workspace ${workspaceId} ` +
      `already has ${occupants.size}/${seatLimit} agent${seatLimit > 1 ? 's' : ''} online.`
    );
    socket.emit('session-blocked', {
      message: seatLimit === 1
        ? 'This account allows one agent online at a time, and someone is already signed in.'
        : `All ${seatLimit} agent slots on this account are in use. Ask your supervisor to add another, or wait for a colleague to sign out.`,
      seatLimit,
      inUse: occupants.size,
    });
    socket.disconnect(true);
    return;
  }

  socket.join(workspaceId);
  socket.join(userRoom(memberId));
  console.log(
    `[Socket] ${socket.profile.email} joined workspace ${workspaceId} ` +
    `(${occupants.size + (occupants.has(memberId) ? 0 : 1)}/${seatLimit} agents online)`
  );

  // Agents online, not tabs open, for the same reason as the gate above.
  const announceOccupancy = () => {
    const people = workspaceOccupants(workspaceId);
    io.to(workspaceId).emit('session-count-update', { count: people.size, limit: seatLimit });
  };
  announceOccupancy();

  // Track user presence in workspace
  onUserConnected(workspaceId, memberId, socket.id, io);

  // Send all existing WA session statuses to the newly connected browser tab
  const userSessions = Object.entries(activeSessions)
    .filter(([k, v]) => v.uid === workspaceId)
    .map(([k, v]) => ({
      sessionId: v.sessionId,
      status: v.status,
      qr: v.qr,
      user: v.user,
    }));
  socket.emit('all-sessions', userSessions);

  // Listen for client requesting to change their presence status (online / away / off)
  socket.on('set-presence', async (data) => {
    const status = data?.status;
    if (['online', 'away', 'off'].includes(status)) {
      await setUserPresence(workspaceId, memberId, status, io);
    }
  });

  // Listen for client requesting to init a specific WA session
  socket.on('init-session', (data) => {
    const sid = data?.sessionId || 'default';
    console.log(`[Socket] ${socket.profile.email} requested init-session: ${workspaceId}/${sid}`);
    getOrInitWASocket(workspaceId, sid);
  });

  // Unpairing the device is supervisor-only. It deletes the credentials and wipes
  // the store for EVERYONE in the workspace, so a single member should not be able
  // to cut their colleagues off and force a re-scan.
  socket.on('logout-session', (data) => {
    if (socket.profile.ownerUserId) {
      console.warn(`[Socket] Refused logout-session from member ${socket.profile.email}.`);
      socket.emit('action-denied', {
        action: 'logout-session',
        message: 'Only the account owner can disconnect the WhatsApp number.',
      });
      return;
    }
    const sid = data?.sessionId || 'default';
    console.log(`[Socket] ${socket.profile.email} requested logout-session: ${workspaceId}/${sid}`);
    logoutSession(workspaceId, sid);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] ${socket.profile.email} left workspace ${workspaceId}`);
    onUserDisconnected(workspaceId, memberId, socket.id, io);
    // Runs after the socket has left the room, so the recount reflects reality.
    announceOccupancy();
  });
});

// Lazy-load group metadata helper to sync group subjects
async function fetchGroupMetadata(ownerId, sessionId, jid) {
  const key = sessionKey(ownerId, sessionId);
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
        emitSyncComplete(ownerId, sessionId);
      }
    }
  } catch (err) {
    console.warn(`[Baileys - ${key}] Failed to lazy-load group metadata for ${jid}:`, err.message);
  }
}

// =============================================
// REST API â€” all endpoints accept ?sessionId= query param
// =============================================

// Get all WA sessions for the user
app.get('/api/sessions', approved, (req, res) => {
  const ownerId = req.workspaceId;
  const userSessionEntries = Object.entries(activeSessions)
    .filter(([k, v]) => v.uid === ownerId)
    .map(([k, v]) => ({
      sessionId: v.sessionId,
      status: v.status,
      qr: v.qr,
      user: v.user,
    }));
  res.json(userSessionEntries);
});

app.get('/api/status', approved, (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.query.sessionId || 'default';
  const key = sessionKey(ownerId, sid);
  const session = activeSessions[key] || { status: 'disconnected', qr: null, user: null };
  // Trigger socket init if it hasn't been booted yet
  getOrInitWASocket(ownerId, sid);
  res.json({
    sessionId: sid,
    status: session.status,
    qr: session.qr,
    user: session.user
  });
});

app.get('/api/chats', approved, (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.query.sessionId || 'default';
  const key = sessionKey(ownerId, sid);
  const store = getStore(key);
  const sortedChats = Object.values(store.chats).sort((a, b) => {
    return (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0);
  });
  res.json(sortedChats);
});

// Fetch group metadata (participants, description, admin roles)
app.get('/api/group-metadata', approved, async (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.query.sessionId || 'default';
  const jid = req.query.jid;

  if (!jid || !jid.endsWith('@g.us')) {
    return res.status(400).json({ error: 'Valid group JID required' });
  }

  const key = sessionKey(ownerId, sid);
  const session = activeSessions[key];
  if (!session || !session.sock) {
    return res.status(503).json({ error: 'WhatsApp session not connected' });
  }

  try {
    const metadata = await session.sock.groupMetadata(jid);
    if (!metadata) {
      return res.status(404).json({ error: 'Group metadata not found' });
    }

    res.json({
      id: metadata.id,
      subject: metadata.subject || '',
      creation: metadata.creation || null,
      owner: metadata.owner || '',
      desc: metadata.desc ? metadata.desc.toString() : '',
      descOwner: metadata.descOwner || null,
      descTime: metadata.descTime || null,
      restrict: !!metadata.restrict,
      announce: !!metadata.announce,
      size: metadata.size || (metadata.participants ? metadata.participants.length : 0),
      participants: (metadata.participants || []).map(p => ({
        id: p.id,
        admin: p.admin || null,
      }))
    });
  } catch (err) {
    console.error(`[GroupMetadata] Error fetching group metadata for ${jid}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch group metadata', message: err.message });
  }
});

// When conversations actually happen, as a 7x24 (weekday x hour) grid.
//
// Aggregated here rather than in the browser because the raw material is every
// stored message across every chat â€” on a busy account that is tens of thousands
// of objects the client has no other reason to hold. What comes back is 336
// integers.
//
// Bucketing needs the VIEWER's clock, not the server's: this box runs UTC, so
// bucketing by its own local time would report a WIB operator's 14:00 rush as
// 07:00. The client sends its Date#getTimezoneOffset() and the shift is applied
// to the epoch before the day and hour are read back out in UTC, which also
// handles the half-hour zones a whole-hour rotation would get wrong.
// Optional `from` / `to` narrow the window, as epoch milliseconds.
//
// Milliseconds rather than dates on purpose: a date needs a timezone to mean an
// instant, and the browser is the only party that knows the viewer's. It already
// sends tzOffset for bucketing, so it also converts its own date pickers to
// absolute instants and the server just compares numbers. Accepting 'YYYY-MM-DD'
// here would silently mean UTC midnight and shift a WIB operator's day by 7 hours.
app.get('/api/stats/activity', approved, (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.query.sessionId || 'default';
  const store = getStore(sessionKey(ownerId, sid));

  // Same sign convention as the browser: minutes to ADD to local time to reach
  // UTC, so UTC+7 sends -420. Clamped to the real range of world offsets.
  const rawOffset = Number(req.query.tzOffset);
  const tzOffset = Number.isFinite(rawOffset) ? Math.max(-900, Math.min(900, rawOffset)) : 0;

  const bound = (raw) => {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  let fromMs = bound(req.query.from);
  let toMs = bound(req.query.to);
  // Tolerate a reversed range rather than returning an empty grid for it.
  if (fromMs !== null && toMs !== null && fromMs > toMs) [fromMs, toMs] = [toMs, fromMs];

  const blank = () => Array.from({ length: 7 }, () => new Array(24).fill(0));
  const incoming = blank();
  const outgoing = blank();

  let total = 0;
  let earliest = null;
  let latest = null;

  // Bounds across EVERYTHING stored, computed even when a filter is applied. The
  // picker needs them to constrain its inputs and to make "all time" meaningful,
  // and they cost nothing here because the scan happens either way.
  let availableFrom = null;
  let availableTo = null;

  for (const messages of Object.values(store.messages)) {
    for (const message of messages) {
      // messageTimestamp is in seconds, and history sync has been seen to deliver
      // nulls and Long objects, so anything that is not a sane epoch is skipped
      // rather than landing in the Thursday-1970 cell.
      const seconds = Number(message?.messageTimestamp);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;

      const ms = seconds * 1000;
      if (ms > Date.now() + 86400000) continue; // clock-skewed junk

      if (availableFrom === null || ms < availableFrom) availableFrom = ms;
      if (availableTo === null || ms > availableTo) availableTo = ms;

      if (fromMs !== null && ms < fromMs) continue;
      if (toMs !== null && ms > toMs) continue;

      const shifted = new Date(ms - tzOffset * 60000);
      const day = shifted.getUTCDay();
      const hour = shifted.getUTCHours();

      if (message.key?.fromMe) outgoing[day][hour]++;
      else incoming[day][hour]++;

      total++;
      if (earliest === null || ms < earliest) earliest = ms;
      if (latest === null || ms > latest) latest = ms;
    }
  }

  res.json({
    incoming,
    outgoing,
    total,
    // The window the returned numbers actually cover â€” the first and last message
    // counted, not the requested bounds, so an empty stretch at either end of a
    // custom range is not claimed as data.
    from: earliest,
    to: latest,
    // Everything on disk. The store keeps only the last 100 messages per chat, so
    // this is not "all time" and the UI should not imply it is.
    availableFrom,
    availableTo,
    // Echoed so the client can tell a filtered response from an unfiltered one.
    requestedFrom: fromMs,
    requestedTo: toMs,
    chatsCounted: Object.keys(store.messages).length,
  });
});

// Who produced the interactions in ONE cell of the heatmap.
//
// The grid endpoint above returns counts, which answers "when are we busy" but not "who
// was that" â€” and a count with no way to reach the conversations behind it is a dead end.
// This returns the chats that contributed to a single (weekday, hour) bucket, so clicking
// a cell can filter the customer list beside it.
//
// A separate request rather than shipping contributors with the grid: 168 cells x every
// chat that has ever spoken in them is orders of magnitude more data than the 336 integers
// the grid costs, and all but one cell of it would be discarded.
//
// Every filter the grid applied has to be applied identically here, or the drill-down
// disagrees with the number the operator just clicked. That means tzOffset, the from/to
// range, and the incoming/outgoing view.
app.get('/api/stats/activity/contributors', approved, (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.query.sessionId || 'default';
  const store = getStore(sessionKey(ownerId, sid));

  const day = Number(req.query.day);
  const hour = Number(req.query.hour);
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    return res.status(400).json({ error: 'day must be an integer from 0 (Sunday) to 6.' });
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return res.status(400).json({ error: 'hour must be an integer from 0 to 23.' });
  }

  const rawOffset = Number(req.query.tzOffset);
  const tzOffset = Number.isFinite(rawOffset) ? Math.max(-900, Math.min(900, rawOffset)) : 0;

  const bound = (raw) => {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  };
  let fromMs = bound(req.query.from);
  let toMs = bound(req.query.to);
  if (fromMs !== null && toMs !== null && fromMs > toMs) [fromMs, toMs] = [toMs, fromMs];

  // 'all' | 'incoming' | 'outgoing', matching the panel's toggle.
  const view = ['incoming', 'outgoing'].includes(req.query.view) ? req.query.view : 'all';

  const byChat = new Map();
  let total = 0;
  let groupTotal = 0;

  for (const [jid, messages] of Object.entries(store.messages)) {
    for (const message of messages) {
      const seconds = Number(message?.messageTimestamp);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;

      const ms = seconds * 1000;
      if (ms > Date.now() + 86400000) continue;
      if (fromMs !== null && ms < fromMs) continue;
      if (toMs !== null && ms > toMs) continue;

      const shifted = new Date(ms - tzOffset * 60000);
      if (shifted.getUTCDay() !== day || shifted.getUTCHours() !== hour) continue;

      const fromMe = Boolean(message.key?.fromMe);
      if (view === 'incoming' && fromMe) continue;
      if (view === 'outgoing' && !fromMe) continue;

      const entry = byChat.get(jid) || { chatJid: jid, count: 0, incoming: 0, outgoing: 0 };
      entry.count++;
      if (fromMe) entry.outgoing++;
      else entry.incoming++;
      byChat.set(jid, entry);

      total++;
      // Reported separately so the UI can explain a shortfall: the customer list excludes
      // groups, so a cell whose interactions were partly group traffic would otherwise
      // look like it had lost rows.
      if (jid.endsWith('@g.us')) groupTotal++;
    }
  }

  const contributors = [...byChat.values()].sort((a, b) => b.count - a.count);

  res.json({
    day,
    hour,
    view,
    total,
    groupTotal,
    // Distinct conversations, which is what the customer list will show a subset of.
    chatCount: contributors.length,
    contributors,
  });
});

// Conversation log: one row per customer conversation for the whole team.
//
// The aggregation itself lives in ./conversationLog.js as a pure function, so it can be
// checked against a real store snapshot without a server, a database or a WhatsApp
// session. This handler only resolves WHOSE store to read.
//
// Supervisor-only: it is oversight of the whole team, not something an invited agent
// needs. The `supervisor` chain also loads req.workspaceId, same as `approved`.
app.get('/api/stats/conversation-log', supervisorFeature('activity'), (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.query.sessionId || 'default';
  const store = getStore(sessionKey(ownerId, sid));

  res.json(buildConversationLog({ messages: store.messages, chats: store.chats }));
});

app.get('/api/chats/:jid/messages', approved, (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.query.sessionId || 'default';
  const key = sessionKey(ownerId, sid);
  const store = getStore(key);
  const jid = req.params.jid;

  // Trigger lazy metadata sync in the background if group chat
  if (jid.endsWith('@g.us')) {
    fetchGroupMetadata(ownerId, sid, jid);
  }

  res.json(store.messages[jid] || []);
});

app.post('/api/messages/send', approved, async (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.body.sessionId || req.query.sessionId || 'default';
  const key = sessionKey(ownerId, sid);
  // `quotedId` is the id of a message in THIS chat to reply to; `forwardFrom` is
  // { jid, id } locating a message in any chat to forward here. Both are optional and
  // both need the original raw message, which only the store has.
  const { to, text, file, quotedId, forwardFrom } = req.body;
  const session = activeSessions[key];

  if (!to) {
    return res.status(400).json({ error: 'Missing to (recipient JID)' });
  }

  // Agent hold.
  //
  // A conversation can be put "on hold" so automated replies stop while a human
  // takes over. Only automated senders are blocked â€” a person typing in the
  // dashboard is exactly who the hold exists to make room for.
  //
  // A request is treated as automated when it says so, via either
  // `X-Agent-Source: bot` or `"source": "bot"` in the body. That is cooperative
  // rather than airtight: any caller could omit it. Making it airtight needs the
  // bot to authenticate as itself (an API key) instead of borrowing a user's
  // token, which does not exist yet. The check lives here so that when keys land,
  // the key can imply the source and nothing else has to move.
  const declaredSource = String(
    req.headers['x-agent-source'] || req.body?.source || 'human'
  ).toLowerCase();
  const isAutomated = declaredSource === 'bot' || declaredSource === 'agent';

  if (isAutomated) {
    // Resolve the JID the same way the send path does, so the hold matches the
    // conversation the operator actually paused.
    let holdJid = to;
    if (!holdJid.endsWith('@s.whatsapp.net') && !holdJid.endsWith('@g.us') && !holdJid.endsWith('@lid')) {
      holdJid = `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    }

    // Expand to every equivalent form before checking.
    //
    // A hold is written under one canonical JID (preferring @lid), but a bot
    // usually addresses the conversation by phone JID. Passing the single
    // resolved JID matched only that exact value, so a chat held by the dashboard
    // under its @lid form did not block a reply sent to 628...@s.whatsapp.net â€”
    // enforcement silently disagreed with what the UI showed as held.
    const holdJids = getStore(key).expandHoldJids(holdJid);

    if (await isChatHeld(ownerId, sid, holdJids)) {
      console.log(`[Hold] Suppressed an automated reply to ${holdJid} (${key}) â€” chat is on hold.`);
      return res.status(409).json({
        error: 'This conversation is on hold. A human agent has taken over, so automated replies are suppressed.',
        code: 'chat_on_hold',
        chatJid: holdJid,
      });
    }
  }

  // WhatsApp connectivity is checked after the hold, so a held conversation
  // reports as held whether or not a device happens to be connected, and before
  // the quota, so a message that cannot physically be sent never consumes quota.
  if (!session || !session.sock) {
    return res.status(503).json({
      error: 'WhatsApp is not connected for this session. Scan the QR code first.',
      code: 'wa_not_initialized',
      sessionId: sid,
    });
  }
  if (session.status !== 'connected') {
    return res.status(503).json({
      error: `WhatsApp session is "${session.status}", not connected.`,
      code: 'wa_not_connected',
      sessionId: sid,
      status: session.status,
    });
  }

  // Reply and forward sources are resolved BEFORE the quota is consumed, so a request
  // that cannot be fulfilled never spends a message the operator did not send.
  const store = getStore(key);

  let forwardSource = null;
  if (forwardFrom && forwardFrom.id) {
    forwardSource = store.findMessage(forwardFrom.jid || to, forwardFrom.id);
    if (!forwardSource) {
      // Hard failure: forwarding is the entire request, so there is nothing to fall
      // back to. Only the last 100 messages per chat are retained.
      return res.status(404).json({
        error: 'The message you are forwarding is no longer available to forward.',
        code: 'forward_source_missing',
      });
    }
  }

  // A missing quote is NOT fatal: the reply still carries the operator's text, and
  // dropping the thread marker is far better than refusing to send it.
  const quotedSource = quotedId ? store.findMessage(to, quotedId) : null;
  if (quotedId && !quotedSource) {
    console.log(`[Send - ${key}] Quoted message ${quotedId} not in store; sending without the quote.`);
  }

  // Quota is enforced here, atomically, before the message goes out.
  //
  // Previously the limit was checked in the browser and the browser incremented
  // its own counter, which made it advisory: a modified client, or two tabs
  // racing, could exceed it freely. consumeMessageQuota does the check and the
  // increment in one UPDATE, so neither is possible. Admins are exempt.
  const quota = await consumeMessageQuota(ownerId);
  if (!quota.allowed) {
    return res.status(429).json({
      error: 'Message quota reached. Upgrade the plan or raise the limit to send more.',
      code: 'quota_exceeded',
      messagesSent: quota.messagesSent,
      limit: quota.limit,
    });
  }

  // Tell the user's other tabs about the new count so the UI stays in step.
  io.to(ownerId).emit('quota-updated', { messagesSent: quota.messagesSent, limit: quota.limit });

  try {
    let jid = to;
    if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us') && !jid.endsWith('@lid')) {
      const cleanNum = to.replace(/\D/g, '');
      jid = `${cleanNum}@s.whatsapp.net`;
    }

    // Applied to every branch below, so replying with an attachment still threads.
    // Baileys ignores an empty options object, so this is safe when not replying.
    const sendOptions = quotedSource ? { quoted: quotedSource } : {};

    let response;
    if (forwardSource) {
      // Baileys rebuilds the original message and tags it as forwarded. Passing the raw
      // message is what makes media forward without re-uploading it.
      response = await session.sock.sendMessage(jid, { forward: forwardSource });
    } else if (file && file.base64) {
      const mimeType = file.type;
      const base64Data = file.base64.split(';base64,').pop();
      const buffer = Buffer.from(base64Data, 'base64');

      if (mimeType.startsWith('image/')) {
        response = await session.sock.sendMessage(jid, { image: buffer, caption: text }, sendOptions);
      } else if (mimeType.startsWith('video/')) {
        response = await session.sock.sendMessage(jid, { video: buffer, caption: text }, sendOptions);
      } else if (mimeType.startsWith('audio/')) {
        response = await session.sock.sendMessage(jid, { audio: buffer, mimetype: mimeType }, sendOptions);
      } else {
        response = await session.sock.sendMessage(jid, { 
          document: buffer, 
          mimetype: mimeType, 
          fileName: file.name 
        }, sendOptions);
      }
    } else {
      if (!text) {
        return res.status(400).json({ error: 'Missing text or file content' });
      }
      response = await session.sock.sendMessage(jid, { text }, sendOptions);
    }
    
    // Attribute the message to the human who sent it from the dashboard.
    //
    // The point of this is team accounts: several agents share one WhatsApp number,
    // and a badge under the bubble is the only way to tell who typed what. Only human
    // dashboard sends are stamped â€” an automated/bot send is not "someone on the team",
    // and an incoming message is the customer, so neither carries a name.
    //
    // pushName is deliberately NOT used: on our own outgoing messages WhatsApp fills it
    // with the business name, so it cannot identify the operator.
    if (!isAutomated) {
      const agentName = req.profile.name
        || (req.profile.email ? req.profile.email.split('@')[0] : null);
      if (agentName) {
        response.agentName = agentName;
        // The stable grouping key for the activity view. A name can be shared by two
        // people or edited later; the uid cannot, so tracking keys on it and only
        // shows the name.
        response.agentUid = req.profile.uid;
      }
    }

    // Cache the message
    store.addMessage(jid, response);
    io.to(ownerId).emit('new-message', { sessionId: sid, jid, message: response });

    res.json({ success: true, message: response });
  } catch (err) {
    console.error(`[Baileys - ${key}] Failed to send message:`, err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/media/download', approved, async (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.body.sessionId || req.query.sessionId || 'default';
  const key = sessionKey(ownerId, sid);
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

app.post('/api/sync', approved, async (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.body.sessionId || req.query.sessionId || 'default';
  const key = sessionKey(ownerId, sid);
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
    io.to(ownerId).emit('status-change', { sessionId: sid, status: 'connecting' });

    // Initialize socket connection again
    getOrInitWASocket(ownerId, sid);

    res.json({ success: true, message: 'Sync started successfully' });
  } catch (err) {
    console.error(`[Baileys - ${key}] Failed to sync history:`, err);
    res.status(500).json({ error: err.message });
  }
});

// Unpair the WhatsApp device. Supervisor-only: it deletes the credentials and
// clears the store for the whole workspace, so one member must not be able to cut
// their colleagues off and force a fresh QR scan. Same reasoning as the
// 'logout-session' socket handler.
app.post('/api/logout', supervisor, (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.body.sessionId || req.query.sessionId || 'default';
  try {
    logoutSession(ownerId, sid);
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

// Mayar credentials and the API client live in server/mayar.js, which reads them
// from the environment and never logs them.

// Transactions Store Helper (File-backed fallback)
// Transactions used to live in sessions/transactions.json, which meant they were
// invisible to the admin console and lost if the file was cleaned up. They are
// now rows in Postgres â€” see saveTransaction in server/data.js. GET
// /api/transactions and /api/admin/transactions are served from routes-data.js.

// Authentication (register / login / refresh / logout / me) and all the
// profile, plan, user-admin, transaction and audit endpoints that replaced
// Firestore. Mounted before the /api 404 guard at the bottom of this file.
mountAuthRoutes(app);
mountDataRoutes(app, io);

// The operator's saved address book. Separate from routes-data.js because it is
// the customer's own data rather than account administration, and it reaches into
// the WhatsApp store to resolve each contact to a conversation.
mountContactRoutes(app, io);

// Who else may sign in to this account. Supervisor-facing, and much narrower than
// the admin console: invite, rename, resend, remove — never a plan, quota or role.
mountTeamRoutes(app, io);

// Developer API keys and Webhooks endpoints.
mountDeveloperRoutes(app, io);

// Reports whether the payment gateway is configured. Unauthenticated by design:
// it exposes booleans only, never the key itself.
// Reports whether the payment gateway is configured. Unauthenticated by design:
// it exposes booleans only, never the key itself.
app.get('/api/mayar/config', (req, res) => {
  res.json({
    configured: mayarConfig.isConfigured,
    hasWebhookToken: mayarConfig.hasWebhookToken,
    sandbox: mayarConfig.isSandbox,
  });
});

// Start a checkout for a plan.
//
// The client sends only a planId. The price, name and description are read from
// the plans table server-side.
//
// This previously accepted `amount` from the request body, which meant a user
// could buy Premium for 1 rupiah by editing the payload. Prices must never be
// client-supplied.
//
// Supervisor-only. The plan and the agent slots belong to the workspace, so an
// invited member must not be able to change what the account is paying for. The
// transaction is recorded against the workspace id, which is what the webhook then
// fulfils against.
app.post('/api/mayar/create-checkout', supervisor, async (req, res) => {
  const uid = req.workspaceId;
  const userEmail = req.profile.email;

  try {
    const planId = String(req.body?.planId || '').trim().toLowerCase();
    if (!planId) {
      return res.status(400).json({ error: 'planId is required' });
    }

    const plan = await findPlanById(planId);
    if (!plan) {
      return res.status(404).json({ error: `Plan "${planId}" does not exist.` });
    }
    if (plan.archived) {
      return res.status(400).json({ error: `Plan "${plan.name}" is no longer available.` });
    }
    // Units being bought. For a plan that is an absolute agent count; for an add-on
    // it is a quantity, and the range floor differs accordingly (see agentRange).
    // Clamped and then priced here â€” the client's arithmetic is never trusted, only
    // its choice of quantity.
    const range = agentRange(plan);
    const requestedAgents = req.body?.agents;
    const agents = clampAgents(plan, requestedAgents ?? range.min);
    const addon = isAddon(plan);

    if (requestedAgents !== undefined && Number(requestedAgents) !== agents) {
      const unit = addon ? 'unit' : 'agent';
      return res.status(400).json({
        error: range.max === null
          ? `This plan needs at least ${range.min} ${unit}s.`
          : `You can buy between ${range.min} and ${range.max} ${unit}${range.max === 1 ? '' : 's'} at a time.`,
        code: 'agents_out_of_range',
        min: range.min,
        max: range.max,
      });
    }

    const pricing = priceFor(plan, agents);

    if (pricing.total <= 0) {
      return res.status(400).json({
        error: `"${plan.name}" is free â€” there is nothing to pay for.`,
        code: 'plan_is_free',
      });
    }

    // An add-on is repeatable by design: buying a second one is the point, and there
    // is no "already on it" state because it never becomes the customer's plan. Only
    // plans get the no-op guard.
    if (!addon) {
      // Same plan AND same agent count is a no-op; buying more agents on the plan
      // you are already on is a legitimate upgrade.
      const currentAgents = req.profile.purchasedAgents ?? plan.includedAgents;
      if (req.profile.planId === planId && currentAgents === agents) {
        return res.status(409).json({
          error: `You are already on the ${plan.name} plan with ${agents} ${agents === 1 ? 'agent' : 'agents'}.`,
          code: 'already_on_plan',
        });
      }
    }

    if (!mayarConfig.isConfigured) {
      return res.status(503).json({
        error: 'Payments are not configured on this server. Set MAYAR_API_KEY.',
        code: 'mayar_not_configured',
      });
    }

    const transactionId = `WA-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const grantedAgents = agentsGranted(plan, agents);
    const description = addon
      ? `${plan.name} x${agents} (+${grantedAgents} ${grantedAgents === 1 ? 'agent' : 'agents'})`
      : pricing.extraAgents > 0
        ? `${plan.name} plan, ${agents} agents (${pricing.includedAgents} included + ${pricing.extraAgents} extra)`
        : `${plan.name} plan, ${agents} ${agents === 1 ? 'agent' : 'agents'}`;

    // The transaction row is written AFTER Mayar accepts, not before.
    //
    // It used to be written first, on the reasoning that a customer who pays must
    // never be left without a local record. But the gateway call is the step that
    // actually fails, so every failed attempt left a PENDING row the customer could
    // see in their history â€” a payment they never started and cannot complete.
    //
    // The durability that ordering was protecting is now provided by the webhook,
    // which creates the row if it is missing (see the fulfilment path below). The id
    // is generated here and travels in extraData, so the webhook can reconstruct the
    // record even if this process dies between Mayar accepting and the insert.
    let paymentUrl = '';
    let mayarRef = null;

    if (mayarConfig.hasApiKey) {
      const invoice = await createInvoice({
        name: req.profile.name || (userEmail ? userEmail.split('@')[0] : 'Customer'),
        email: userEmail,
        mobile: req.body?.mobile,
        description,
        // One invoice, two lines: base plus add-on agents. Mayar sums them, so the
        // customer pays 1_300_000 once while the breakdown stays visible.
        items: invoiceLines(plan, agents),
        // Round-tripped by Mayar and read back in the webhook, which is what
        // makes automatic fulfilment safe: we no longer have to guess which plan
        // a payment was for.
        extraData: { localTransactionId: transactionId, uid, planId, agents: String(agents) },
      });

      paymentUrl = invoice.link;
      mayarRef = invoice.mayarTransactionId || invoice.invoiceId;
    } else {
      // Static payment link fallback. Fulfilment cannot be automatic here,
      // because a static link carries no extraData back to us.
      const sep = mayarConfig.paymentLink.includes('?') ? '&' : '?';
      paymentUrl = `${mayarConfig.paymentLink}${sep}email=${encodeURIComponent(userEmail || '')}&ref=${transactionId}`;
    }

    await saveTransaction({
      transactionId,
      uid,
      email: userEmail || '',
      item: description,
      type: planId,
      amount: pricing.total,
      currency: plan.currency || 'IDR',
      status: 'PENDING',
      paymentUrl,
      planId,
      agents,
      raw: mayarRef ? { mayarRef } : null,
    });

    await recordAudit({
      actorUserId: uid,
      actorEmail: userEmail,
      action: 'payment.checkout_created',
      targetUserId: uid,
      detail: { transactionId, planId, agents, amount: pricing.total, mayarRef },
      ip: clientIp(req),
    });

    res.json({
      success: true,
      transactionId,
      paymentUrl,
      amount: pricing.total,
      currency: plan.currency || 'IDR',
      planId,
      agents,
      pricing,
      description,
    });
  } catch (err) {
    // Nothing was written before the gateway call, so a failure leaves no
    // transaction behind to confuse the customer.
    console.error(`[Mayar Checkout] Failed for ${userEmail} (${err.code || 'unknown'}):`, err.message);

    const status = err.code === 'mayar_not_configured' ? 503
      : err.code === 'mayar_auth_failed' ? 503
      : err.code === 'mayar_endpoint_missing' ? 503
      : err.code === 'mayar_duplicate' ? 429
      : err.code === 'mayar_rejected' ? 502
      : err.code === 'mayar_unreachable' ? 504
      : err.code === 'invalid_amount' ? 400
      : err.code === 'mayar_no_link' ? 502
      : 500;

    // Say what actually went wrong. "Please try again" hid a misconfigured API key
    // behind a message that suggested the problem was transient, which meant the
    // real cause only existed in the server log.
    const message = {
      mayar_rejected: `The payment provider rejected this request: ${err.message}`,
      mayar_auth_failed: 'Payments are misconfigured on this server: the payment gateway refused our API key. Nothing was charged. This needs an administrator, not a retry.',
      mayar_endpoint_missing: `Payments are misconfigured on this server: ${err.message} Nothing was charged. This needs an administrator, not a retry.`,
      mayar_duplicate: 'You just started a checkout for this. Wait a minute before trying again, or use the payment link from the last attempt.',
      mayar_unreachable: 'The payment provider did not respond. Check the server\'s internet access and try again.',
      mayar_no_link: 'The payment provider accepted the invoice but returned no checkout link.',
      invalid_amount: err.message,
      mayar_not_configured: 'Payments are not configured on this server yet.',
    }[err.code] || `Could not start the payment: ${err.message}`;

    res.status(status).json({ error: message, code: err.code || 'checkout_failed' });
  }
});

// Mayar webhook receiver.
//
// Fails closed: without MAYAR_WEBHOOK_TOKEN set, every call is rejected. The
// previous version skipped verification entirely when the token was unset, which
// left an unauthenticated endpoint able to trigger fulfilment.
app.post('/api/webhooks/mayar', async (req, res) => {
  const presented = req.headers['x-mayar-token']
    || req.headers['authorization']
    || req.query.token
    || '';

  if (!mayarConfig.hasWebhookToken) {
    console.error('[Mayar Webhook] Rejected: MAYAR_WEBHOOK_TOKEN is not set on this server.');
    return res.status(503).json({ error: 'Webhook is not configured' });
  }

  if (!(await verifyWebhookToken(presented))) {
    console.warn(`[Mayar Webhook] Rejected a call with an invalid token from ${clientIp(req)}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = parseWebhookEvent(req.body || {});
  console.log(`[Mayar Webhook] ${event.status} tx=${event.mayarTransactionId || 'n/a'} local=${event.localTransactionId || 'n/a'}`);

  try {
    if (!event.isPaid) {
      // Acknowledge non-payment events so Mayar stops retrying them.
      return res.json({ success: true, ignored: event.status });
    }

    let appliedPlan = null;
    let appliedAgents = null;

    let localTx = null;
    if (event.localTransactionId) {
      localTx = await markTransactionStatus(event.localTransactionId, 'PAID');

      // No row: the checkout wrote it only after Mayar accepted, and this process
      // died in between. The payment is real and extraData carries everything the
      // record needs, so reconstruct it rather than losing the revenue record.
      if (!localTx) {
        console.warn(`[Mayar Webhook] No local transaction ${event.localTransactionId} â€” recreating it from the payment.`);
        localTx = await saveTransaction({
          transactionId: event.localTransactionId,
          uid: event.uid || null,
          email: event.email || '',
          item: event.planId ? `${event.planId} plan` : 'Payment',
          type: event.planId || null,
          amount: event.amount || 0,
          currency: 'IDR',
          status: 'PAID',
          paymentUrl: null,
          planId: event.planId || null,
          agents: event.agents || null,
          raw: { recoveredFromWebhook: true },
        });
      }
    }

    // What was bought. extraData is the primary source, but the row we wrote
    // before calling the gateway is the authority if extraData did not survive
    // the round trip â€” relying on the gateway echoing it back meant a stripped
    // field silently downgraded the purchase to the plan's included agents.
    //
    // Neither source is payer-controlled: both are values WE recorded at checkout.
    const uid = event.uid || localTx?.uid || null;
    const planId = event.planId || localTx?.planId || null;
    const requestedAgents = Number.isFinite(event.agents) && event.agents > 0
      ? event.agents
      : (Number(localTx?.agents) > 0 ? Number(localTx.agents) : null);

    if (uid && planId) {
      const plan = await findPlanById(planId);
      const user = await findUserById(uid);

      if (!plan) {
        console.error(`[Mayar Webhook] Paid for unknown plan "${planId}" â€” needs manual review.`);
      } else if (!user) {
        console.error(`[Mayar Webhook] Paid for unknown user "${uid}" â€” needs manual review.`);
      } else if (isAddon(plan)) {
        // A top-up. The plan is left exactly as it is â€” switching it here is what made
        // an "extra agent" product unusable, because a Premium customer who bought one
        // would land on the add-on and lose the message quota they were paying for.
        const units = requestedAgents === null ? 1 : clampAgents(plan, requestedAgents);
        const granted = agentsGranted(plan, units);

        const updated = await addPurchasedAgents(uid, granted);
        appliedPlan = user.planId;
        appliedAgents = updated?.purchasedAgents ?? null;

        console.log(
          `[Mayar Webhook] ${user.email} bought ${plan.name} x${units}: ` +
          `+${granted} agent(s), now ${appliedAgents} total. Plan unchanged (${user.planId}).`
        );

        const fresh = await findUserById(uid);
        io.to(userRoom(uid)).emit('profile-updated', fresh);
        io.to(uid).emit('workspace-updated', { planId: user.planId, agents: appliedAgents });

        // Skip the plan-switch branch below.
        await recordAudit({
          actorUserId: null,
          actorEmail: 'mayar-webhook',
          action: 'payment.addon_applied',
          targetUserId: uid,
          detail: {
            localTransactionId: event.localTransactionId,
            addonId: plan.id, units, grantedAgents: granted, totalAgents: appliedAgents,
          },
          ip: clientIp(req),
        });
      } else {
        await updateUser(uid, { planId: plan.id });
        appliedPlan = plan.id;

        // Grant the agents that were paid for. Falls back to the plan's included
        // count for a payment made before agent pricing existed.
        const agentsPaidFor = requestedAgents === null
          ? plan.includedAgents
          : clampAgents(plan, requestedAgents);

        await setPurchasedAgents(uid, agentsPaidFor);
        appliedAgents = agentsPaidFor;

        console.log(`[Mayar Webhook] Upgraded ${user.email} to ${plan.name} with ${agentsPaidFor} agent(s).`);

        const fresh = await findUserById(uid);
        // The supervisor's own row goes to their own tabs. It must not reach the
        // workspace room, where a member would receive a profile that is not theirs.
        io.to(userRoom(uid)).emit('profile-updated', fresh);
        // The plan and the seat count just changed for everyone in the workspace,
        // so every member needs to re-resolve their limits.
        io.to(uid).emit('workspace-updated', { planId: plan.id, agents: appliedAgents });
      }
    } else {
      console.warn('[Mayar Webhook] Payment carried no uid/planId in extraData and no local record â€” fulfil manually from the admin console.');
    }

    await recordAudit({
      actorUserId: null,
      actorEmail: 'mayar-webhook',
      action: 'payment.received',
      targetUserId: uid || null,
      detail: {
        localTransactionId: event.localTransactionId,
        mayarTransactionId: event.mayarTransactionId,
        planId,
        agents: requestedAgents,
        amount: event.amount,
        status: event.status,
        appliedPlan,
        appliedAgents,
      },
      ip: clientIp(req),
    });

    if (uid) {
      io.to(uid).emit('payment-success', {
        transactionId: event.localTransactionId,
        planId: appliedPlan,
        agents: appliedAgents,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({ success: true, appliedPlan, appliedAgents });
  } catch (err) {
    // A 500 makes Mayar retry, which is what we want for a transient failure.
    console.error('[Mayar Webhook] Processing error:', err.message);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// Manually trigger LID -> phone resolution for the active session.
// Useful right after a big history sync, without waiting for a reconnect.
app.post('/api/resolve-contacts', approved, async (req, res) => {
  const ownerId = req.workspaceId;
  const sid = req.body?.sessionId || req.query.sessionId || 'default';
  const key = sessionKey(ownerId, sid);
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
// ADMIN API â€” every route requires role 'admin', checked against the live
// database row by requireAdmin in server/middleware.js
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
app.get('/api/admin/sessions', admin, (req, res) => {
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
app.post('/api/admin/sessions/logout', admin, (req, res) => {
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
app.get('/api/admin/overview', admin, async (req, res) => {
  const sessionsDir = path.resolve('sessions');
  const disk = fs.existsSync(sessionsDir) ? directorySize(sessionsDir) : { bytes: 0, files: 0 };
  const memory = process.memoryUsage();
  const statuses = {};
  Object.values(activeSessions).forEach((s) => {
    statuses[s.status] = (statuses[s.status] || 0) + 1;
  });

  // Row counts double as a health signal: if this errors the database is the
  // problem, and the admin sees that rather than an empty console.
  let dbStats = { reachable: false };
  try {
    const { rows } = await dbQuery(`
      SELECT
        (SELECT count(*)::int FROM users)                                      AS users,
        (SELECT count(*)::int FROM users WHERE is_approved)                    AS approved_users,
        (SELECT count(*)::int FROM plans WHERE NOT archived)                   AS plans,
        (SELECT count(*)::int FROM transactions)                               AS transactions,
        (SELECT count(*)::int FROM refresh_tokens
          WHERE revoked_at IS NULL AND expires_at > now())                     AS active_sessions,
        pg_size_pretty(pg_database_size(current_database()))                    AS size
    `);
    dbStats = { reachable: true, ...rows[0] };
  } catch (err) {
    dbStats = { reachable: false, error: err.message };
  }

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
    database: dbStats,
    config: {
      corsOrigin: allowedOrigins === '*' ? '*' : allowedOrigins,
      mayarConfigured: mayarConfig.isConfigured,
      mayarWebhookTokenSet: mayarConfig.hasWebhookToken,
      mayarSandbox: mayarConfig.isSandbox,
    },
  });
});

// Commit this process is running, resolved once at startup.
//
// The frontend bundle carries the commit it was built from (see vite.config.js).
// Reporting the server's commit here lets the UI compare the two and warn when
// they differ, which is exactly the "I restarted pm2 but forgot to rebuild"
// mistake that is otherwise invisible.
const SERVER_BUILD = (() => {
  const run = (cmd) => {
    try {
      return execSync(cmd, { cwd: path.resolve('.'), stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
    } catch {
      return '';
    }
  };
  return {
    sha: run('git rev-parse --short HEAD') || 'unknown',
    branch: run('git rev-parse --abbrev-ref HEAD') || 'unknown',
    startedAt: new Date().toISOString(),
  };
})();

// Unauthenticated health check for the reverse proxy / uptime monitoring.
// Intentionally exposes no session or customer data. The commit is included so
// the frontend can detect a version mismatch; it is not sensitive.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    build: SERVER_BUILD,
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
  console.warn('[Config] No dist/ directory found â€” API only. Run `npm run build` to serve the frontend from this process.');
}

// Graceful shutdown so pm2/systemd restarts don't sever sockets abruptly.
let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Process] Received ${signal}, shutting down gracefully...`);

  // Force exit if connections refuse to close in time.
  const force = setTimeout(() => process.exit(0), 10000);

  httpServer.close(async () => {
    try {
      await closePool();
      console.log('[DB] Connection pool closed.');
    } catch (err) {
      console.error('[DB] Error closing pool:', err.message);
    }
    clearTimeout(force);
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// =============================================
// SESSION RESTORE
// =============================================
// Bring previously-paired WhatsApp devices back online at boot.
//
// activeSessions is in-memory, and nothing else calls getOrInitWASocket except
// the socket's init-session event, /api/status and /api/sync â€” all of which need
// a client to act first. So after a restart WhatsApp stayed offline until someone
// opened the dashboard, even though valid credentials were on disk. An automated
// caller would get 503 wa_not_initialized with no way to fix it itself.
//
// Credentials live in sessions/auth_info_<uid>_<sessionId>. Neither a generated
// user id (32 hex) nor a legacy Firebase UID contains an underscore, so the first
// underscore after the prefix separates the two parts. A session id may itself
// contain underscores (session_1783331699425), hence splitting only once.
async function restoreSessionsOnBoot() {
  if ((process.env.RESTORE_SESSIONS || '').trim().toLowerCase() === 'false') {
    console.log('[Restore] Disabled by RESTORE_SESSIONS=false.');
    return;
  }

  const sessionsDir = path.resolve('sessions');
  if (!fs.existsSync(sessionsDir)) return;

  let candidates;
  try {
    candidates = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith('auth_info_'))
      .map(entry => entry.name);
  } catch (err) {
    console.error('[Restore] Could not read the sessions directory:', err.message);
    return;
  }

  if (candidates.length === 0) return;

  let restored = 0;
  let skipped = 0;

  for (const dirName of candidates) {
    const key = dirName.slice('auth_info_'.length);
    const separator = key.indexOf('_');

    if (separator <= 0) {
      console.warn(`[Restore] Skipping ${dirName}: cannot separate uid from session id.`);
      skipped += 1;
      continue;
    }

    const uid = key.slice(0, separator);
    const sessionId = key.slice(separator + 1);

    // Without creds.json the folder holds no usable login â€” usually a partially
    // completed QR scan. Re-initialising it would just emit a fresh QR nobody is
    // watching.
    if (!fs.existsSync(path.join(sessionsDir, dirName, 'creds.json'))) {
      skipped += 1;
      continue;
    }

    // Don't resurrect sessions for accounts that no longer exist.
    try {
      const owner = await findUserById(uid);
      if (!owner) {
        console.warn(`[Restore] Skipping ${dirName}: no such user.`);
        skipped += 1;
        continue;
      }
      // Directory names are built from the WORKSPACE id, so the row they name must
      // be a supervisor. A member id appearing here would mean something built a
      // path from the caller's id instead of req.workspaceId â€” worth failing loudly
      // rather than reconnecting into a tenant that should not exist.
      if (owner.ownerUserId) {
        console.error(
          `[Restore] Skipping ${dirName}: ${owner.email} is a team member, not a workspace owner. ` +
          'A session directory should never be keyed by a member id.'
        );
        skipped += 1;
        continue;
      }
      if (owner.role !== 'admin' && !owner.isApproved) {
        console.warn(`[Restore] Skipping ${dirName}: ${owner.email} is not approved.`);
        skipped += 1;
        continue;
      }
    } catch (err) {
      console.error(`[Restore] Could not check the owner of ${dirName}:`, err.message);
      skipped += 1;
      continue;
    }

    // Stagger the connections. Opening many WhatsApp sockets at once invites
    // rate limiting, and each one does its own history sync.
    setTimeout(() => {
      console.log(`[Restore] Reconnecting ${uid}/${sessionId}`);
      try {
        getOrInitWASocket(uid, sessionId);
      } catch (err) {
        console.error(`[Restore] Failed to reconnect ${uid}/${sessionId}:`, err.message);
      }
    }, restored * 3000);

    restored += 1;
  }

  console.log(
    `[Restore] ${restored} session${restored === 1 ? '' : 's'} queued for reconnect` +
    `${skipped ? `, ${skipped} skipped` : ''}.`
  );
}

// =============================================
// STARTUP
// =============================================
// The database and signing key are checked before the port is opened. Starting
// without them would serve a site that fails every request, so it is better to
// exit and let pm2 report the crash than to appear healthy.
async function start() {
  try {
    assertAuthConfigured();
  } catch (err) {
    console.error(`[Config] ${err.message}`);
    process.exit(1);
  }

  try {
    await verifyConnection();
    await runMigrations();
  } catch (err) {
    console.error('[DB] Startup failed:', err.message);
    console.error('[DB] Check DATABASE_URL and that Postgres is reachable. See deploy/POSTGRES.md.');
    process.exit(1);
  }

  // Housekeeping: drop long-expired refresh tokens hourly.
  pruneRefreshTokens().catch(() => {});
  setInterval(() => {
    pruneRefreshTokens().catch(err => console.error('[DB] Prune failed:', err.message));
  }, 60 * 60 * 1000).unref();

  httpServer.listen(PORT, HOST, () => {
    console.log(`Multi-Tenant Server listening on http://${HOST}:${PORT}`);
    console.log(`[Config] Sessions directory: ${path.resolve('sessions')}`);
    if (allowedOrigins === '*') {
      console.warn('[Config] CORS_ORIGIN is not set â€” allowing all origins. Set CORS_ORIGIN to your frontend URL in production.');
    } else {
      console.log(`[Config] CORS allowed origins: ${allowedOrigins.join(', ')}`);
    }
    reportMayarConfig();

    // After the port is open, so a slow reconnect never delays readiness.
    restoreSessionsOnBoot().catch(err =>
      console.error('[Restore] Session restore failed:', err.message)
    );
  });
}

start();
