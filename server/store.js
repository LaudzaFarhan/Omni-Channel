import fs from 'fs';
import path from 'path';

class UserStore {
  constructor(uid) {
    this.uid = uid;
    this.storePath = path.resolve(`sessions/store_${uid}.json`);
    this.chats = {}; // jid -> chat details
    this.messages = {}; // jid -> message list
    this.contacts = {}; // jid -> contact details
    this.lidMap = {}; // lid -> { pn: phone@s.whatsapp.net, pushName: 'Name' }
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

        // Rebuild LID map from existing messages on startup
        this._rebuildLidMap();
      }
    } catch (err) {
      console.error(`[Store - ${this.uid}] Error loading store:`, err);
    }
  }

  // Scan all stored messages to extract senderPn/participantPn mappings
  _rebuildLidMap() {
    let found = 0;
    this.lidMap = {}; // Reset to purge corrupt legacy mappings
    Object.entries(this.messages).forEach(([jid, msgs]) => {
      msgs.forEach(m => {
        // Only map remoteJid to senderPn if it is an incoming message (not fromMe)
        if (m.key.senderPn && m.key.remoteJid?.endsWith('@lid') && !m.key.fromMe) {
          const lid = m.key.remoteJid;
          if (!this.lidMap[lid]) {
            this.lidMap[lid] = {};
          }
          this.lidMap[lid].pn = m.key.senderPn;
          // Only use pushName from INCOMING messages (the contact's own name)
          if (m.pushName) {
            this.lidMap[lid].pushName = m.pushName;
          }
          found++;
        }
        if (m.key.participantPn && m.key.participant?.endsWith('@lid')) {
          const lid = m.key.participant;
          if (!this.lidMap[lid]) {
            this.lidMap[lid] = {};
          }
          this.lidMap[lid].pn = m.key.participantPn;
          if (!m.key.fromMe && m.pushName) {
            this.lidMap[lid].pushName = m.pushName;
          }
          found++;
        }
      });
    });

    // Clean up contacts and chats that were corrupted with our own business name
    const corruptName = "Education Consultant The Lab Bekasi";
    let needsSave = false;

    Object.entries(this.contacts).forEach(([jid, contact]) => {
      if (contact.name === corruptName) {
        console.log(`[Store - ${this.uid}] Purging corrupt contact name for: ${jid}`);
        const resolvedName = this.resolveLidName(jid);
        const resolvedPhone = this.resolveLidPhone(jid);
        contact.name = resolvedName || resolvedPhone || jid.split('@')[0];
        needsSave = true;
      }
    });

    Object.entries(this.chats).forEach(([jid, chat]) => {
      if (chat.name === corruptName) {
        console.log(`[Store - ${this.uid}] Purging corrupt chat name for: ${jid}`);
        const resolvedName = this.resolveLidName(jid);
        const resolvedPhone = this.resolveLidPhone(jid);
        chat.name = resolvedName || resolvedPhone || jid.split('@')[0];
        needsSave = true;
      }
    });

    // Now update all LID chat names with the resolved data
    Object.keys(this.chats).forEach(jid => {
      if (jid.endsWith('@lid')) {
        const mapping = this.lidMap[jid];
        if (mapping) {
          const phoneNum = mapping.pn ? mapping.pn.split('@')[0] : null;
          // Always update LID chats with resolved pushName/phone if available
          if (mapping.pushName && mapping.pushName !== corruptName) {
            this.chats[jid].name = mapping.pushName;
          }
          if (phoneNum) {
            this.chats[jid].phoneNumber = '+' + phoneNum;
            // If we still have no real name, use the phone number
            if (!mapping.pushName || mapping.pushName === corruptName) {
              const currentName = this.chats[jid].name;
              if (!currentName || currentName === corruptName || /^\d+$/.test(currentName.trim())) {
                this.chats[jid].name = '+' + phoneNum;
              }
            }
          }
          needsSave = true;
        }
      }
    });

    if (found > 0) {
      console.log(`[Store - ${this.uid}] Rebuilt LID map: ${Object.keys(this.lidMap).length} mappings from ${found} message keys.`);
      needsSave = true;
    }

    if (needsSave) {
      this.save();
    }
  }

  // Extract LID mapping from a message key
  _extractLidMapping(message) {
    const key = message.key;
    // Only map remoteJid to senderPn if it is an incoming message (not fromMe)
    if (key.senderPn && key.remoteJid?.endsWith('@lid') && !key.fromMe) {
      const lid = key.remoteJid;
      if (!this.lidMap[lid]) this.lidMap[lid] = {};
      this.lidMap[lid].pn = key.senderPn;
      // Only capture pushName from INCOMING messages (the contact's own name)
      if (message.pushName) {
        this.lidMap[lid].pushName = message.pushName;
      }

      // Update the chat name with the resolved info
      const phoneNum = key.senderPn.split('@')[0];
      if (this.chats[lid]) {
        this.chats[lid].phoneNumber = '+' + phoneNum;
        // Use contact's pushName if available (from incoming), otherwise use phone
        if (this.lidMap[lid].pushName) {
          this.chats[lid].name = this.lidMap[lid].pushName;
        }
      }
    }
    if (key.participantPn && key.participant?.endsWith('@lid')) {
      const lid = key.participant;
      if (!this.lidMap[lid]) this.lidMap[lid] = {};
      this.lidMap[lid].pn = key.participantPn;
      if (!key.fromMe && message.pushName) {
        this.lidMap[lid].pushName = message.pushName;
      }
    }
  }

  // Resolve a LID to a display-friendly name
  resolveLidName(lid) {
    const mapping = this.lidMap[lid];
    if (mapping) {
      if (mapping.pushName) return mapping.pushName;
      if (mapping.pn) return '+' + mapping.pn.split('@')[0];
    }
    return null;
  }

  // Resolve a LID to a phone number string (with +)
  resolveLidPhone(lid) {
    const mapping = this.lidMap[lid];
    if (mapping && mapping.pn) {
      return '+' + mapping.pn.split('@')[0];
    }
    return null;
  }

  save() {
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

  addContact(contact) {
    if (!contact || !contact.id) return;
    const jid = contact.id;

    // Resolve real name: prefer explicit name fields over raw LID numbers
    let resolvedName = contact.name || contact.verifiedName || contact.notify;
    if (!resolvedName || /^\d+$/.test(resolvedName.trim())) {
      // Try LID map
      const lidName = this.resolveLidName(jid);
      if (lidName) resolvedName = lidName;
    }

    this.contacts[jid] = {
      ...this.contacts[jid],
      ...contact,
      name: resolvedName || this.contacts[jid]?.name || jid.split('@')[0],
    };
    this.save();
  }

  addChat(chat) {
    if (!chat || !chat.id) return;
    const jid = chat.id;
    const existing = this.chats[jid] || {};

    // If the incoming name is just digits and we have a resolved name, keep the resolved one
    let name = chat.name;
    if (name && /^\d+$/.test(name.trim()) && jid.endsWith('@lid')) {
      const lidName = this.resolveLidName(jid);
      if (lidName) name = lidName;
      const lidPhone = this.resolveLidPhone(jid);
      if (lidPhone) chat.phoneNumber = lidPhone;
    }

    this.chats[jid] = {
      ...existing,
      ...chat,
      ...(name ? { name } : {}),
    };
    this.save();
  }

  addMessage(jid, message) {
    if (!this.messages[jid]) {
      this.messages[jid] = [];
    }

    // Extract LID-to-phone mapping from message key
    this._extractLidMapping(message);
    
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
    const timestamp = message.messageTimestamp ? message.messageTimestamp * 1000 : Date.now();
    
    // Resolve display name: pushName > contact name > LID resolved > raw JID
    let chatName = this.contacts[jid]?.name || this.chats[jid]?.name;
    if (!chatName || /^\d+$/.test(chatName.trim())) {
      // Try pushName from the OTHER person (not fromMe)
      if (!message.key.fromMe && message.pushName) {
        chatName = message.pushName;
      }
      // Try LID resolution
      if (!chatName || /^\d+$/.test(chatName.trim())) {
        const lidName = this.resolveLidName(jid);
        if (lidName) chatName = lidName;
      }
    }

    // Don't auto-increment unread count if it's sent from us
    const unreadIncrement = (message.key.fromMe) ? 0 : 1;

    // Get resolved phone number for LID chats
    const phoneNumber = this.resolveLidPhone(jid);

    this.addChat({
      id: jid,
      name: chatName || jid.split('@')[0],
      ...(phoneNumber ? { phoneNumber } : {}),
      lastMessage: text,
      lastMessageTimestamp: timestamp,
      lastMessageFromMe: !!message.key.fromMe,
      lastMessageStatus: message.status || 1, // Default to 1 (SERVER_ACK/sent)
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
