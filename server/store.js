import fs from 'fs';
import path from 'path';

// Our own business account name occasionally leaks into contact/chat records
// via outgoing (fromMe) pushName. We must never display it as a contact name.
const CORRUPT_NAME = 'Education Consultant The Lab Bekasi';

const isRealName = (name) => !!name && !/^\d+$/.test(String(name).trim()) && String(name).trim() !== CORRUPT_NAME;

// WhatsApp/Baileys timestamps come as a number, a numeric string, or a protobuf
// Long object ({ low, high, unsigned }). Normalize any of these to seconds.
// Returns null when there is no usable value.
const toSeconds = (ts) => {
  if (ts == null) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  if (typeof ts === 'string') {
    const n = Number(ts);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof ts === 'object' && typeof ts.low === 'number') {
    // Combine 32-bit halves. Real timestamps have high === 0, but be safe.
    const high = typeof ts.high === 'number' ? ts.high : 0;
    return high * 4294967296 + (ts.low >>> 0);
  }
  return null;
};

// Normalize to milliseconds (what the frontend expects), or null.
const toMillis = (ts) => {
  const secs = toSeconds(ts);
  return secs == null ? null : secs * 1000;
};

// A millisecond timestamp is "sane" if it's positive and not absurdly in the future.
// This rejects corrupt values (e.g. seconds accidentally multiplied by a million by
// an older code path) so they can't pin a chat to the top of the list.
const isSaneMs = (ms) => typeof ms === 'number' && Number.isFinite(ms) && ms > 0 && ms < Date.now() + 172800000;

class UserStore {
  constructor(uid) {
    this.uid = uid;
    this.storePath = path.resolve(`sessions/store_${uid}.json`);
    this.chats = {}; // jid -> chat details
    this.messages = {}; // jid -> message list
    this.contacts = {}; // jid -> contact details
    this.lidMap = {}; // lid -> { pn: phone@s.whatsapp.net, savedName, pushName }
    this.load();
  }

