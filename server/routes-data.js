// Profile, plan, user-administration, transaction and audit endpoints.
//
// Replaces every Firestore read and write the client performed. The real-time
// behaviour that onSnapshot provided is reproduced by emitting Socket.IO events
// after a successful mutation, reusing the connection the app already holds.
//
// Every authorization rule that lived in firestore.rules is enforced here:
//   - a user may edit only their own name
//   - role, approval, plan and limit overrides are admin-only
//   - the messages_sent counter is server-owned (see consumeMessageQuota)
//   - plans are readable by any signed-in user, writable only by admins

import {
  listUsers, findUserById, updateUser, deleteUser, countAdmins,
  listPlans, findPlanById, upsertPlan, setDefaultPlan, deletePlan, countUsersOnPlan,
  listTransactionsForUser, listAllTransactions,
  listAudit, recordAudit, revokeAllRefreshTokens,
  getChatSettings, listHeldChats, setChatHold, clearChatHold,
} from './data.js';
import { authenticated, admin, clientIp } from './middleware.js';
import { getStore } from './store.js';

// Notify a specific user's open tabs that their profile changed, replacing the
// onSnapshot listener on their user document.
function emitProfile(io, profile) {
  if (!io || !profile) return;
  io.to(profile.uid).emit('profile-updated', profile);
}

// Plan changes affect everyone's resolved limits, so they go to all clients.
function emitPlans(io, plans) {
  if (!io) return;
  io.emit('plans-updated', plans);
}

function parseLimitOverride(value) {
  // null clears the override so the plan applies again — the equivalent of
  // Firestore's deleteField().
  if (value === null) return { ok: true, value: null };
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { ok: false, error: 'Limit must be a whole number of 0 or more, or null to inherit from the plan.' };
  }
  return { ok: true, value: parsed };
}

