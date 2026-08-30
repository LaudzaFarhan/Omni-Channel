// Authentication endpoints: register, login, refresh, logout, change password.
//
// Replaces Firebase Auth's client SDK calls. The access token is returned in the
// response body (the client keeps it in memory / localStorage, exactly as it did
// with Firebase ID tokens); the refresh token is also returned so the SPA can
// renew without re-prompting.

import {
  hashPassword, verifyPassword, needsRehash, validatePassword,
  signAccessToken, generateRefreshToken, generateUserId,
  normalizeEmail, isValidEmail, ACCESS_TOKEN_TTL_SECONDS,
  hashRefreshToken,
} from './auth.js';
import {
  findUserForLogin, findUserById, emailExists, createUser, countUsers,
  setPasswordHash, recordLogin, mapUser, getDefaultPlan,
  storeRefreshToken, findValidRefreshToken, revokeRefreshToken,
  revokeAllRefreshTokens, recordAudit,
  findPendingInviteByTokenHash, markInviteAccepted, setMemberName,
} from './data.js';
import { authenticated, rateLimit, clientIp } from './middleware.js';

// Addresses that become admins on registration. Same list as before, now the
// only place it lives on the server.
const BUILT_IN_ADMIN_EMAILS = ['owner@admin.com', 'adminthelab@gmail.com'];

function adminEmails() {
  const fromEnv = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...BUILT_IN_ADMIN_EMAILS, ...fromEnv]);
}

function isAdminEmail(email) {
  return adminEmails().has(normalizeEmail(email));
}

