// Theme selection.
//
// The palette is a set of CSS variables in index.css chosen by a `data-theme`
// attribute on <html>. This module owns reading, writing and applying it.
//
// applyStoredTheme() is called from main.jsx *before* React mounts, so the
// correct palette is in place on the first paint. Doing it inside a component
// would show a flash of light theme before switching to dark.

const STORAGE_KEY = 'wa.theme';

export const THEMES = ['light', 'dark'];

function readStored() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : null;
  } catch {
    // localStorage throws in some private-browsing modes.
    return null;
  }
}

function writeStored(theme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Non-fatal: the choice just will not survive a reload.
  }
}

/** The OS-level preference, used when the user has never chosen explicitly. */
export function systemTheme() {
  // On the marketing domain (omnireach.my.id) or public landing routes, always default to clean light theme
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const path = window.location.pathname;
    if (host === 'omnireach.my.id' || host === 'www.omnireach.my.id' || path === '/' || path.startsWith('/blog') || path.startsWith('/cara-integrasi')) {
      return 'light';
    }
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The theme in effect: an explicit choice if there is one, else the OS setting. */
export function currentTheme() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'omnireach.my.id' || host === 'www.omnireach.my.id') {
      return 'light';
    }
  }
  return readStored() || systemTheme();
}

/** True when the user has picked a theme, rather than inheriting the OS one. */
export function hasExplicitPreference() {
  return readStored() !== null;
}

let listeners = [];

export function subscribeTheme(listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

function notify(theme) {
  listeners.forEach((listener) => {
    try {
      listener(theme);
    } catch (err) {
      console.error('[Theme] Listener failed:', err);
    }
  });
}

/** Apply a theme without persisting it. */
export function applyTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'light';
  document.documentElement.setAttribute('data-theme', next);
  notify(next);
  return next;
}

/** Apply a theme and remember it. */
export function setTheme(theme) {
  const next = applyTheme(theme);
  writeStored(next);
  return next;
}

export function toggleTheme() {
  return setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/**
 * Called once at startup, before React renders.
 *
 * Also follows the OS setting as it changes, but only while the user has made no
 * explicit choice — once they pick a theme, their choice wins.
 */
export function applyStoredTheme() {
  applyTheme(currentTheme());

  try {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', (event) => {
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      if (host === 'omnireach.my.id' || host === 'www.omnireach.my.id') {
        applyTheme('light');
        return;
      }
      if (!hasExplicitPreference()) {
        applyTheme(event.matches ? 'dark' : 'light');
      }
    });
  } catch {
    // Older browsers without addEventListener on MediaQueryList: skip.
  }
}
