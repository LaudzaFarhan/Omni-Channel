/**
 * Auto-Updater & Client Cache-Busting Utility
 *
 * Eliminates the need for manual customer actions like Ctrl+Shift+R or hard refreshes.
 *
 * 1. Automatically polls for server build updates in the background & on tab focus.
 * 2. Recovers automatically from Vite dynamic chunk import failures.
 * 3. Provides clean 1-click and automatic app reload without logging out the customer.
 */

import { apiUrl } from './apiBase.js';
import { showToast } from './toastBus.js';

export const CURRENT_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'unknown';
export const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.0.0';

let isUpdateInProgress = false;
const listeners = new Set();

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
export async function clearCachesAndReload(notifyUser = true) {
  if (isUpdateInProgress) return;
  isUpdateInProgress = true;

  if (notifyUser) {
    showToast({
      type: 'info',
      title: 'Memperbarui Aplikasi',
      message: 'Memuat aset versi terbaru...',
      duration: 3000,
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

  // Brief delay to allow toast to render
  setTimeout(() => {
    // Append a unique timestamp query param to force browser to bypass any HTTP cache for the document
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now().toString());
    window.location.replace(url.toString());
  }, 400);
}

/**
 * Check if the running server has a different build SHA than this client
 */
export async function checkForAppUpdate() {
  if (CURRENT_SHA === 'unknown') return false;

  try {
    const res = await fetch(apiUrl('/api/health?_t=' + Date.now()), {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store' },
    });
    if (!res.ok) return false;

    const data = await res.json();
    const serverSha = data?.build?.sha;

    if (serverSha && serverSha !== 'unknown' && serverSha !== CURRENT_SHA) {
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
        clearCachesAndReload(false);
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

  // 2. Poll when user returns to the tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForAppUpdate();
    }
  });

  // 3. Periodic background check (every 2.5 minutes)
  const timer = setInterval(() => {
    checkForAppUpdate();
  }, 150000);

  // Initial check after 10 seconds of app load
  setTimeout(() => {
    checkForAppUpdate();
  }, 10000);

  return () => clearInterval(timer);
}
