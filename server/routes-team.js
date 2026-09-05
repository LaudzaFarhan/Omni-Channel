// Team management: a supervisor decides which email addresses can work in their
// account.
//
// Distinct from the admin console. Those routes let a PLATFORM admin administer
// every account; these let a paying customer administer their own staff, and are
// deliberately much narrower. A supervisor can invite, rename, resend and remove —
// they cannot touch a plan, a quota, a limit override or a role, because those are
// what they are billed for and are the platform's to set.
//
// Every query is scoped to req.workspaceId, so one supervisor cannot see or address
// another's people even by guessing an id.

import crypto from 'crypto';
import {
  listWorkspaceMembers, countWorkspaceMembers, findWorkspaceMember,
  setMemberName, deleteWorkspaceMember,
  createInvite, listPendingInvites,
  createUser, emailExists, findUserById,
  resolveSessionLimitFor, revokeAllRefreshTokens, recordAudit,
} from './data.js';
import {
  generateUserId, hashRefreshToken, normalizeEmail, isValidEmail,
} from './auth.js';
import { supervisor, approved, clientIp } from './middleware.js';
import { userRoom } from './scope.js';
import { getWorkspaceTeamPresence, setUserPresence } from './presence.js';

// A week is long enough for someone to get round to it, short enough that a link
// forwarded into a group chat months ago is dead.
const INVITE_TTL_DAYS = 7;

// Where the invite link points. PUBLIC_URL is already used for the post-payment
// return URL, so there is one place to configure the app's public origin.
function publicOrigin() {
  return (process.env.PUBLIC_URL || 'https://app.omnireach.my.id').trim().replace(/\/+$/, '');
}

function inviteLink(token) {
  return `${publicOrigin()}/accept-invite?token=${encodeURIComponent(token)}`;
}

/**
 * Seat arithmetic for a workspace.
 *
 * The supervisor occupies one slot. Buying three agents buys the supervisor plus
 * two colleagues, which matches how the number is presented ("Agent Access Slots:
 * devices that can be signed in at the same time") — the owner is one of the
 * people signing in.
 *
 * A pending invite holds its seat. Otherwise a supervisor with one slot spare
 * could send five invites and let the race decide, which is worse than being told
 * up front.
 */
async function seatUsage(workspaceId) {
  const [limit, members] = await Promise.all([
    resolveSessionLimitFor(workspaceId),
    countWorkspaceMembers(workspaceId),
  ]);

  const used = members + 1; // + the supervisor
  return {
    limit,
    used,
    available: Math.max(0, limit - used),
    members,
  };
}

