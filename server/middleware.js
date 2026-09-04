// Request authentication and authorization.
//
// Replaces two things at once: the Firebase ID token verifier, and
// firestore.rules. Every authorization decision that used to live in the rules
// file is now enforced here, server-side, which also closes the gap where the
// admin console's authority came from client-side role checks.

import { verifyAccessToken } from './auth.js';
import {
  findUserById, resolveFeaturesForWorkspace, findApiKeyByRawKey, touchApiKeyLastUsed,
  isSubscriptionExpired,
} from './data.js';
import { isEnabled } from './features.js';

// Attaches req.user from the Bearer token or X-API-Key. The payload keeps the same shape the
// Firebase verifier produced (notably req.user.uid), so existing routes are
// unchanged.
export async function authMiddleware(req, res, next) {
  const customApiKeyHeader = req.headers['x-api-key'];
  const authHeader = req.headers.authorization;

  // 1. Check for API key (via X-API-Key header or Bearer wapi_...)
  let presentedApiKey = null;
  if (customApiKeyHeader && typeof customApiKeyHeader === 'string' && customApiKeyHeader.startsWith('wapi_')) {
    presentedApiKey = customApiKeyHeader.trim();
  } else if (authHeader && authHeader.startsWith('Bearer wapi_')) {
    presentedApiKey = authHeader.slice('Bearer '.length).trim();
  }

  if (presentedApiKey) {
    try {
      const keyRecord = await findApiKeyByRawKey(presentedApiKey);
      if (!keyRecord) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or revoked API key', code: 'api_key_invalid' });
      }

      // Mark last used asynchronously
      touchApiKeyLastUsed(keyRecord.id);

      req.user = {
        uid: keyRecord.userId,
        role: 'customer',
        isApiKey: true,
        apiKeyId: keyRecord.id,
        scopes: keyRecord.scopes,
      };
      return next();
    } catch (err) {
      console.error('[Auth] API Key lookup error:', err.message);
      return res.status(500).json({ error: 'Internal server error during authentication' });
    }
  }

  // 2. Standard JWT access token authentication
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token or API key' });
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

  if (req.workspace && req.workspace.uid !== req.profile.uid) {
    if (!req.workspace.isApproved) {
      return res.status(403).json({
        error: 'The account that invited you is pending administrator approval.',
        code: 'workspace_not_approved',
      });
    }

    // A live paid window supersedes the trial flag, for the same reason the client does
    // this: an owner who paid after their trial lapsed is paid up, and their team must not
    // stay locked out waiting for somebody to clear a boolean.
    const paidUpTo = req.workspace.subscriptionEndsAt;
    const paidAndActive = Boolean(paidUpTo) && !isSubscriptionExpired(paidUpTo);

    if (req.workspace.trialExpired && !paidAndActive) {
      return res.status(403).json({
        error: `Your workspace subscription or trial for ${req.workspace.name || req.workspace.email} has expired. Please ask your workspace owner to renew.`,
        code: 'workspace_subscription_expired',
      });
    }

    // The paid window itself closing. Checked as a DATE, not a flag: nothing sweeps the
    // database to mark lapsed accounts, so a gate that only read a boolean would let an
    // expired workspace keep working indefinitely.
    if (isSubscriptionExpired(paidUpTo)) {
      return res.status(403).json({
        error: `The subscription for ${req.workspace.name || req.workspace.email} ended. Please ask your workspace owner to renew.`,
        code: 'workspace_subscription_expired',
      });
    }
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

// Gates a route on a feature being released for this account.
//
// Hiding a feature in the sidebar is presentation; without this the endpoint behind it is
// still open to anyone who knows the URL, so "hidden" would be a suggestion rather than a
// rule. A parameterised factory for the same reason rateLimit() is one — the flag key is
// per-route configuration, not per-request state.
//
// Resolved against req.workspaceId, so a member is gated exactly like the account owner.
// Must be mounted after loadProfile, which is what sets that.
//
// Fails OPEN on a database error: an unreachable flag table should not take working
// features offline. The failure is logged loudly instead.
export function requireFeature(key) {
  return async (req, res, next) => {
    // An admin is not a customer of the rollout. They need every endpoint reachable to
    // support the accounts they are gating, and requireApproved already treats them this
    // way.
    if (req.profile?.role === 'admin') return next();

    try {
      const resolved = await resolveFeaturesForWorkspace(req.workspaceId);
      if (isEnabled(resolved, key)) return next();

      // 'coming_soon' and 'hidden' are both unusable, and the client already knows which
      // it is from /api/features — so the code is the same and the copy stays generic
      // rather than leaking a roadmap to someone who cannot see the feature.
      return res.status(403).json({
        error: 'That feature is not available on this account.',
        code: 'feature_unavailable',
        feature: key,
      });
    } catch (err) {
      console.error(`[Features] Gate "${key}" could not be resolved, allowing:`, err.message);
      next();
    }
  };
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

// Chains that additionally require a feature to be released for the account. Composed from
// the existing chains rather than hand-rolled, so a change to approval or ownership rules
// cannot apply to some routes and not others.
export const approvedFeature = (key) => [...approved, requireFeature(key)];
export const supervisorFeature = (key) => [...supervisor, requireFeature(key)];

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
