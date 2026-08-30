// Local authentication: password hashing and token issuance.
//
// Replaces Firebase Auth. Deliberately built on node:crypto alone — the project
// already verified Firebase's JWTs with a hand-rolled verifier, so this keeps
// the same zero-dependency posture and adds no supply-chain surface for the one
// part of the system where a compromised package would be catastrophic.
//
// Design:
//   Passwords      scrypt, with the cost parameters stored alongside the hash so
//                  they can be raised later without invalidating old hashes.
//   Access tokens  short-lived HS256 JWTs, verified on every request. Stateless.
//   Refresh tokens opaque 32-byte random strings, rotated on each use. Only a
//                  SHA-256 hash is persisted, so a database leak cannot be
//                  replayed as a login.

import crypto from 'crypto';

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------
const JWT_SECRET = (process.env.JWT_SECRET || '').trim();
const JWT_ISSUER = (process.env.JWT_ISSUER || 'wa-gateway').trim();

// 15 minutes: short enough that a leaked access token expires quickly, long
// enough to avoid refreshing on every page view.
export const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL || 900);

// 30 days, so a user who visits weekly stays signed in.
export const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);

// Fail loudly at startup rather than issuing tokens signed with a weak or empty
// key. Called from the server's boot sequence.
export function assertAuthConfigured() {
  if (!JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is not set. Generate one with:\n' +
      "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"\n" +
      'and add it to .env. Changing it later signs every user out.'
    );
  }
  if (JWT_SECRET.length < 32) {
    throw new Error(
      `JWT_SECRET is too short (${JWT_SECRET.length} chars). Use at least 32; 64 is better.`
    );
  }
}

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------
// 32 hex characters: filesystem-safe, which matters because Baileys builds
// credential directory names as sessions/auth_info_${uid}_${sessionId}.
export function generateUserId() {
  return crypto.randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// passwords
// ---------------------------------------------------------------------------
// Stored format: scrypt$N$r$p$<salt-b64url>$<hash-b64url>
//
// 128 * N * r bytes of memory per hash: 128 * 32768 * 8 = 32 MiB, so maxmem is
// raised above node's 32 MiB default to leave headroom.
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  // scrypt itself has no length ceiling, but an unbounded input is a cheap way
  // to make the server burn CPU.
  if (password.length > 200) {
    return 'Password must be at most 200 characters.';
  }
  return null;
}

function scryptAsync(password, salt, { N, r, p, keylen, maxmem }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem }, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password) {
  const { N, r, p, keylen, maxmem } = SCRYPT_PARAMS;
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_PARAMS);

  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

// Returns false for any malformed or absent hash rather than throwing, so a
// legacy or imported row cannot crash the login route.
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  // Honour the parameters recorded in the hash, not today's constants, so hashes
  // created under older settings still verify.
  let derived;
  try {
    derived = await scryptAsync(password, salt, {
      N, r, p,
      keylen: expected.length,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
  } catch (err) {
    console.error('[Auth] scrypt verification error:', err.message);
    return false;
  }

  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

// True when a stored hash was produced with weaker parameters than we now use,
// so the caller can transparently re-hash on a successful login.
export function needsRehash(stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  return Number(parts[1]) < SCRYPT_PARAMS.N;
}

// ---------------------------------------------------------------------------
// access tokens (JWT, HS256)
// ---------------------------------------------------------------------------
function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(signingInput) {
  return crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
}

export function signAccessToken({ uid, email, role }) {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: uid,
    email,
    role,
    iss: JWT_ISSUER,
    iat: nowSeconds,
    exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${signingInput}.${signPayload(signingInput)}`;
}

// Returns the payload, or null for any failure. Never throws, so callers can
// treat null as "unauthenticated" without a try/catch.
export function verifyAccessToken(token) {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;

  const expected = signPayload(`${headerB64}.${payloadB64}`);

  // Compare as fixed-length buffers. A length mismatch means it cannot match,
  // and timingSafeEqual throws on differing lengths.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch {
    return null;
  }

  // Reject alg confusion outright: only HS256 is ever issued here.
  if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
  if (payload.iss !== JWT_ISSUER) return null;
  if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
  if (!payload.sub) return null;

  // Mirror the shape the Firebase verifier produced, so downstream routes that
  // read req.user.uid keep working unchanged.
  payload.uid = payload.sub;
  return payload;
}

// ---------------------------------------------------------------------------
// refresh tokens
// ---------------------------------------------------------------------------
export function generateRefreshToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}

// SHA-256 is correct here rather than scrypt: the token is 256 bits of entropy,
// not a low-entropy human secret, so there is nothing to brute force and the
// lookup needs to be fast and indexable.
export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function refreshTokenExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// email
// ---------------------------------------------------------------------------
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  const value = normalizeEmail(email);
  if (value.length < 3 || value.length > 254) return false;
  // Deliberately permissive: one @, no whitespace, a dot in the domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
