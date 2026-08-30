// API client. Replaces src/utils/firebase.js.
//
// Firebase gave us three things the app depended on: a signed-in user, an ID
// token for every request, and automatic token refresh. This module provides the
// same three against our own backend, keeping the fetchWithAuth() signature so
// call sites did not have to change.
//
// Token storage: localStorage. That is the same exposure Firebase's own web SDK
// had (it persists to IndexedDB, equally readable by script), and it is required
// here because the SPA may be served from a different origin than the API, where
// cookies would not be sent. The mitigation is the short access-token lifetime
// plus refresh-token rotation, not the storage location.

import { apiUrl } from './apiBase.js';

const ACCESS_TOKEN_KEY = 'wa.accessToken';
const REFRESH_TOKEN_KEY = 'wa.refreshToken';
const USER_KEY = 'wa.user';

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------
// Wrapped because localStorage throws in private browsing modes and when a
// browser blocks storage for third-party contexts.
function readStored(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Non-fatal: the session simply will not survive a reload.
  }
}

export function getAccessToken() {
  return readStored(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return readStored(REFRESH_TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// auth state
// ---------------------------------------------------------------------------
let currentUser = (() => {
  const raw = readStored(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
})();

let listeners = [];

// Replaces onAuthStateChanged. The listener is called immediately with the
// current value, then on every change.
export function subscribeAuth(listener) {
  listeners.push(listener);
  listener(currentUser);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

function setCurrentUser(user) {
  currentUser = user || null;
  writeStored(USER_KEY, currentUser ? JSON.stringify(currentUser) : null);
  listeners.forEach((listener) => {
    try {
      listener(currentUser);
    } catch (err) {
      console.error('[Api] Auth listener failed:', err);
    }
  });
}

export function getCurrentUser() {
  return currentUser;
}

function storeSession({ user, accessToken, refreshToken }) {
  if (accessToken) writeStored(ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) writeStored(REFRESH_TOKEN_KEY, refreshToken);
  setCurrentUser(user);
  return user;
}

function clearSession() {
  writeStored(ACCESS_TOKEN_KEY, null);
  writeStored(REFRESH_TOKEN_KEY, null);
  setCurrentUser(null);
}

// Locally applied profile update, for the socket 'profile-updated' event. Avoids
// a refetch when the server has already pushed the new row.
export function applyProfileUpdate(user) {
  if (!user || !currentUser || user.uid !== currentUser.uid) return;
  setCurrentUser(user);
}

// ---------------------------------------------------------------------------
// low-level request
// ---------------------------------------------------------------------------
async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get('content-type') || '';

  // A misconfigured host answers unknown /api routes with the SPA's index.html.
  // Parsing that as JSON throws "Unexpected token '<'", so name the real problem.
  if (contentType.includes('text/html')) {
    throw new Error(
      `Backend not reachable: ${apiUrl(path)} returned HTML instead of JSON. ` +
      'Check VITE_API_URL and that the API server is running.'
    );
  }

  let payload = null;
  if (contentType.includes('application/json')) {
    payload = await res.json().catch(() => null);
  }

  if (!res.ok) {
    const error = new Error(payload?.error || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.code = payload?.code;
    error.payload = payload;
    throw error;
  }

  return payload;
}

// ---------------------------------------------------------------------------
// token refresh
// ---------------------------------------------------------------------------
// Several requests can 401 at once when a token expires. They must not each
// consume the single-use refresh token, so the first one starts a refresh and
// the rest await the same promise.
let refreshInFlight = null;

async function refreshSession() {
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearSession();
    return null;
  }

  refreshInFlight = (async () => {
    try {
      const data = await request('/api/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
      });
      storeSession(data);
      return data.accessToken;
    } catch (err) {
      // A rejected refresh token means the session is genuinely over.
      console.info('[Api] Session refresh failed, signing out:', err.message);
      clearSession();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// fetchWithAuth — same surface as the Firebase version
// ---------------------------------------------------------------------------
// Returns the raw Response, because existing callers check res.ok and call
// res.json() themselves.
export async function fetchWithAuth(url, options = {}) {
  const token = getAccessToken();

  const withAuth = (accessToken) => ({
    ...options,
    headers: {
      ...options.headers,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  let res = await fetch(apiUrl(url), withAuth(token));

  // One refresh-and-retry on 401, mirroring what the Firebase helper did with
  // getIdToken(true).
  if (res.status === 401) {
    const fresh = await refreshSession();
    if (fresh) {
      res = await fetch(apiUrl(url), withAuth(fresh));
    }
  }

  const contentType = res.headers.get('content-type') || '';
  if (res.ok && contentType.includes('text/html')) {
    throw new Error(
      `Backend not reachable: ${apiUrl(url)} returned HTML instead of JSON. ` +
      'Set VITE_API_URL to your backend server URL.'
    );
  }

  return res;
}

// JSON convenience wrapper for the newer call sites.
export async function apiFetch(url, options = {}) {
  const res = await fetchWithAuth(url, options);
  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : null;

  if (!res.ok) {
    const error = new Error(payload?.error || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.code = payload?.code;
    throw error;
  }

  return payload;
}

export function apiJson(url, method, body) {
  return apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// auth operations
// ---------------------------------------------------------------------------
export async function register({ name, email, password }) {
  const data = await request('/api/auth/register', {
    method: 'POST',
    body: { name, email, password },
  });
  return storeSession(data);
}

export async function login({ email, password }) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return storeSession(data);
}

export async function logout() {
  const refreshToken = getRefreshToken();
  // Clear locally first: the user is signed out from their point of view even if
  // the network call fails.
  clearSession();
  if (refreshToken) {
    try {
      await request('/api/auth/logout', { method: 'POST', body: { refreshToken } });
    } catch (err) {
      console.info('[Api] Logout request failed (session already cleared):', err.message);
    }
  }
}

export async function changePassword({ currentPassword, newPassword }) {
  const data = await apiJson('/api/auth/change-password', 'POST', { currentPassword, newPassword });
  return storeSession(data);
}

// Restores a session on page load. Replaces Firebase's async persistence
// rehydration: validates the stored token against the server, refreshing once if
// it has expired, and returns the live profile or null.
export async function restoreSession() {
  if (!getAccessToken() && !getRefreshToken()) {
    clearSession();
    return null;
  }

  try {
    const data = await apiFetch('/api/auth/me');
    setCurrentUser(data.user);
    return data.user;
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      clearSession();
      return null;
    }
    // A network or server error is not proof the session is invalid, so keep the
    // cached user and let the app retry rather than bouncing them to the login
    // screen every time the backend hiccups.
    console.warn('[Api] Could not verify the session:', err.message);
    return currentUser;
  }
}

export async function fetchProfile() {
  const data = await apiFetch('/api/profile');
  setCurrentUser(data.user);
  return data.user;
}

export async function updateProfileName(name) {
  const data = await apiJson('/api/profile', 'PATCH', { name });
  setCurrentUser(data.user);
  return data.user;
}

// ---------------------------------------------------------------------------
// plans
// ---------------------------------------------------------------------------
export async function fetchPlans() {
  const data = await apiFetch('/api/plans');
  return data.plans || [];
}

// ---------------------------------------------------------------------------
// contacts (the operator's saved address book)
// ---------------------------------------------------------------------------
// sessionId only affects the derived columns (which conversation a contact maps
// to, and its last message). The contacts themselves are shared across sessions.
export async function fetchContacts(sessionId = 'default') {
  const data = await apiFetch(`/api/contacts?sessionId=${encodeURIComponent(sessionId)}`);
  return data.contacts || [];
}

export async function fetchContactTags() {
  const data = await apiFetch('/api/contacts/tags');
  return data.tags || [];
}

/** Create, or update the contact already saved under this number. */
export async function saveContact(contact) {
  const data = await apiJson('/api/contacts', 'POST', contact);
  return data.contact;
}

export async function updateContact(id, patch) {
  const data = await apiJson(`/api/contacts/${encodeURIComponent(id)}`, 'PATCH', patch);
  return data.contact;
}

export async function deleteContact(id) {
  return apiJson(`/api/contacts/${encodeURIComponent(id)}`, 'DELETE');
}

export async function deleteContactsBulk(ids) {
  return apiJson('/api/contacts/delete-bulk', 'POST', { ids });
}

/** Returns { created, updated, skipped, invalid }. */
export async function importContacts(contacts) {
  return apiJson('/api/contacts/import', 'POST', { contacts });
}

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------
export async function adminListUsers() {
  const data = await apiFetch('/api/admin/users');
  return data.users || [];
}

export async function adminUpdateUser(uid, patch) {
  const data = await apiJson(`/api/admin/users/${encodeURIComponent(uid)}`, 'PATCH', patch);
  return data.user;
}

export async function adminDeleteUser(uid) {
  return apiJson(`/api/admin/users/${encodeURIComponent(uid)}`, 'DELETE');
}

export async function adminSavePlan(plan) {
  const data = await apiJson(`/api/admin/plans/${encodeURIComponent(plan.id)}`, 'PUT', plan);
  return data.plans || [];
}

export async function adminSetDefaultPlan(id) {
  const data = await apiJson(`/api/admin/plans/${encodeURIComponent(id)}/default`, 'POST');
  return data.plans || [];
}

export async function adminDeletePlan(id) {
  const data = await apiJson(`/api/admin/plans/${encodeURIComponent(id)}`, 'DELETE');
  return data.plans || [];
}

export async function adminListTransactions() {
  const data = await apiFetch('/api/admin/transactions');
  return data.transactions || [];
}

export async function adminListAudit(limit = 200) {
  const data = await apiFetch(`/api/admin/audit?limit=${limit}`);
  return data.entries || [];
}