  load() {
    try {
      const sessionsDir = path.resolve('sessions');
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true });
      }

      if (fs.existsSync(this.storePath)) {
        const data = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
        this.chats = data.chats || {};
        this.messages = data.messages || {};
        this.contacts = data.contacts || {};
        this.lidMap = data.lidMap || {};
        console.log(`[Store - ${this.uid}] Loaded ${Object.keys(this.chats).length} chats, ${Object.keys(this.contacts).length} contacts, ${Object.keys(this.lidMap).length} LID mappings.`);

        // Rebuild LID map from existing contacts + messages on startup
        this._rebuildLidMap();
      }
    } catch (err) {
      console.error(`[Store - ${this.uid}] Error loading store:`, err);
    }
  }

  // Scan all stored contacts and messages to (re)build the LID -> phone/name map,
  // then heal any chats/contacts that are still showing raw numbers or corrupt names.
  _rebuildLidMap() {
    this.lidMap = {}; // Reset to purge corrupt legacy mappings
    let learned = 0;

    // 1) Contacts are the most authoritative source: each phone contact carries
    //    its saved name AND the associated @lid, giving us a complete mapping.
    Object.values(this.contacts).forEach(c => {
      if (this._learnFromContact(c, false)) learned++;
    });

    // 2) Messages fill in gaps for contacts we never saved (pushName + senderPn).
    Object.values(this.messages).forEach(msgs => {
      msgs.forEach(m => this._extractLidMapping(m, false));
    });

    // 3) Purge our own business name that may have leaked into contacts/chats.
    Object.values(this.contacts).forEach(contact => {
      if (contact.name === CORRUPT_NAME) {
        const lid = contact.id?.endsWith('@lid') ? contact.id : contact.lid;
        contact.name = (lid && this.resolveLidName(lid)) || contact.id?.split('@')[0] || contact.name;
      }
    });

    // 4) Apply the resolved mapping to every @lid chat.
    Object.keys(this.chats).forEach(jid => {
      if (jid.endsWith('@lid')) {
        this._applyMappingToChat(jid);
      } else if (this.chats[jid].name === CORRUPT_NAME) {
        this.chats[jid].name = jid.split('@')[0];
      }
    });

    // 5) Heal chat recency: earlier builds stored NaN/null timestamps (Long values
    //    multiplied by 1000). Recompute from conversationTimestamp + stored messages
    //    so the list orders correctly to match WhatsApp on the next load.
    let healedTs = 0;
    Object.entries(this.chats).forEach(([jid, chat]) => {
      const msgs = this.messages[jid] || [];
      let msgMax = 0;
      msgs.forEach(m => {
        const t = toMillis(m.messageTimestamp);
        if (isSaneMs(t) && t > msgMax) msgMax = t;
      });
      const best = Math.max(
        ...[
          chat.lastMessageTimestamp,
          toMillis(chat.conversationTimestamp),
          msgMax,
        ].filter(isSaneMs),
        0
      );
      if (best > 0 && best !== chat.lastMessageTimestamp) {
        chat.lastMessageTimestamp = best;
        healedTs++;
      } else if (best === 0 && !isSaneMs(chat.lastMessageTimestamp) && chat.lastMessageTimestamp != null) {
        // Corrupt value with nothing sane to replace it — drop it entirely.
        delete chat.lastMessageTimestamp;
        healedTs++;
      }
    });

    console.log(`[Store - ${this.uid}] Rebuilt LID map: ${Object.keys(this.lidMap).length} mappings (${learned} from contacts); healed ${healedTs} chat timestamps.`);
    this.save();
  }

  // Record/merge a lid <-> phone mapping along with any known names.
  // Returns true if anything changed. Set `persist` to save + push to chat immediately.
  _learnMapping(lid, pn, { savedName, pushName } = {}, persist = true) {
    if (!lid || !lid.endsWith('@lid')) return false;
    if (!this.lidMap[lid]) this.lidMap[lid] = {};
    const m = this.lidMap[lid];
    let changed = false;

    if (pn && pn.endsWith('@s.whatsapp.net') && m.pn !== pn) {
      m.pn = pn;
      changed = true;
    }
    if (isRealName(savedName) && m.savedName !== savedName) {
      m.savedName = savedName;
      changed = true;
    }
    if (isRealName(pushName) && m.pushName !== pushName) {
      m.pushName = pushName;
      changed = true;
    }

    if (changed) {
      this._applyMappingToChat(lid);
      if (persist) this.save();
    }
    return changed;
  }

  // Learn a mapping from a Contact object (which may be keyed by @lid or @s.whatsapp.net
  // and carries `lid` / `jid` cross-reference fields).
  _learnFromContact(contact, persist = true) {
    if (!contact || !contact.id) return false;
    const id = contact.id;

    let lid = null;
    let pn = null;
    if (id.endsWith('@lid')) lid = id;
    else if (id.endsWith('@s.whatsapp.net')) pn = id;

    if (!lid && typeof contact.lid === 'string' && contact.lid.endsWith('@lid')) lid = contact.lid;
    if (!pn && typeof contact.jid === 'string' && contact.jid.endsWith('@s.whatsapp.net')) pn = contact.jid;

    if (!lid) return false;

    const savedName = isRealName(contact.name) ? contact.name
      : (isRealName(contact.verifiedName) ? contact.verifiedName : null);
    const pushName = isRealName(contact.notify) ? contact.notify : null;

    return this._learnMapping(lid, pn, { savedName, pushName }, persist);
  }

  // Push the best known name/phone from the lid map onto the @lid-keyed chat.
  _applyMappingToChat(lid) {
    const m = this.lidMap[lid];
    const chat = this.chats[lid];
    if (!m || !chat) return;

    const bestName = m.savedName || m.pushName;
    if (bestName) {
      chat.name = bestName;
    } else if (m.pn) {
      // No real name yet -> fall back to the phone number instead of raw LID digits.
      const phone = '+' + m.pn.split('@')[0];
      if (!isRealName(chat.name)) chat.name = phone;
    }

    if (m.pn) chat.phoneNumber = '+' + m.pn.split('@')[0];
  }

  // Extract a lid mapping from a message key (incoming messages carry senderPn/pushName).
  _extractLidMapping(message, persist = true) {
    const key = message?.key;
    if (!key) return;

    // remoteJid is a @lid and the message carries the sender's phone number
    if (key.remoteJid?.endsWith('@lid') && key.senderPn) {
      this._learnMapping(
        key.remoteJid,
        key.senderPn,
        { pushName: !key.fromMe ? message.pushName : undefined },
        persist
      );
    }

    // Group participant expressed as @lid with an accompanying phone number
    if (key.participant?.endsWith('@lid') && key.participantPn) {
      this._learnMapping(
        key.participant,
        key.participantPn,
        { pushName: !key.fromMe ? message.pushName : undefined },
        persist
      );
    }
  }

  // Resolve a LID to a display-friendly name (saved name > pushName > phone).
  resolveLidName(lid) {
    const m = this.lidMap[lid];
    if (m) {
      if (isRealName(m.savedName)) return m.savedName;
      if (isRealName(m.pushName)) return m.pushName;
      if (m.pn) return '+' + m.pn.split('@')[0];
    }
    return null;
  }

  // Resolve a LID to a phone number string (with +)
  resolveLidPhone(lid) {
    const m = this.lidMap[lid];
    if (m && m.pn) {
      return '+' + m.pn.split('@')[0];
    }
    return null;
  }

  // Debounced persistence: the API always serves from the in-memory copy, so we
  // coalesce the many writes triggered during a bulk sync into a single disk write.
  save() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveNow();
    }, 500);
  }

  saveNow() {
    try {
      const data = {
        chats: this.chats,
        messages: this.messages,
        contacts: this.contacts,
        lidMap: this.lidMap,
      };
      fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[Store - ${this.uid}] Error saving store:`, err);
    }
  }

  clear() {
    try {
      if (this._saveTimer) {
        clearTimeout(this._saveTimer);
        this._saveTimer = null;
      }
      if (fs.existsSync(this.storePath)) {
        fs.unlinkSync(this.storePath);
      }
      this.chats = {};
      this.messages = {};
      this.contacts = {};
      this.lidMap = {};
    } catch (err) {
      console.error(`[Store - ${this.uid}] Error clearing store:`, err);
    }
  }

  // Explicit lid <-> phone share (from Baileys 'chats.phoneNumberShare' event).
  addPhoneNumberShare(lid, jid) {
    this._learnMapping(lid, jid, {}, true);
  }

  addContact(contact) {
    if (!contact || !contact.id) return;
    const jid = contact.id;

    // Learn/refresh the LID mapping so @lid-keyed chats resolve to a real name.
    this._learnFromContact(contact, false);

    // Resolve the best display name for this contact record.
    let resolvedName = null;
    if (isRealName(contact.name)) resolvedName = contact.name;
    else if (isRealName(contact.verifiedName)) resolvedName = contact.verifiedName;
    else if (isRealName(contact.notify)) resolvedName = contact.notify;

    if (!resolvedName) {
      const lid = jid.endsWith('@lid') ? jid
        : (typeof contact.lid === 'string' && contact.lid.endsWith('@lid') ? contact.lid : null);
      if (lid) resolvedName = this.resolveLidName(lid);
    }

    this.contacts[jid] = {
      ...this.contacts[jid],
      ...contact,
      name: resolvedName || this.contacts[jid]?.name || jid.split('@')[0],
    };

    // If we now have an authoritative saved name, propagate it to matching chats
    // (keyed either by the phone jid or by the associated @lid).
    if (isRealName(resolvedName)) {
      if (this.chats[jid]) this.chats[jid].name = resolvedName;
      const lid = typeof contact.lid === 'string' && contact.lid.endsWith('@lid') ? contact.lid : null;
      if (lid && this.chats[lid]) this.chats[lid].name = resolvedName;
    }

    this.save();
  }

  addChat(chat) {
    if (!chat || !chat.id) return;
    const jid = chat.id;
    const existing = this.chats[jid] || {};

    // If the incoming name is just digits (or corrupt) and we have a resolved name, keep the resolved one.
    let name = chat.name;
    if (name && !isRealName(name) && jid.endsWith('@lid')) {
      const lidName = this.resolveLidName(jid);
      if (lidName) name = lidName;
      const lidPhone = this.resolveLidPhone(jid);
      if (lidPhone) chat.phoneNumber = lidPhone;
    }
    if (name === CORRUPT_NAME) name = undefined;

    const merged = {
      ...existing,
      ...chat,
      ...(name ? { name } : {}),
    };

    // Determine the true recency (ms) from every available signal and never regress:
    // WhatsApp orders chats by conversationTimestamp, so it must be considered too.
    // Note: lastMessageTimestamp is already in ms (set by addMessage/prior state),
    // while conversationTimestamp is a raw WhatsApp value in seconds.
    const recency = Math.max(
      ...[
        existing.lastMessageTimestamp,
        typeof chat.lastMessageTimestamp === 'number' ? chat.lastMessageTimestamp : toMillis(chat.lastMessageTimestamp),
        toMillis(chat.conversationTimestamp),
      ].filter(isSaneMs),
      0
    );
    if (recency > 0) merged.lastMessageTimestamp = recency;
    else delete merged.lastMessageTimestamp; // avoid persisting null/NaN

    this.chats[jid] = merged;

    // Ensure @lid chats always get the best resolved name/phone available.
    if (jid.endsWith('@lid')) {
      this._applyMappingToChat(jid);
    }

    this.save();
  }

  addMessage(jid, message) {
    if (!this.messages[jid]) {
      this.messages[jid] = [];
    }

    // Extract LID-to-phone mapping from message key
    this._extractLidMapping(message, false);
    
    // Avoid duplicates
    const msgId = message.key.id;
    const exists = this.messages[jid].some(m => m.key.id === msgId);
    if (!exists) {
      this.messages[jid].push(message);
      
      // Sort messages by timestamp
      this.messages[jid].sort((a, b) => {
        const tA = a.messageTimestamp || 0;
        const tB = b.messageTimestamp || 0;
        return tA - tB;
      });

      // Keep only last 100 messages
      if (this.messages[jid].length > 100) {
        this.messages[jid] = this.messages[jid].slice(-100);
      }
    }
    
    // Update chat last message info
    const text = this.getMessageText(message);
    const timestamp = toMillis(message.messageTimestamp) || Date.now();
    
    // Resolve display name: saved contact name > existing real name > pushName > LID resolved > phone.
    let chatName = null;
    if (isRealName(this.contacts[jid]?.name)) chatName = this.contacts[jid].name;
    else if (isRealName(this.chats[jid]?.name)) chatName = this.chats[jid].name;

    if (!chatName) {
      // Try pushName from the OTHER person (not fromMe)
      if (!message.key.fromMe && isRealName(message.pushName)) {
        chatName = message.pushName;
      }
      // Try LID resolution
      if (!chatName) {
        const lidName = this.resolveLidName(jid);
        if (lidName) chatName = lidName;
      }
    }

    // Don't auto-increment unread count if it's sent from us
    const unreadIncrement = (message.key.fromMe) ? 0 : 1;

    // Get resolved phone number for LID chats
    const phoneNumber = this.resolveLidPhone(jid);

    // Only refresh the chat's last-message preview when this message is at least as
    // recent as what we already have. History sync delivers newest-first, so older
    // messages processed afterwards must not clobber the newest preview/timestamp.
    const existingTs = this.chats[jid]?.lastMessageTimestamp;
    const isNewest = !existingTs || timestamp >= existingTs;

    this.addChat({
      id: jid,
      name: chatName || jid.split('@')[0],
      ...(phoneNumber ? { phoneNumber } : {}),
      ...(isNewest ? {
        lastMessage: text,
        lastMessageTimestamp: timestamp,
        lastMessageFromMe: !!message.key.fromMe,
        lastMessageStatus: message.status || 1, // Default to 1 (SERVER_ACK/sent)
      } : {}),
      unreadCount: message.key.fromMe ? 0 : (this.chats[jid]?.unreadCount || 0) + unreadIncrement
    });

    this.save();
  }

  updateMessage(jid, msgId, updateFields) {
    if (!this.messages[jid]) return;
    const msgIndex = this.messages[jid].findIndex(m => m.key.id === msgId);
    if (msgIndex !== -1) {
      this.messages[jid][msgIndex] = {
        ...this.messages[jid][msgIndex],
        ...updateFields
      };
      this.save();
    }
  }

  getMessageText(message) {
    const msg = message.message;
    if (!msg) return '';
    if (msg.conversation) return msg.conversation;
    if (msg.extendedTextMessage) return msg.extendedTextMessage.text;
    if (msg.imageMessage) return '📷 Photo';
    if (msg.videoMessage) return '🎥 Video';
    if (msg.audioMessage) return '🎵 Audio';
    if (msg.documentMessage) return '📄 Document';
    return '📝 Media/Message';
  }
}

const stores = {};

export function getStore(uid) {
  if (!stores[uid]) {
    stores[uid] = new UserStore(uid);
  }
  return stores[uid];
}
