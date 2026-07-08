// Contact Tags utility — stores tags per chat JID in localStorage

const TAGS_STORAGE_KEY = 'whatsapp_contact_tags';

export const PRESET_TAGS = [
  { value: 'new_customer', label: 'New Customer', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' },
  { value: 'follow_up', label: 'Need Follow Up', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  { value: 'booked', label: 'Booked', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },
];

/**
 * Load all tags from localStorage.
 * @returns {Object} Map of chatJid -> { value, label, color, bg, customLabel? }
 */
export function loadAllTags() {
  try {
    const stored = localStorage.getItem(TAGS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load contact tags:', e);
  }
  return {};
}

/**
 * Get tag for a specific chat JID.
 * @param {string} jid
 * @returns {Object|null}
 */
export function getTag(jid) {
  const tags = loadAllTags();
  return tags[jid] || null;
}

/**
 * Set tag for a specific chat JID.
 * @param {string} jid
 * @param {Object|null} tag - tag object or null to remove
 */
export function setTag(jid, tag) {
  const tags = loadAllTags();
  if (tag === null) {
    delete tags[jid];
  } else {
    tags[jid] = tag;
  }
  try {
    localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(tags));
  } catch (e) {
    console.error('Failed to save contact tags:', e);
  }
  // Dispatch custom event so other components can react
  window.dispatchEvent(new CustomEvent('contact-tags-updated'));
}

/**
 * Create a custom tag object.
 * @param {string} label
 * @returns {Object}
 */
export function createCustomTag(label) {
  return {
    value: 'custom',
    label: label,
    color: '#8b5cf6',
    bg: 'rgba(139, 92, 246, 0.12)',
  };
}
