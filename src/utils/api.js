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
// team seats (supervisor-facing)
// ---------------------------------------------------------------------------
// Returns { seats: { limit, used, available, members }, members: [...] }.
// The supervisor is included in `members` with isSupervisor true, because they
// occupy one of the seats.
export async function fetchTeam() {
  return apiFetch('/api/team');
}

/**
 * Invite an email address into the account.
 *
 * The `inviteUrl` in the response is shown ONCE — only a hash of the token is
 * stored, so it cannot be retrieved again. Losing it means resending, which
 * invalidates the previous link.
 */
export async function inviteMember({ email, name }) {
  return apiJson('/api/team/invite', 'POST', { email, name });
}

export async function resendInvite(memberId) {
  return apiJson(`/api/team/${encodeURIComponent(memberId)}/resend`, 'POST');
}

export async function renameMember(memberId, name) {
  const data = await apiJson(`/api/team/${encodeURIComponent(memberId)}`, 'PATCH', { name });
  return data.member;
}

export async function removeMember(memberId) {
  return apiJson(`/api/team/${encodeURIComponent(memberId)}`, 'DELETE');
}

// ---------------------------------------------------------------------------
// team presence (available to both supervisor and agents)
// ---------------------------------------------------------------------------
export async function fetchTeamPresence() {
  return apiFetch('/api/team/presence');
}

export async function updateTeamPresence(status) {
  return apiJson('/api/team/presence', 'POST', { status });
}

// ---------------------------------------------------------------------------
// invitations (unauthenticated — the recipient has no account yet)
// ---------------------------------------------------------------------------
// Both use `request` rather than `apiFetch`: the recipient is signed out, so there
// is no token to attach and no 401-refresh dance to perform.

/** Who this invite is for, so the accept form can confirm it before they commit. */
export async function lookupInvite(token) {
  return request(`/api/auth/invite/${encodeURIComponent(token)}`);
}

/**
 * Set the first password for an invited member and sign them in.
 *
 * Stores the session exactly as login does, so accepting lands straight in the
 * dashboard rather than bouncing through the sign-in form.
 */
export async function acceptInvite({ token, password, name }) {
  const data = await request('/api/auth/accept-invite', {
    method: 'POST',
    body: { token, password, name },
  });
  return storeSession(data);
}

// ---------------------------------------------------------------------------
// chat status (prospect / closed won / dropped)
// ---------------------------------------------------------------------------
/** Every conversation with a status set. Absent means 'prospect'. */
export async function fetchChatStatuses(sessionId = 'default') {
  const data = await apiFetch(`/api/chats/status?sessionId=${encodeURIComponent(sessionId)}`);
  return data.statuses || [];
}

export async function setChatStatus(jid, status, sessionId = 'default') {
  return apiJson(`/api/chats/${encodeURIComponent(jid)}/status`, 'PUT', { status, sessionId });
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------
/**
 * Message activity as a 7x24 weekday-by-hour grid.
 *
 * The timezone offset goes with the request because the server runs in UTC and
 * would otherwise bucket a WIB afternoon into the morning. getTimezoneOffset()
 * returns minutes to add to local time to reach UTC, which is what the server
 * expects.
 *
 * `from` / `to` are epoch milliseconds and optional. They are absolute instants
 * rather than dates for the same reason as the offset: only the browser knows what
 * "the 5th" means as a moment in time, so it resolves its own picker locally and
 * the server only ever compares numbers.
 */
export async function fetchActivityHeatmap(sessionId = 'default', { from, to } = {}) {
  const params = new URLSearchParams({
    sessionId,
    tzOffset: String(new Date().getTimezoneOffset()),
  });
  if (Number.isFinite(from)) params.set('from', String(Math.floor(from)));
  if (Number.isFinite(to)) params.set('to', String(Math.floor(to)));

  return apiFetch(`/api/stats/activity?${params.toString()}`);
}

/**
 * The conversations behind one heatmap cell.
 *
 * Takes the same range/view/offset the grid was drawn with, because a drill-down computed
 * under different filters would not add up to the number the operator clicked.
 */
export async function fetchActivityContributors({
  sessionId = 'default', day, hour, view = 'all', from, to,
} = {}) {
  const params = new URLSearchParams({
    sessionId,
    tzOffset: String(new Date().getTimezoneOffset()),
    day: String(day),
    hour: String(hour),
    view,
  });
  if (Number.isFinite(from)) params.set('from', String(Math.floor(from)));
  if (Number.isFinite(to)) params.set('to', String(Math.floor(to)));

  return apiFetch(`/api/stats/activity/contributors?${params.toString()}`);
}

/**
 * The team's conversation history: one entry per customer conversation, newest activity
 * first, carrying who started it and which teammates answered. Supervisor-only on the
 * server.
 *
 * A rolling recent view, not a full log: only the last `retainedPerChat` messages per
 * chat are kept, and only messages sent after attribution shipped carry an agent name.
 * `initiatedBy` is 'unknown' for any conversation longer than that window.
 */
export async function fetchConversationLog(sessionId = 'default') {
  return apiFetch(`/api/stats/conversation-log?sessionId=${encodeURIComponent(sessionId)}`);
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

// ---------------------------------------------------------------------------
// feature control
// ---------------------------------------------------------------------------
/**
 * What this account is allowed to see, as { featureKey: 'released' | 'coming_soon' | 'hidden' }.
 *
 * Resolved server-side against the workspace, so a team sees one product. The server
 * fails open — an unreadable flag table reports everything released rather than blanking
 * the navigation — so a caller never has to decide what an error means.
 */
export async function fetchFeatures() {
  const data = await apiFetch('/api/features');
  return data.features || {};
}

// The admin catalogue: every feature with its configured status, note and account
// exceptions. Writes return the full refreshed list, like the plan endpoints.
export async function adminListFeatures() {
  const data = await apiFetch('/api/admin/features');
  return data.features || [];
}

export async function adminSetFeature(key, { status, note }) {
  const data = await apiJson(`/api/admin/features/${encodeURIComponent(key)}`, 'PUT', { status, note });
  return data.features || [];
}

export async function adminSetFeatureAccess(key, uid, access) {
  const data = await apiJson(
    `/api/admin/features/${encodeURIComponent(key)}/access/${encodeURIComponent(uid)}`,
    'PUT',
    { access }
  );
  return data.features || [];
}

export async function adminClearFeatureAccess(key, uid) {
  const data = await apiJson(
    `/api/admin/features/${encodeURIComponent(key)}/access/${encodeURIComponent(uid)}`,
    'DELETE'
  );
  return data.features || [];
}

// ---------------------------------------------------------------------------
// System Announcements / Broadcast Updates
// ---------------------------------------------------------------------------
export async function fetchSystemAnnouncement() {
  try {
    const res = await fetch(apiUrl('/api/system-announcement'));
    if (!res.ok) return null;
    const data = await res.json();
    return data.announcement || null;
  } catch (err) {
    console.warn('[Api] Could not fetch system announcement:', err.message);
    return null;
  }
}

export async function adminBroadcastUpdate(payload) {
  return apiJson('/api/admin/broadcast-update', 'POST', payload);
}

export async function adminClearBroadcastUpdate() {
  return apiJson('/api/admin/broadcast-update', 'DELETE');
}

