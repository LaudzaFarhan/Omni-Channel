// Saved contacts: the operator's own address book.
//
// These are the customer's records, not WhatsApp's. Baileys' contact list lives
// in the on-disk store and is rebuilt from WhatsApp on every sync (and deleted on
// logout), so a name a human typed there would not survive. Everything here is a
// Postgres row scoped to the caller's user id.
//
// Contacts are per user rather than per session — one address book across every
// WhatsApp number the customer has connected. The link to a live conversation is
// resolved per request from the requested session's LID map, so switching session
// changes the "last message" column without touching the stored data.

import {
  listContacts, findContactById, findContactByPhone,
  upsertContact, updateContact, deleteContact, deleteContactsBulk,
  importContacts, listContactTags,
} from './data.js';
import { authenticated } from './middleware.js';
import { getStore } from './store.js';
import { normalizePhone } from '../src/utils/phone.js';

// Postgres reports a unique-index collision as 23505. For contacts that only ever
// means contacts_user_phone_key, i.e. this number is already saved.
const UNIQUE_VIOLATION = '23505';

// Attach the conversation each contact maps to in this session, if any.
//
// Purely derived: nothing about a chat is stored on the contact row, so a contact
// saved before WhatsApp ever connected starts showing its history the moment the
// number appears in a synced chat.
function decorateWithChats(contacts, store) {
  if (!store) return contacts.map(c => ({ ...c, chatJid: null, lastMessage: null, lastMessageTimestamp: null, unreadCount: 0 }));

  const byDigits = store.chatsByPhoneDigits();

  return contacts.map((contact) => {
    const chat = byDigits[contact.phone];
    return {
      ...contact,
      chatJid: chat?.id || null,
      lastMessage: chat?.lastMessage || null,
      lastMessageTimestamp: chat?.lastMessageTimestamp || null,
      unreadCount: chat?.unreadCount || 0,
    };
  });
}

// Shared validation for the create/update body. Returns { ok, value } or
// { ok: false, error }.
function readContactBody(body, { requirePhone = true } = {}) {
  const out = {};

  if (body.phone !== undefined || requirePhone) {
    const phone = normalizePhone(body.phone);
    if (!phone) {
      return {
        ok: false,
        error: 'Enter a valid WhatsApp number, for example 0812xxxxxxx or +62812xxxxxxx.',
        code: 'invalid_phone',
      };
    }
    out.phone = phone;
  }

  if (body.name !== undefined) out.name = String(body.name ?? '').trim().slice(0, 120);
  if (body.email !== undefined) out.email = body.email ? String(body.email).trim().slice(0, 200) : null;
  if (body.company !== undefined) out.company = body.company ? String(body.company).trim().slice(0, 120) : null;
  if (body.note !== undefined) out.note = body.note ? String(body.note).trim().slice(0, 1000) : null;
  if (body.tags !== undefined) out.tags = Array.isArray(body.tags) ? body.tags : [];

  return { ok: true, value: out };
}

