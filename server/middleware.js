// Request authentication and authorization.
//
// Replaces two things at once: the Firebase ID token verifier, and
// firestore.rules. Every authorization decision that used to live in the rules
// file is now enforced here, server-side, which also closes the gap where the
// admin console's authority came from client-side role checks.

import { verifyAccessToken } from './auth.js';
import { findUserById } from './data.js';

// Attaches req.user from the Bearer token. The payload keeps the same shape the
// Firebase verifier produced (notably req.user.uid), so existing routes are
// unchanged.
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const decoded = verifyAccessToken(authHeader.slice('Bearer '.length));
  if (!decoded) {
    // 401 with this code tells the client to try its refresh token once.
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token', code: 'token_invalid' });
  }

  req.user = decoded;
  next();
}

// Loads the live database row, and resolves which workspace the caller acts in.
//
// The access token carries a role claim, but it is up to 15 minutes stale —
// anything that depends on current state (approval, role, quota) must read the row
// rather than trust the claim. The same argument rules out putting the workspace
// id in the token: a member removed from a team would keep acting inside it until
// their access token expired.
//
// Two identities come out of this and the distinction matters everywhere:
//
//   req.profile.uid   WHO is calling. Their own name, email, password, audit trail.
//   req.workspaceId   WHOSE DATA they are working on. For a supervisor these are
//                     the same value; for an invited member the workspace id is
//                     their supervisor's. Every WhatsApp session, chat, contact,
//                     hold row and message quota is keyed by the workspace id.
//
// Getting that substitution wrong in either direction is a bug with teeth: using
// the member's id where the workspace belongs gives them an empty parallel tenant,
// and using the workspace id where the member belongs would let one colleague
// change another's password.
export async function loadProfile(req, res, next) {
  try {
    const profile = await findUserById(req.user.uid);
    if (!profile) {
      // The account was deleted while a valid token was still in flight.
      return res.status(401).json({ error: 'Account no longer exists', code: 'account_missing' });
    }

    req.profile = profile;
    req.workspaceId = profile.workspaceId;

    // The row that owns the plan, the quota and the seats. A supervisor is their
    // own workspace, so the common case costs no extra query.
    if (profile.ownerUserId) {
      const owner = await findUserById(profile.ownerUserId);
      if (!owner) {
        // CASCADE should make this unreachable, but a member whose supervisor is
        // gone must not fall back to acting as their own tenant.
        console.warn(`[Auth] Member ${profile.email} has no surviving supervisor (${profile.ownerUserId}).`);
        return res.status(403).json({
          error: 'The account that invited you no longer exists.',
          code: 'workspace_missing',
        });
      }
      req.workspace = owner;
    } else {
      req.workspace = profile;
    }

    next();
  } catch (err) {
    console.error('[Auth] Failed to load profile:', err.message);
    res.status(503).json({ error: 'Database unavailable' });
  }
}

// Gates the WhatsApp and messaging routes on admin approval.
//
// Under Firestore this was never enforced server-side: revoking a customer in
// the admin panel left their existing session able to keep sending until they
// reloaded. Now a revoked account is refused on the next request.
//
// Both rows are checked. A member's own approval is not enough: if a platform
// admin revokes the SUPERVISOR, the whole workspace has to go dark, otherwise
// suspending an account would leave its staff still sending messages on it.
export function requireApproved(req, res, next) {
  if (req.profile.role === 'admin') return next();

  if (!req.profile.isApproved) {
    return res.status(403).json({
      error: 'Your account is pending administrator approval.',
      code: 'not_approved',
    });
  }

  if (req.workspace && req.workspace.uid !== req.profile.uid && !req.workspace.isApproved) {
    return res.status(403).json({
      error: 'The account that invited you is pending administrator approval.',
      code: 'workspace_not_approved',
    });
  }

  next();
}

// Restricts an action to the person who owns the workspace.
//
// Used for anything that spends money or that would disrupt every other member:
// buying a plan, reading billing history, managing the team, and unpairing the
// shared WhatsApp device. A platform admin is not automatically a supervisor of
// someone else's workspace, so this checks ownership rather than role.
export function requireSupervisor(req, res, next) {
  if (req.profile.ownerUserId) {
    return res.status(403).json({
      error: 'Only the account owner can do that. Ask your supervisor.',
      code: 'supervisor_only',
    });
  }
  next();
}

// Admin gate. Requires the stored role, read live from the database rather than
// taken from the token claim, so a demotion takes effect immediately.
export function requireAdmin(req, res, next) {
  if (req.profile.role !== 'admin') {
    console.warn(`[Admin] Rejected ${req.method} ${req.path} for ${req.profile.email} (role: ${req.profile.role})`);
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  next();
}

// Convenience: authenticate, load the row, and require approval.
export const authenticated = [authMiddleware, loadProfile];
export const approved = [authMiddleware, loadProfile, requireApproved];
export const admin = [authMiddleware, loadProfile, requireAdmin];

// Approved AND owns the workspace. For billing, team management, and unpairing
// the WhatsApp device everyone shares.
export const supervisor = [authMiddleware, loadProfile, requireApproved, requireSupervisor];

// ---------------------------------------------------------------------------
// rate limiting
// ---------------------------------------------------------------------------
// A fixed-window counter held in memory. Enough to blunt credential stuffing
// against /api/auth/login, which Firebase used to absorb for us. Resets on
// restart and is per-process, which is fine for a single pm2 fork instance.
const buckets = new Map();

export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, key = 'default' } = {}) {
  return (req, res, next) => {
    // Behind nginx the direct socket address is the proxy, so prefer the
    // forwarded header. Only the first entry is meaningful.
    const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || req.socket.remoteAddress || 'unknown';
    const bucketKey = `${key}:${ip}`;
    const now = Date.now();

    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      console.warn(`[RateLimit] ${ip} exceeded ${key} (${bucket.count}/${max})`);
      return res.status(429).json({
        error: 'Too many attempts. Please wait and try again.',
        retryAfterSeconds: retryAfter,
      });
    }

    next();
  };
}

// Keep the map from growing without bound on a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

// Client IP for audit rows, using the same forwarded-header logic.
export function clientIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || null;
}
