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
const FIREBASE_PROJECT_ID = 'whatsapp-omni-f2918';
const app = express();
const httpServer = createServer(app);

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// HTTP Request logging
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path}`);
  next();
});

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
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

async function getOrInitWASocket(uid, sessionId = 'default') {
  const key = sessionKey(uid, sessionId);

  if (activeSessions[key] && activeSessions[key].sock) {
    return activeSessions[key];
  }

  console.log(`[Baileys - ${key}] Initializing socket connection...`);
  
  // Set default placeholder
  activeSessions[key] = {
    sock: null,
    status: 'connecting',
    qr: null,
    user: null,
    uid,
    sessionId
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
        io.to(uid).emit('status-change', { sessionId, status: 'connected', user: sock.user });
        console.log(`[Baileys - ${key}] Connection successfully opened!`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[Baileys - ${key}] Connection closed. Code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

        session.status = 'disconnected';
        session.qr = null;
        session.user = null;
        io.to(uid).emit('status-change', { sessionId, status: 'disconnected', reason: statusCode });

        if (shouldReconnect) {
          // Restart socket connection
          session.sock = null;
          getOrInitWASocket(uid, sessionId);
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
          io.to(uid).emit('history-sync-complete', { sessionId });
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
      io.to(uid).emit('history-sync-complete', { sessionId });
    });

    sock.ev.on('chats.upsert', (newChats) => {
      const store = getStore(key);
      newChats.forEach(c => {
        store.addChat(c);
        if (c.id.endsWith('@g.us')) {
          fetchGroupMetadataIfNeeded(c.id, c.name);
        }
      });
      io.to(uid).emit('history-sync-complete', { sessionId });
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
      io.to(uid).emit('history-sync-complete', { sessionId });
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
    });

    sock.ev.on('contacts.update', (updates) => {
      const store = getStore(key);
      updates.forEach(u => {
        if (u.id?.endsWith('@lid') || u.lid) {
          console.log(`[Baileys - ${key}] Contact update with LID:`, JSON.stringify({ id: u.id, name: u.name, notify: u.notify, verifiedName: u.verifiedName, lid: u.lid, phone: u.phone, number: u.number }));
        }
        store.addContact(u);
      });
    });

    // After connection is opened, try to resolve unresolved LID contacts
    const resolveLidContacts = async () => {
      const store = getStore(key);
      const unresolvedLids = Object.values(store.chats)
        .filter(c => c.id.endsWith('@lid') && !c.phoneNumber)
        .map(c => c.id);

      if (unresolvedLids.length === 0) return;
      console.log(`[Baileys - ${key}] Attempting to resolve ${unresolvedLids.length} unresolved LID contacts...`);

      // Check if sock has a store with LID mappings
      if (sock.store && sock.store.contacts) {
        for (const lid of unresolvedLids) {
          const contact = sock.store.contacts[lid];
          if (contact && (contact.notify || contact.name || contact.verifiedName)) {
            const displayName = contact.notify || contact.name || contact.verifiedName;
            store.addChat({ id: lid, name: displayName });
            console.log(`[Baileys - ${key}] Resolved LID from sock.store: ${lid} -> ${displayName}`);
          }
        }
      }

      // Try to use sock.user to see LID mapping
      if (sock.authState && sock.authState.creds) {
        const myLid = sock.authState.creds.me?.lid;
        if (myLid) {
          console.log(`[Baileys - ${key}] My LID: ${myLid}`);
        }
      }

      // Batch resolve: try fetchStatus for each unresolved contact (limited to first 30)
      const batch = unresolvedLids.slice(0, 30);
      for (const lid of batch) {
        try {
          const status = await sock.fetchStatus(lid);
          if (status && status.status) {
            // Status exists = valid contact, use pushName from status if available
            console.log(`[Baileys - ${key}] Status for ${lid}: ${status.status?.substring(0, 50)}`);
          }
        } catch (err) {
          // silently ignore - this is a best-effort resolution
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
      }

      io.to(uid).emit('history-sync-complete', { sessionId });
    };

    // Run LID resolution 10 seconds after connection to allow sync to complete
    setTimeout(() => {
      if (activeSessions[key]?.status === 'connected') {
        resolveLidContacts().catch(err => {
          console.warn(`[Baileys - ${key}] LID resolution error:`, err.message);
        });
      }
    }, 10000);

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
          io.to(uid).emit('history-sync-complete', { sessionId });
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

// Helper to fetch sessionLimit from Firestore dynamically via Google REST API
async function fetchUserSessionLimit(uid, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${uid}`,
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
            const limitVal = body.fields?.sessionLimit?.integerValue;
            if (limitVal !== undefined) {
              return resolve(parseInt(limitVal, 10));
            }
          } catch (e) {
            console.error('[Firestore REST] Error parsing profile document:', e);
          }
        } else {
          console.warn(`[Firestore REST] Failed to fetch profile (HTTP ${res.statusCode}):`, data);
        }
        resolve(1); // Default fallback
      });
    });

    req.on('error', (err) => {
      console.error('[Firestore REST] Request error:', err);
      resolve(1); // Default fallback
    });

    req.end();
  });
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

  // Fetch session limit dynamically from Firestore REST API
  const sessionLimit = await fetchUserSessionLimit(uid, token);

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
        io.to(uid).emit('history-sync-complete', { sessionId });
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

// Serve frontend build static files in production
const distPath = path.resolve('dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Start Server
httpServer.listen(PORT, () => {
  console.log(`Multi-Tenant Server listening on http://localhost:${PORT}`);
});
