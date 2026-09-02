// Unified settings manager for client-side preferences and workspace configuration.
import { currentTheme, setTheme as applyAppTheme } from './theme.js';
import { fetchWithAuth } from './api.js';

const STORAGE_KEY = 'omni.user_settings.v1';

export const DEFAULT_SETTINGS = {
  // 1. Appearance & Regional
  theme: currentTheme() || 'light',
  chatDensity: 'comfortable', // 'comfortable' | 'compact'
  timezone: 'Asia/Jakarta',
  timeFormat: '24h', // '24h' | '12h'
  language: 'id', // 'id' | 'en'

  // 2. Chat & Inbox
  enterToSend: true, // Enter sends message (Shift+Enter for newline)
  soundAlerts: true,
  soundVolume: 80,
  soundTone: 'chime', // 'chime' | 'pop' | 'bell' | 'ping'
  autoScroll: true,
  typingIndicator: true,
  readReceipts: true,
  desktopNotifications: true,

  // 3. Automations & Office Hours
  businessHoursEnabled: false,
  businessHours: {
    mon: { open: '08:00', close: '17:00', active: true },
    tue: { open: '08:00', close: '17:00', active: true },
    wed: { open: '08:00', close: '17:00', active: true },
    thu: { open: '08:00', close: '17:00', active: true },
    fri: { open: '08:00', close: '17:00', active: true },
    sat: { open: '08:00', close: '13:00', active: false },
    sun: { open: '08:00', close: '13:00', active: false },
  },
  awayMessageEnabled: false,
  awayMessage: 'Halo! Terima kasih telah menghubungi kami. Saat ini kami sedang di luar jam operasional. Pesan Anda akan kami balas secepatnya saat tim kami kembali aktif.',
  welcomeMessageEnabled: false,
  welcomeMessage: 'Halo! Selamat datang di layanan kami. Silakan ketik pertanyaan atau pesanan Anda di sini, tim kami siap membantu! 😊',
  inactiveChatAutoResolve: 24, // hours (0 = disabled, 24, 48, 168)

  // 4. Security & Team Routing
  phoneMasking: false, // Mask phone numbers (e.g. +62 812-****-5606)
  inactivityLockTimeout: 0, // minutes (0 = never, 15, 30, 60)
  roundRobinAssignment: false,
  slaWarningMinutes: 15, // minutes (0 = off, 5, 15, 30, 60)
  agentCollisionAlert: true,
};

let listeners = new Set();

/** Read stored local settings */
export function getStoredSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Save settings locally and notify listeners */
export function saveLocalSettings(newSettings) {
  try {
    const merged = { ...getStoredSettings(), ...newSettings };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    
    // Apply theme if changed
    if (newSettings.theme && newSettings.theme !== currentTheme()) {
      applyAppTheme(newSettings.theme);
    }

    listeners.forEach(fn => fn(merged));
    return merged;
  } catch (err) {
    console.warn('[Settings] Failed to save local settings:', err);
    return getStoredSettings();
  }
}

/** Subscribe to settings changes */
export function subscribeSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sync settings with server database */
export async function syncWorkspaceSettingsFromServer() {
  try {
    const res = await fetchWithAuth('/api/workspace/settings');
    if (res.ok) {
      const serverSettings = await res.json();
      if (serverSettings && typeof serverSettings === 'object') {
        const merged = saveLocalSettings(serverSettings);
        return merged;
      }
    }
  } catch (err) {
    console.warn('[Settings] Sync from server error:', err.message);
  }
  return getStoredSettings();
}

/** Persist workspace settings to server */
export async function persistWorkspaceSettingsToServer(settingsToSave) {
  saveLocalSettings(settingsToSave);
  try {
    const res = await fetchWithAuth('/api/workspace/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsToSave),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('[Settings] Save to server error:', err.message);
  }
  return settingsToSave;
}

let audioCtx = null;

function getAudioContext() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function playTone(ctx, tone, volume) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const gainVal = Math.max(0.01, Math.min(1, (volume / 100) * 0.6));

    gain.gain.setValueAtTime(gainVal, now);
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (tone === 'chime') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.12); // A5
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    } else if (tone === 'pop') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (tone === 'bell') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, now); // C6
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc.start(now);
      osc.stop(now + 0.7);
    } else { // ping
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1318.51, now); // E6
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (err) {
    console.warn('[Sound] Playback error:', err);
  }
}

/** Play audio chime for incoming messages */
export function playNotificationSound(tone = 'chime', volume = 80) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => playTone(ctx, tone, volume)).catch(() => {});
    } else {
      playTone(ctx, tone, volume);
    }
  } catch (err) {
    console.warn('[Sound] AudioContext error:', err);
  }
}

/** Helper to mask phone numbers */
export function formatMaskedPhone(phone = '', enabled = false) {
  if (!enabled || !phone || phone.length < 8) return phone;
  const clean = String(phone).replace(/\D/g, '');
  if (clean.length < 8) return phone;
  const start = clean.slice(0, 4);
  const end = clean.slice(-4);
  return `+${start} •••• ${end}`;
}