// Shape returned on any successful authentication.
function authResponse(profile, accessToken, refreshToken) {
  return {
    user: profile,
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

async function issueTokens(profile, req) {
  const accessToken = signAccessToken({
    uid: profile.uid,
    email: profile.email,
    role: profile.role,
  });

  const { token: refreshToken, tokenHash } = generateRefreshToken();
  await storeRefreshToken({
    userId: profile.uid,
    tokenHash,
    userAgent: req.headers['user-agent'],
    ip: clientIp(req),
  });

  return { accessToken, refreshToken };
}

export function mountAuthRoutes(app) {
  // -------------------------------------------------------------------------
  // POST /api/auth/register
  // -------------------------------------------------------------------------
  app.post(
    '/api/auth/register',
    rateLimit({ key: 'register', max: 10, windowMs: 60 * 60 * 1000 }),
    async (req, res) => {
      try {
        const { name, email, password } = req.body || {};

        if (!isValidEmail(email)) {
          return res.status(400).json({ error: 'Enter a valid email address.' });
        }

        const passwordError = validatePassword(password);
        if (passwordError) {
          return res.status(400).json({ error: passwordError });
        }

        const displayName = String(name || '').trim().slice(0, 120);
        if (!displayName) {
          return res.status(400).json({ error: 'Name is required.' });
        }

        const normalizedEmail = normalizeEmail(email);

        if (await emailExists(normalizedEmail)) {
          return res.status(409).json({ error: 'This email is already in use.' });
        }

        const isAdmin = isAdminEmail(normalizedEmail);

        // The very first account bootstraps as an approved admin, so a fresh
        // deployment is usable without hand-editing the database.
        const isFirstAccount = (await countUsers()) === 0;
        const role = isAdmin || isFirstAccount ? 'admin' : 'customer';

        const defaultPlan = await getDefaultPlan();

        const profile = await createUser({
          id: generateUserId(),
          email: normalizedEmail,
          name: displayName,
          passwordHash: await hashPassword(password),
          role,
          isApproved: role === 'admin',
          // Limits are inherited from the plan; no per-user override is written,
          // so a later change to the plan applies to this account too.
          planId: defaultPlan ? defaultPlan.id : null,
        });

        const { accessToken, refreshToken } = await issueTokens(profile, req);

        await recordAudit({
          actorUserId: profile.uid,
          actorEmail: profile.email,
          action: 'auth.register',
          targetUserId: profile.uid,
          detail: { role, bootstrapped: isFirstAccount },
          ip: clientIp(req),
        });

        if (isFirstAccount) {
          console.log(`[Auth] First account created (${normalizedEmail}) — bootstrapped as approved admin.`);
        }

        res.status(201).json(authResponse(profile, accessToken, refreshToken));
      } catch (err) {
        console.error('[Auth] Registration failed:', err);
        res.status(500).json({ error: 'Could not create the account.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /api/auth/login
  // -------------------------------------------------------------------------
  app.post(
    '/api/auth/login',
    rateLimit({ key: 'login', max: 20, windowMs: 15 * 60 * 1000 }),
    async (req, res) => {
      try {
        const { email, password } = req.body || {};

        if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required.' });
        }

        const row = await findUserForLogin(normalizeEmail(email));

        // One generic message for "no such user" and "wrong password", so the
        // endpoint cannot be used to enumerate registered addresses. The scrypt
        // work is still performed on a miss to keep the timing comparable.
        const invalid = () => res.status(401).json({ error: 'Invalid email or password.' });

        if (!row || !row.password_hash) {
          await hashPassword(String(password));
          if (row && !row.password_hash) {
            return res.status(403).json({
              error: 'This account needs a new password. Ask an administrator to reset it.',
              code: 'password_reset_required',
            });
          }
          return invalid();
        }

        if (!(await verifyPassword(password, row.password_hash))) {
          return invalid();
        }

        if (row.must_reset_password) {
          return res.status(403).json({
            error: 'This account must set a new password before signing in.',
            code: 'password_reset_required',
          });
        }

        const profile = mapUser(row);

        // Transparently upgrade hashes created with weaker parameters.
        if (needsRehash(row.password_hash)) {
          await setPasswordHash(profile.uid, await hashPassword(password));
          console.log(`[Auth] Re-hashed password for ${profile.email} at current cost.`);
        }

        await recordLogin(profile.uid);
        const { accessToken, refreshToken } = await issueTokens(profile, req);

        res.json(authResponse(profile, accessToken, refreshToken));
      } catch (err) {
        console.error('[Auth] Login failed:', err);
        res.status(500).json({ error: 'Could not sign in.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /api/auth/refresh
  // -------------------------------------------------------------------------
  // Refresh tokens rotate: the presented token is revoked and a new one issued.
  // A replayed token therefore fails, which surfaces theft rather than silently
  // allowing two live sessions.
  app.post(
    '/api/auth/refresh',
    rateLimit({ key: 'refresh', max: 120, windowMs: 15 * 60 * 1000 }),
    async (req, res) => {
      try {
        const { refreshToken } = req.body || {};
        if (!refreshToken) {
          return res.status(400).json({ error: 'refreshToken is required' });
        }

        const stored = await findValidRefreshToken(refreshToken);
        if (!stored) {
          return res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'refresh_invalid' });
        }

        const profile = await findUserById(stored.user_id);
        if (!profile) {
          await revokeRefreshToken(refreshToken);
          return res.status(401).json({ error: 'Account no longer exists.', code: 'account_missing' });
        }

        await revokeRefreshToken(refreshToken);
        const tokens = await issueTokens(profile, req);

        res.json(authResponse(profile, tokens.accessToken, tokens.refreshToken));
      } catch (err) {
        console.error('[Auth] Refresh failed:', err);
        res.status(500).json({ error: 'Could not refresh the session.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // POST /api/auth/logout
  // -------------------------------------------------------------------------
  // Unauthenticated on purpose: an expired access token must still be able to
  // clean up its refresh token.
  app.post('/api/auth/logout', async (req, res) => {
    try {
      const { refreshToken } = req.body || {};
      if (refreshToken) await revokeRefreshToken(refreshToken);
      res.json({ success: true });
    } catch (err) {
      console.error('[Auth] Logout failed:', err);
      // Never block a sign-out; the client discards its tokens regardless.
      res.json({ success: true });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/auth/invite/:token — is this link still good?
  // -------------------------------------------------------------------------
  // Unauthenticated: the whole point is that the recipient has no account yet.
  // Returns the email the invite was issued for so the accept form can show who it
  // is for, and the inviting account's name so the person can tell whether they
  // recognise it. Nothing else — an invite token is a bearer credential and must
  // not reveal the workspace's data.
  app.get('/api/auth/invite/:token', rateLimit({ key: 'invite_lookup', max: 60 }), async (req, res) => {
    try {
      const invite = await findPendingInviteByTokenHash(hashRefreshToken(req.params.token));
      if (!invite) {
        return res.status(404).json({
          error: 'This invitation link has expired or has already been used. Ask for a new one.',
          code: 'invite_invalid',
        });
      }

      const [member, workspace] = await Promise.all([
        findUserById(invite.userId),
        findUserById(invite.workspaceId),
      ]);

      if (!member || !workspace) {
        return res.status(404).json({ error: 'This invitation is no longer valid.', code: 'invite_invalid' });
      }

      res.json({
        email: invite.email,
        name: member.name,
        invitedBy: workspace.name || workspace.email,
        expiresAt: invite.expiresAt,
      });
    } catch (err) {
      console.error('[Auth] Invite lookup failed:', err);
      res.status(500).json({ error: 'Could not check that invitation.' });
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/accept-invite
  // -------------------------------------------------------------------------
  // Sets an invited member's first password and signs them in.
  //
  // This is also the fix for a pre-existing dead end. A row with a null
  // password_hash, or with must_reset_password set, made login return 403
  // password_reset_required — and no endpoint could clear either without first
  // signing in successfully. Such an account was simply locked out. Now there is a
  // route that takes a token instead of a password.
  //
  // The token is the only authentication, so it is treated like one: hashed for
  // lookup, single use (marked accepted in the same request), and rate limited.
  app.post(
    '/api/auth/accept-invite',
    rateLimit({ key: 'accept_invite', max: 20, windowMs: 60 * 60 * 1000 }),
    async (req, res) => {
      try {
        const { token, password, name } = req.body || {};
        if (!token) {
          return res.status(400).json({ error: 'This link is missing its invitation token.', code: 'invite_invalid' });
        }

        const passwordError = validatePassword(password);
        if (passwordError) {
          return res.status(400).json({ error: passwordError });
        }

        const invite = await findPendingInviteByTokenHash(hashRefreshToken(token));
        if (!invite) {
          return res.status(404).json({
            error: 'This invitation link has expired or has already been used. Ask for a new one.',
            code: 'invite_invalid',
          });
        }

        const member = await findUserById(invite.userId);
        if (!member) {
          return res.status(404).json({ error: 'This invitation is no longer valid.', code: 'invite_invalid' });
        }

        // Refuse to re-set a password through an invite. Once someone has one, the
        // change-password route is the only way to alter it, which keeps a stale
        // link from being an account takeover.
        const row = await findUserForLogin(member.email);
        if (row && row.password_hash) {
          await markInviteAccepted(invite.id);
          return res.status(409).json({
            error: 'This account already has a password. Sign in instead, or use "forgot password".',
            code: 'already_accepted',
          });
        }

        // setPasswordHash also clears must_reset_password.
        await setPasswordHash(member.uid, await hashPassword(password));

        // They may correct the name the supervisor typed for them.
        const displayName = String(name || '').trim().slice(0, 120);
        const profile = (displayName && displayName !== member.name
          ? await setMemberName(invite.workspaceId, member.uid, displayName)
          : null) || member;

        await markInviteAccepted(invite.id);
        await recordLogin(profile.uid);

        await recordAudit({
          actorUserId: profile.uid, actorEmail: profile.email,
          action: 'team.invite_accepted', targetUserId: profile.uid,
          detail: { workspaceId: invite.workspaceId }, ip: clientIp(req),
        });

        console.log(`[Team] ${profile.email} accepted their invitation to workspace ${invite.workspaceId}.`);

        const { accessToken, refreshToken } = await issueTokens(profile, req);
        res.json(authResponse(profile, accessToken, refreshToken));
      } catch (err) {
        console.error('[Auth] Accept invite failed:', err);
        res.status(500).json({ error: 'Could not set up the account.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // GET /api/auth/me
  // -------------------------------------------------------------------------
  app.get('/api/auth/me', authenticated, (req, res) => {
    res.json({ user: req.profile });
  });

  // -------------------------------------------------------------------------
  // POST /api/auth/change-password
  // -------------------------------------------------------------------------
  app.post('/api/auth/change-password', authenticated, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};

      const passwordError = validatePassword(newPassword);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }

      const row = await findUserForLogin(req.profile.email);
      if (!row || !row.password_hash || !(await verifyPassword(currentPassword, row.password_hash))) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }

      await setPasswordHash(req.profile.uid, await hashPassword(newPassword));

      // Changing a password invalidates every other session.
      const revoked = await revokeAllRefreshTokens(req.profile.uid);

      await recordAudit({
        actorUserId: req.profile.uid,
        actorEmail: req.profile.email,
        action: 'auth.change_password',
        targetUserId: req.profile.uid,
        detail: { sessionsRevoked: revoked },
        ip: clientIp(req),
      });

      // Issue a fresh pair so the current tab stays signed in.
      const tokens = await issueTokens(req.profile, req);
      res.json(authResponse(req.profile, tokens.accessToken, tokens.refreshToken));
    } catch (err) {
      console.error('[Auth] Password change failed:', err);
      res.status(500).json({ error: 'Could not change the password.' });
    }
  });
}

export { isAdminEmail };