export function mountContactRoutes(app, io) {
  // Let the caller's other tabs refresh after a change, the same way plan and
  // hold updates propagate.
  const notify = (uid) => {
    if (io) io.to(uid).emit('contacts-updated');
  };

  const storeFor = (uid, sessionId) => {
    try {
      return getStore(`${uid}_${sessionId}`);
    } catch (err) {
      // A missing session must not fail the list; the contacts themselves are
      // independent of WhatsApp.
      console.warn('[Contacts] Could not open the session store:', err.message);
      return null;
    }
  };

  // =========================================================================
  // read
  // =========================================================================
  app.get('/api/contacts', authenticated, async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || 'default');
      const contacts = await listContacts(req.profile.uid);
      res.json({ contacts: decorateWithChats(contacts, storeFor(req.profile.uid, sessionId)) });
    } catch (err) {
      console.error('[Contacts] List failed:', err);
      res.status(500).json({ error: 'Could not load contacts.' });
    }
  });

  // Declared before '/:id' so 'tags' is not swallowed as an id.
  app.get('/api/contacts/tags', authenticated, async (req, res) => {
    try {
      res.json({ tags: await listContactTags(req.profile.uid) });
    } catch (err) {
      console.error('[Contacts] Tag list failed:', err);
      res.status(500).json({ error: 'Could not load tags.' });
    }
  });

  // Look a number up without knowing its contact id — used by the chat window to
  // decide between "Save contact" and "Edit contact".
  app.get('/api/contacts/by-phone/:phone', authenticated, async (req, res) => {
    try {
      const phone = normalizePhone(req.params.phone);
      if (!phone) return res.status(400).json({ error: 'Not a valid phone number.', code: 'invalid_phone' });

      const contact = await findContactByPhone(req.profile.uid, phone);
      if (!contact) return res.status(404).json({ error: 'No saved contact for that number.' });
      res.json({ contact });
    } catch (err) {
      console.error('[Contacts] Phone lookup failed:', err);
      res.status(500).json({ error: 'Could not look that number up.' });
    }
  });

  // =========================================================================
  // write
  // =========================================================================
  // Saving an already-saved number updates it rather than failing, because from
  // the operator's point of view "save this customer" should be idempotent.
  app.post('/api/contacts', authenticated, async (req, res) => {
    try {
      const parsed = readContactBody(req.body || {}, { requirePhone: true });
      if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });

      const existing = await findContactByPhone(req.profile.uid, parsed.value.phone);
      const contact = await upsertContact(req.profile.uid, {
        tags: [], name: '', ...parsed.value,
      });

      notify(req.profile.uid);
      res.status(existing ? 200 : 201).json({ contact, created: !existing });
    } catch (err) {
      console.error('[Contacts] Save failed:', err);
      res.status(500).json({ error: 'Could not save the contact.' });
    }
  });

  app.patch('/api/contacts/:id', authenticated, async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid contact id.' });

      const parsed = readContactBody(req.body || {}, { requirePhone: false });
      if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });

      const existing = await findContactById(req.profile.uid, id);
      if (!existing) return res.status(404).json({ error: 'Contact not found.' });

      const contact = await updateContact(req.profile.uid, id, parsed.value);
      notify(req.profile.uid);
      res.json({ contact });
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        return res.status(409).json({
          error: 'Another contact already uses that number.',
          code: 'phone_taken',
        });
      }
      console.error('[Contacts] Update failed:', err);
      res.status(500).json({ error: 'Could not update the contact.' });
    }
  });

  app.delete('/api/contacts/:id', authenticated, async (req, res) => {
    try {
      const id = String(req.params.id || '');
      if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'Invalid contact id.' });

      const deleted = await deleteContact(req.profile.uid, id);
      if (!deleted) return res.status(404).json({ error: 'Contact not found.' });

      notify(req.profile.uid);
      res.json({ success: true });
    } catch (err) {
      console.error('[Contacts] Delete failed:', err);
      res.status(500).json({ error: 'Could not delete the contact.' });
    }
  });

  // Bulk delete of an explicit id list. There is deliberately no "delete all"
  // filter: every id is checked against the caller's own rows, so the blast
  // radius is exactly what was ticked in the UI.
  app.post('/api/contacts/delete-bulk', authenticated, async (req, res) => {
    try {
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Select at least one contact.', code: 'no_ids' });
      }
      if (ids.length > 5000) {
        return res.status(400).json({ error: 'Too many contacts in one request.' });
      }

      const removed = await deleteContactsBulk(req.profile.uid, ids);
      notify(req.profile.uid);
      res.json({ success: true, removed });
    } catch (err) {
      console.error('[Contacts] Bulk delete failed:', err);
      res.status(500).json({ error: 'Could not delete those contacts.' });
    }
  });

  // =========================================================================
  // import
  // =========================================================================
  // The client parses the CSV or spreadsheet paste and posts rows, because it can
  // show a preview and let the operator fix the column mapping before anything is
  // written. The server still re-normalises every number and re-checks the shape:
  // the parsed rows are just as untrusted as any other request body.
  app.post('/api/contacts/import', authenticated, async (req, res) => {
    try {
      const incoming = req.body?.contacts;
      if (!Array.isArray(incoming) || incoming.length === 0) {
        return res.status(400).json({ error: 'Nothing to import.', code: 'empty_import' });
      }
      if (incoming.length > 5000) {
        return res.status(400).json({
          error: 'Import up to 5000 contacts at a time.',
          code: 'too_many',
        });
      }

      // De-duplicate within the file itself: Postgres cannot upsert the same
      // (user, phone) twice in one statement, and a spreadsheet with the number
      // repeated is common. The last occurrence wins, matching how a person reads
      // a list top to bottom.
      const byPhone = new Map();
      const invalid = [];

      incoming.forEach((row, index) => {
        const phone = normalizePhone(row?.phone);
        if (!phone) {
          invalid.push({ row: index + 1, phone: String(row?.phone ?? '').slice(0, 40) });
          return;
        }
        byPhone.set(phone, {
          phone,
          name: row?.name,
          email: row?.email,
          company: row?.company,
          note: row?.note,
          tags: Array.isArray(row?.tags)
            ? row.tags
            : String(row?.tags ?? '').split(/[;,|]/).map(t => t.trim()).filter(Boolean),
        });
      });

      if (byPhone.size === 0) {
        return res.status(400).json({
          error: 'No valid phone numbers were found in that file.',
          code: 'no_valid_rows',
          invalid: invalid.slice(0, 20),
        });
      }

      const { created, updated } = await importContacts(req.profile.uid, [...byPhone.values()]);

      console.log(`[Contacts] ${req.profile.email} imported ${created} new and updated ${updated} contact(s); ${invalid.length} row(s) skipped.`);
      notify(req.profile.uid);

      res.json({
        success: true,
        created,
        updated,
        skipped: invalid.length,
        // Enough to point at the offending rows without echoing the whole file.
        invalid: invalid.slice(0, 20),
      });
    } catch (err) {
      console.error('[Contacts] Import failed:', err);
      res.status(500).json({ error: 'Could not import those contacts.' });
    }
  });
}