export function mountTeamRoutes(app, io) {
  // =========================================================================
  // read
  // =========================================================================
  // Everyone with access to this account, plus the seat budget. The supervisor is
  // included and flagged, so the UI can show why one slot is already spent.
  app.get('/api/team', supervisor, async (req, res) => {
    try {
      const [people, invites, seats] = await Promise.all([
        listWorkspaceMembers(req.workspaceId),
        listPendingInvites(req.workspaceId),
        seatUsage(req.workspaceId),
      ]);

      const inviteByUser = new Map(invites.map(i => [i.userId, i]));

      res.json({
        seats,
        members: people.map((person) => {
          const invite = inviteByUser.get(person.uid);
          return {
            uid: person.uid,
            email: person.email,
            name: person.name,
            isSupervisor: person.isSupervisor,
            isSelf: person.uid === req.profile.uid,
            createdAt: person.createdAt,
            lastLoginAt: person.lastLoginAt,
            // An invited member has no password until they accept. `hasPassword`
            // comes from listWorkspaceMembers, which reports only whether one
            // exists — never the hash.
            status: person.isSupervisor
              ? 'owner'
              : person.hasPassword ? 'active'
              : invite ? 'invited'
              : 'expired',
            inviteExpiresAt: invite ? invite.expiresAt : null,
          };
        }),
      });
    } catch (err) {
      console.error('[Team] List failed:', err);
      res.status(500).json({ error: 'Could not load the team.' });
    }
  });

  // =========================================================================
  // invite
  // =========================================================================
  // Creates the member's account immediately, with no password, and returns a
  // one-time link that lets them set one.
  //
  // The row exists from this moment so the address is reserved and the seat is
  // accounted for. There is no mail capability in this deployment, so the link is
  // returned to the supervisor to pass on — for a WhatsApp product that is a
  // reasonable channel, and it means the supervisor never learns the password the
  // member chooses.
  app.post('/api/team/invite', supervisor, async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const name = String(req.body?.name || '').trim().slice(0, 120);

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Enter a valid email address.', code: 'invalid_email' });
      }

      const seats = await seatUsage(req.workspaceId);
      if (seats.available <= 0) {
        return res.status(409).json({
          error: seats.limit === 1
            ? 'Your plan includes a single agent slot, which you are using. Add an agent to invite someone.'
            : `All ${seats.limit} agent slots are taken. Add an agent on the Subscription page, or remove someone first.`,
          code: 'no_seats_available',
          seats,
        });
      }

      // One global email namespace, because everyone signs in at the same login
      // form. A rejection here is deliberately specific — unlike the login route,
      // there is nothing to enumerate: the caller is authenticated and is being
      // told about their own team.
      if (await emailExists(email)) {
        return res.status(409).json({
          error: 'That email already has an account on this platform.',
          code: 'email_taken',
        });
      }

      const member = await createUser({
        id: generateUserId(),
        email,
        name: name || email.split('@')[0],
        // No password yet. The accept-invite route sets the first one, and login
        // already refuses a row with a null hash.
        passwordHash: null,
        role: 'customer',
        // The supervisor vouched for them, so no platform admin has to approve a
        // second time. The workspace's own approval still gates them on every
        // request (see requireApproved).
        isApproved: true,
        // Deliberately null: limits resolve from the WORKSPACE. A plan on a
        // member's row would give them a second free message allowance.
        planId: null,
        ownerUserId: req.workspaceId,
      });

      const token = crypto.randomBytes(32).toString('base64url');
      await createInvite({
        userId: member.uid,
        workspaceId: req.workspaceId,
        email,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
        invitedBy: req.profile.uid,
      });

      await recordAudit({
        actorUserId: req.profile.uid, actorEmail: req.profile.email,
        action: 'team.invite', targetUserId: member.uid,
        detail: { email, workspaceId: req.workspaceId }, ip: clientIp(req),
      });

      console.log(`[Team] ${req.profile.email} invited ${email} to workspace ${req.workspaceId}.`);

      res.status(201).json({
        member: { uid: member.uid, email: member.email, name: member.name, status: 'invited' },
        // Shown once. Only the hash is stored, so this cannot be recovered later —
        // a lost link is replaced by resending, which invalidates the old one.
        inviteUrl: inviteLink(token),
        expiresInDays: INVITE_TTL_DAYS,
        seats: await seatUsage(req.workspaceId),
      });
    } catch (err) {
      console.error('[Team] Invite failed:', err);
      res.status(500).json({ error: 'Could not send the invitation.' });
    }
  });

  // A fresh link for someone who lost theirs or let it expire. Supersedes the
  // previous token, so the old link stops working.
  app.post('/api/team/:id/resend', supervisor, async (req, res) => {
    try {
      const member = await findWorkspaceMember(req.workspaceId, req.params.id);
      if (!member) return res.status(404).json({ error: 'No such team member.' });

      const full = await findUserById(member.uid);
      if (!full) return res.status(404).json({ error: 'No such team member.' });

      const token = crypto.randomBytes(32).toString('base64url');
      await createInvite({
        userId: member.uid,
        workspaceId: req.workspaceId,
        email: member.email,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
        invitedBy: req.profile.uid,
      });

      await recordAudit({
        actorUserId: req.profile.uid, actorEmail: req.profile.email,
        action: 'team.invite_resend', targetUserId: member.uid,
        detail: { email: member.email }, ip: clientIp(req),
      });

      res.json({ inviteUrl: inviteLink(token), expiresInDays: INVITE_TTL_DAYS });
    } catch (err) {
      console.error('[Team] Resend failed:', err);
      res.status(500).json({ error: 'Could not create a new invitation link.' });
    }
  });

  // =========================================================================
  // update
  // =========================================================================
  // Display name only. Everything else about a member either belongs to them
  // (their password) or to the platform (role, plan, limits).
  app.patch('/api/team/:id', supervisor, async (req, res) => {
    try {
      const name = String(req.body?.name ?? '').trim().slice(0, 120);
      if (!name) return res.status(400).json({ error: 'Name cannot be empty.' });

      const updated = await setMemberName(req.workspaceId, req.params.id, name);
      if (!updated) return res.status(404).json({ error: 'No such team member.' });

      // Their own tabs, not the workspace: this is their profile row.
      if (io) io.to(userRoom(updated.uid)).emit('profile-updated', updated);

      res.json({ member: { uid: updated.uid, email: updated.email, name: updated.name } });
    } catch (err) {
      console.error('[Team] Rename failed:', err);
      res.status(500).json({ error: 'Could not rename that member.' });
    }
  });

  // =========================================================================
  // remove
  // =========================================================================
  // Deletes the account and cuts the person off immediately.
  //
  // Three things have to happen, and only the first is automatic: the row goes
  // (taking their refresh tokens and any outstanding invite with it via CASCADE),
  // then their live sockets have to be closed, because a connected socket keeps
  // receiving workspace events until something disconnects it. Waiting for the
  // access token to expire would leave a removed agent reading the team's messages
  // for up to fifteen minutes.
  app.delete('/api/team/:id', supervisor, async (req, res) => {
    try {
      const member = await findWorkspaceMember(req.workspaceId, req.params.id);
      if (!member) return res.status(404).json({ error: 'No such team member.' });

      await revokeAllRefreshTokens(member.uid);
      await deleteWorkspaceMember(req.workspaceId, member.uid);

      // Close anything they still have open.
      if (io) {
        const room = io.sockets.adapter.rooms.get(userRoom(member.uid));
        if (room) {
          for (const socketId of [...room]) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.emit('access-revoked', {
                message: 'Your access to this account has been removed.',
              });
              socket.disconnect(true);
            }
          }
        }
      }

      await recordAudit({
        actorUserId: req.profile.uid, actorEmail: req.profile.email,
        action: 'team.remove', targetUserId: member.uid,
        detail: { email: member.email, workspaceId: req.workspaceId }, ip: clientIp(req),
      });

      console.log(`[Team] ${req.profile.email} removed ${member.email} from workspace ${req.workspaceId}.`);

      res.json({ success: true, seats: await seatUsage(req.workspaceId) });
    } catch (err) {
      console.error('[Team] Remove failed:', err);
      res.status(500).json({ error: 'Could not remove that member.' });
    }
  });

  // =========================================================================
  // presence (accessible to everyone in the workspace: supervisor + agents)
  // =========================================================================
  app.get('/api/team/presence', approved, async (req, res) => {
    try {
      const data = await getWorkspaceTeamPresence(req.workspaceId);
      res.json(data);
    } catch (err) {
      console.error('[Team] Get presence failed:', err);
      res.status(500).json({ error: 'Could not load team presence.' });
    }
  });

  app.post('/api/team/presence', approved, async (req, res) => {
    try {
      const status = req.body?.status;
      if (!['online', 'away'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be online or away. Offline is automatic when tab is closed.' });
      }
      await setUserPresence(req.workspaceId, req.profile.uid, status, io);
      res.json({ success: true, status });
    } catch (err) {
      console.error('[Team] Set presence failed:', err);
      res.status(500).json({ error: 'Could not update presence.' });
    }
  });
}

export { seatUsage };