export function mountDataRoutes(app, io) {
  // =========================================================================
  // profile (self)
  // =========================================================================
  app.get('/api/profile', authenticated, (req, res) => {
    res.json({ user: req.profile });
  });

  // A user may change their display name and nothing else. This is the
  // hasOnly(['name']) rule from firestore.rules, enforced server-side.
  app.patch('/api/profile', authenticated, async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim().slice(0, 120);
      if (!name) {
        return res.status(400).json({ error: 'Name cannot be empty.' });
      }

      const updated = await updateUser(req.profile.uid, { name });
      emitProfile(io, updated);
      res.json({ user: updated });
    } catch (err) {
      console.error('[Profile] Update failed:', err);
      res.status(500).json({ error: 'Could not update the profile.' });
    }
  });

  // =========================================================================
  // plans
  // =========================================================================
  // Readable by any signed-in user: the dashboard resolves its own limits from
  // the catalogue.
  app.get('/api/plans', authenticated, async (req, res) => {
    try {
      res.json({ plans: await listPlans() });
    } catch (err) {
      console.error('[Plans] List failed:', err);
      res.status(500).json({ error: 'Could not load plans.' });
    }
  });

  app.put('/api/admin/plans/:id', admin, async (req, res) => {
    try {
      const id = String(req.params.id || '').trim().toLowerCase();
      if (!/^[a-z0-9_-]{1,40}$/.test(id)) {
        return res.status(400).json({ error: 'Plan id must be 1-40 characters of a-z, 0-9, dash or underscore.' });
      }

      const body = req.body || {};
      const name = String(body.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: 'Plan name is required.' });
      }

      const messageLimit = Number(body.messageLimit);
      const sessionLimit = Number(body.sessionLimit);
      if (!Number.isInteger(messageLimit) || messageLimit < 0) {
        return res.status(400).json({ error: 'messageLimit must be a whole number of 0 or more.' });
      }
      if (!Number.isInteger(sessionLimit) || sessionLimit < 1) {
        return res.status(400).json({ error: 'sessionLimit must be a whole number of 1 or more.' });
      }

      const plan = await upsertPlan({
        id,
        name,
        description: String(body.description || '').slice(0, 500),
        price: Math.max(0, Number(body.price) || 0),
        currency: String(body.currency || 'IDR').slice(0, 8),
        messageLimit,
        sessionLimit,
        trialDays: Math.max(0, Number(body.trialDays) || 0),
        features: Array.isArray(body.features) ? body.features.slice(0, 20).map(f => String(f).slice(0, 200)) : [],
        isDefault: Boolean(body.isDefault),
        archived: Boolean(body.archived),
        sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 100,
      });

      const plans = await listPlans();
      emitPlans(io, plans);

      await recordAudit({
        actorUserId: req.profile.uid, actorEmail: req.profile.email,
        action: 'plan.upsert', detail: { planId: id }, ip: clientIp(req),
      });

      res.json({ plan, plans });
    } catch (err) {
      console.error('[Plans] Upsert failed:', err);
      res.status(500).json({ error: 'Could not save the plan.' });
    }
  });

  app.post('/api/admin/plans/:id/default', admin, async (req, res) => {
    try {
      const plan = await setDefaultPlan(req.params.id);
      if (!plan) return res.status(404).json({ error: 'Plan not found.' });

      const plans = await listPlans();
      emitPlans(io, plans);

      await recordAudit({
        actorUserId: req.profile.uid, actorEmail: req.profile.email,
        action: 'plan.set_default', detail: { planId: req.params.id }, ip: clientIp(req),
      });

      res.json({ plan, plans });
    } catch (err) {
      console.error('[Plans] Set default failed:', err);
      res.status(500).json({ error: 'Could not set the default plan.' });
    }
  });

  app.delete('/api/admin/plans/:id', admin, async (req, res) => {
    try {
      const inUse = await countUsersOnPlan(req.params.id);
      // The FK is ON DELETE SET NULL, so affected users fall back to the default
      // plan's limits rather than breaking. Surface the count so the admin knows.
      const deleted = await deletePlan(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Plan not found.' });

      const plans = await listPlans();
      emitPlans(io, plans);

      await recordAudit({
        actorUserId: req.profile.uid, actorEmail: req.profile.email,
        action: 'plan.delete', detail: { planId: req.params.id, usersAffected: inUse }, ip: clientIp(req),
      });

      res.json({ success: true, usersAffected: inUse, plans });
    } catch (err) {
      console.error('[Plans] Delete failed:', err);
      res.status(500).json({ error: 'Could not delete the plan.' });
    }
  });

  // =========================================================================
  // users (admin)
  // =========================================================================
  app.get('/api/admin/users', admin, async (req, res) => {
    try {
      res.json({ users: await listUsers() });
    } catch (err) {
      console.error('[Admin] User list failed:', err);
      res.status(500).json({ error: 'Could not load the user registry.' });
    }
  });

  app.patch('/api/admin/users/:id', admin, async (req, res) => {
    try {
      const targetId = req.params.id;
      const target = await findUserById(targetId);
      if (!target) return res.status(404).json({ error: 'User not found.' });

      const body = req.body || {};
      const patch = {};

      if (Object.prototype.hasOwnProperty.call(body, 'name')) {
        patch.name = String(body.name || '').trim().slice(0, 120);
      }

      if (Object.prototype.hasOwnProperty.call(body, 'role')) {
        const role = String(body.role);
        if (role !== 'customer' && role !== 'admin') {
          return res.status(400).json({ error: "Role must be 'customer' or 'admin'." });
        }
        if (targetId === req.profile.uid) {
          return res.status(400).json({ error: 'You cannot change your own role.' });
        }
        // Refuse to remove the last admin, which would lock everyone out of the
        // console. Nothing enforced this under Firestore.
        if (target.role === 'admin' && role === 'customer' && (await countAdmins()) <= 1) {
          return res.status(400).json({ error: 'This is the only remaining admin. Promote another account first.' });
        }
        patch.role = role;
        // Promotion implies approval, matching the previous admin panel behaviour.
        if (role === 'admin') patch.isApproved = true;
      }

      if (Object.prototype.hasOwnProperty.call(body, 'isApproved')) {
        if (targetId === req.profile.uid) {
          return res.status(400).json({ error: 'You cannot change your own approval status.' });
        }
        patch.isApproved = Boolean(body.isApproved);
      }

      if (Object.prototype.hasOwnProperty.call(body, 'planId')) {
        const planId = body.planId === null ? null : String(body.planId);
        if (planId !== null && !(await findPlanById(planId))) {
          return res.status(400).json({ error: `Plan "${planId}" does not exist.` });
        }
        patch.planId = planId;
      }

      for (const field of ['messageLimit', 'sessionLimit']) {
        if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
        const parsed = parseLimitOverride(body[field]);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });
        if (field === 'sessionLimit' && parsed.value !== null && parsed.value < 1) {
          return res.status(400).json({ error: 'A user needs at least one device session.' });
        }
        patch[field] = parsed.value;
      }

      if (Object.prototype.hasOwnProperty.call(body, 'messagesSent')) {
        const parsed = Number(body.messagesSent);
        if (!Number.isInteger(parsed) || parsed < 0) {
          return res.status(400).json({ error: 'messagesSent must be a whole number of 0 or more.' });
        }
        patch.messagesSent = parsed;
      }

      if (Object.prototype.hasOwnProperty.call(body, 'trialExpired')) {
        patch.trialExpired = Boolean(body.trialExpired);
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No supported fields to update.' });
      }

      const updated = await updateUser(targetId, patch);

      // Revoking access should end the session, not wait for the token to expire.
      if (patch.isApproved === false || patch.role === 'customer') {
        await revokeAllRefreshTokens(targetId);
      }

      emitProfile(io, updated);

      await recordAudit({
        actorUserId: req.profile.uid, actorEmail: req.profile.email,
        action: 'user.update', targetUserId: targetId,
        detail: { changed: Object.keys(patch), patch }, ip: clientIp(req),
      });

      res.json({ user: updated });
    } catch (err) {
      console.error('[Admin] User update failed:', err);
      res.status(500).json({ error: 'Could not update the user.' });
    }
  });

  app.delete('/api/admin/users/:id', admin, async (req, res) => {
    try {
      const targetId = req.params.id;

      if (targetId === req.profile.uid) {
        return res.status(400).json({ error: 'You cannot delete your own account.' });
      }

      const target = await findUserById(targetId);
      if (!target) return res.status(404).json({ error: 'User not found.' });

      if (target.role === 'admin' && (await countAdmins()) <= 1) {
        return res.status(400).json({ error: 'This is the only remaining admin.' });
      }

      await deleteUser(targetId);

      await recordAudit({
        actorUserId: req.profile.uid, actorEmail: req.profile.email,
        action: 'user.delete', targetUserId: targetId,
        detail: { email: target.email }, ip: clientIp(req),
      });

      // Note: this removes the account row only. WhatsApp credentials under
      // sessions/auth_info_${uid}_* are left in place; use the Live Sessions tab
      // to disconnect the device first if that matters.
      res.json({ success: true });
    } catch (err) {
      console.error('[Admin] User delete failed:', err);
      res.status(500).json({ error: 'Could not delete the user.' });
    }
  });

  // =========================================================================
  // chat hold (suppress automated replies for one conversation)
  // =========================================================================
  // Every chat held in a session, for badging the chat list.
  app.get('/api/chats/hold', authenticated, async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || 'default');
      res.json({ held: await listHeldChats(req.profile.uid, sessionId) });
    } catch (err) {
      console.error('[Hold] List failed:', err);
      res.status(500).json({ error: 'Could not load hold state.' });
    }
  });

  // State of one conversation. Absence of a row means not held, so this always
  // returns an object rather than a 404. The JID is expanded to its @lid/phone
  // equivalents so reading by either form finds the same hold.
  app.get('/api/chats/:jid/hold', authenticated, async (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || 'default');
      const store = getStore(`${req.profile.uid}_${sessionId}`);
      const jids = store.expandHoldJids(req.params.jid);
      res.json(await getChatSettings(req.profile.uid, sessionId, jids));
    } catch (err) {
      console.error('[Hold] Read failed:', err);
      res.status(500).json({ error: 'Could not read hold state.' });
    }
  });

  // Hold or release. The chat JID is whatever the WhatsApp store already knows,
  // so it is not validated against a whitelist — but it is scoped to the caller's
  // own user id, so one customer cannot read or change another's chats.
  //
  // The JID is canonicalised (preferring @lid) so the dashboard and a bot that
  // addresses the conversation by phone JID write the SAME row, and any duplicate
  // @lid/phone row is collapsed.
  app.put('/api/chats/:jid/hold', authenticated, async (req, res) => {
    try {
      const sessionId = String(req.body?.sessionId || req.query.sessionId || 'default');
      const chatJid = req.params.jid;

      if (!chatJid || chatJid.length > 200) {
        return res.status(400).json({ error: 'Invalid chat id.' });
      }

      const botPaused = Boolean(req.body?.botPaused);
      const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;

      const store = getStore(`${req.profile.uid}_${sessionId}`);
      const canonical = store.canonicalHoldJid(chatJid);
      const aliases = store.expandHoldJids(chatJid);

      const settings = await setChatHold(req.profile.uid, sessionId, canonical, {
        botPaused,
        pausedBy: req.profile.name || req.profile.email,
        note,
      });

      // Collapse any duplicate @lid/phone row into the canonical one, so a
      // release cannot leave a stale held row behind.
      for (const alias of aliases) {
        if (alias !== canonical) await clearChatHold(req.profile.uid, sessionId, alias);
      }

      // Push the change to the external agent (Alvi) so it suppresses its own
      // automated replies for this conversation. Fire-and-forget: a down webhook
      // receiver must never fail the hold itself (the state is already durable).
      const webhookUrl = (process.env.AGENT_HOLD_WEBHOOK_URL || '').trim();
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, chatJid: canonical, aliases, botPaused }),
        }).catch((err) => {
          console.warn('[Hold] Webhook notify failed:', err.message);
        });
      }

      // Keep the operator's other tabs, and anyone else watching this account,
      // in step with the change.
      if (io) {
        io.to(req.profile.uid).emit('chat-hold-updated', settings);
      }

      res.json(settings);
    } catch (err) {
      console.error('[Hold] Update failed:', err);
      res.status(500).json({ error: 'Could not update hold state.' });
    }
  });

  // =========================================================================
  // transactions
  // =========================================================================
  app.get('/api/transactions', authenticated, async (req, res) => {
    try {
      res.json(await listTransactionsForUser(req.profile.uid));
    } catch (err) {
      console.error('[Transactions] List failed:', err);
      res.status(500).json({ error: 'Could not load transactions.' });
    }
  });

  app.get('/api/admin/transactions', admin, async (req, res) => {
    try {
      res.json({ transactions: await listAllTransactions() });
    } catch (err) {
      console.error('[Transactions] Admin list failed:', err);
      res.status(500).json({ error: 'Could not load transactions.' });
    }
  });

  // =========================================================================
  // audit log (admin)
  // =========================================================================
  app.get('/api/admin/audit', admin, async (req, res) => {
    try {
      const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
      res.json({ entries: await listAudit(limit) });
    } catch (err) {
      console.error('[Audit] List failed:', err);
      res.status(500).json({ error: 'Could not load the audit log.' });
    }
  });
}
