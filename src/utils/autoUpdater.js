/**
 * Auto-Updater & Client Cache-Busting Utility
 *
 * Eliminates the need for manual customer actions like Ctrl+Shift+R or hard refreshes.
 *
 * 1. Automatically polls for server build updates in the background & on tab focus (production only).
 * 2. Recovers automatically from Vite dynamic chunk import failures.
 * 3. Provides clean 1-click and automatic app reload without logging out the customer.
 * 4. Strictly prevents notification spam: notifies only ONCE per new version, and once
 *    acknowledged or updated, the notification disappears completely for the user.
 */

import { apiUrl } from './apiBase.js';
import { showToast } from './toastBus.js';

export const CURRENT_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'unknown';
export const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.0.0';

const UPDATED_SHA_KEY = 'omni_last_updated_sha';
const DISMISSED_SHA_KEY = 'omni_update_dismissed_sha';

let isUpdateInProgress = false;
let notifiedSha = null;
const listeners = new Set();

/**
 * Returns true if running in local development mode (localhost / 127.0.0.1)
 */
function isLocalhost() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}

/**
 * Check if the user has already updated to or dismissed this specific server build
 */
export function isUpdateAcknowledged(serverSha) {
  if (!serverSha || serverSha === 'unknown') return true;
  try {
    const updated = localStorage.getItem(UPDATED_SHA_KEY);
    if (updated === serverSha) return true;

    const dismissed = sessionStorage.getItem(DISMISSED_SHA_KEY);
    if (dismissed === serverSha) return true;
  } catch {}
  return false;
}

/**
 * Mark a build as dismissed so this user is not prompted again in this session
 */
export function dismissUpdate(serverSha) {
  if (!serverSha) return;
  try {
    sessionStorage.setItem(DISMISSED_SHA_KEY, serverSha);
  } catch {}
}

/**
 * Subscribe to update events
 */
export function onUpdateAvailable(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Purge browser CacheStorage and reload the application cleanly,
 * keeping the user's login tokens and settings completely intact.
 */
export async function clearCachesAndReload(targetSha = null, notifyUser = true) {
  if (isUpdateInProgress) return;
  isUpdateInProgress = true;

  // Mark this version as updated so the user will NEVER see the notification again
  if (targetSha && targetSha !== 'unknown') {
    try {
      localStorage.setItem(UPDATED_SHA_KEY, targetSha);
      sessionStorage.setItem(DISMISSED_SHA_KEY, targetSha);
    } catch {}
  }

  if (notifyUser) {
    showToast({
      id: 'app_updating_toast',
      type: 'info',
      title: 'Memperbarui Aplikasi',
      message: 'Memuat versi terbaru...',
      duration: 2500,
    });
  }

  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map(k => window.caches.delete(k)));
    }
  } catch (err) {
    console.warn('[AutoUpdater] Failed to clear CacheStorage:', err);
  }

  setTimeout(() => {
    // Append a unique timestamp query param to force browser to bypass any HTTP cache for the document
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now().toString());
    window.location.replace(url.toString());
  }, 350);
}

/**
 * Check if the running server has a different build SHA than this client
 */
export async function checkForAppUpdate() {
  // Never prompt or check during local development
  if (isLocalhost() || CURRENT_SHA === 'unknown') return false;

  try {
    const res = await fetch(apiUrl('/api/health?_t=' + Date.now()), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store' },
    });
    if (!res.ok) return false;

    const data = await res.json();
    const serverSha = data?.build?.sha;

    if (serverSha && serverSha !== 'unknown' && serverSha !== CURRENT_SHA) {
      // If user has already applied this update or dismissed it, suppress notification
      if (isUpdateAcknowledged(serverSha)) {
        return false;
      }

      // If we already emitted a notification for this exact server SHA in memory, don't spam
      if (notifiedSha === serverSha) {
        return false;
      }

      notifiedSha = serverSha;
      console.log(`[AutoUpdater] New build detected: ${serverSha} (current: ${CURRENT_SHA})`);

      listeners.forEach(cb => {
        try {
          cb({ serverSha, currentSha: CURRENT_SHA, version: data?.build?.version });
        } catch (e) {
          console.error('[AutoUpdater] Listener error:', e);
        }
      });
      return true;
    }
  } catch (err) {
    // Ignore network or offline glitches during polling
  }
  return false;
}

/**
 * Initialize automatic background version polling and chunk-error recovery
 */
export function initAutoUpdater() {
  if (typeof window === 'undefined') return;

  // 1. Chunk load error recovery (Vite dynamic import after new deploy)
  const handleChunkError = (msg) => {
    const isChunkError =
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /Importing a module script failed/i.test(msg) ||
      /error loading dynamically imported module/i.test(msg) ||
      /Loading chunk [\d]+ failed/i.test(msg);

    if (isChunkError) {
      const lastReload = sessionStorage.getItem('omni_chunk_reload_attempt');
      const now = Date.now();
      if (!lastReload || now - Number(lastReload) > 20000) {
        sessionStorage.setItem('omni_chunk_reload_attempt', now.toString());
        console.warn('[AutoUpdater] Chunk load failed. Auto-refreshing to latest build...');
        clearCachesAndReload(null, false);
      }
    }
  };

  window.addEventListener('error', (e) => {
    if (e?.message) handleChunkError(e.message);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e?.reason?.message || String(e?.reason || '');
    handleChunkError(reason);
  });

  // Skip polling in localhost
  if (isLocalhost()) return;

  // 2. Poll when user returns to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForAppUpdate();
    }
  });

  // 3. Periodic background check (every 5 minutes)
  const timer = setInterval(() => {
    checkForAppUpdate();
  }, 300000);

  // Initial check after 15 seconds of app load
  const initialTimer = setTimeout(() => {
    checkForAppUpdate();
  }, 15000);

  return () => {
    clearInterval(timer);
    clearTimeout(initialTimer);
  };
}
