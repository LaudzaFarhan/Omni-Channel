// Contact Tags utility — stores tags per chat JID in localStorage

const TAGS_STORAGE_KEY = 'whatsapp_contact_tags';

export const PRESET_TAGS = [
  { value: 'new_customer', label: 'New Customer', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)' },
  { value: 'follow_up', label: 'Need Follow Up', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  { value: 'booked', label: 'Booked', color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },
];

/**
 * Load all tags from localStorage.
 * @returns {Object} Map of chatJid -> Array of { value, label, color, bg }
 */
export function loadAllTags() {
  try {
    const stored = localStorage.getItem(TAGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate legacy single tags to array of tags
      const migrated = {};
      for (const [jid, val] of Object.entries(parsed)) {
        if (val) {
          if (Array.isArray(val)) {
            migrated[jid] = val;
          } else {
            migrated[jid] = [val];
          }
        }
      }
      return migrated;
    }
  } catch (e) {
    console.error('Failed to load contact tags:', e);
  }
  return {};
}

/**
 * Get tag for a specific chat JID (returns the first tag for backwards compatibility).
 * @param {string} jid
 * @returns {Object|null}
 */
export function getTag(jid) {
  const tags = getTags(jid);
  return tags.length > 0 ? tags[0] : null;
}

/**
 * Get all tags for a specific chat JID.
 * @param {string} jid
 * @returns {Array}
 */
export function getTags(jid) {
  const tags = loadAllTags();
  return tags[jid] || [];
}

/**
 * Save all tags map to localStorage.
 * @param {Object} tags
 */
export function saveTags(tags) {
  try {
    localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(tags));
  } catch (e) {
    console.error('Failed to save contact tags:', e);
  }
  // Dispatch custom event so other components can react
  window.dispatchEvent(new CustomEvent('contact-tags-updated'));
}

/**
 * Toggle a tag for a specific chat JID.
 * @param {string} jid
 * @param {Object} tag
 */
export function toggleTag(jid, tag) {
  const tags = loadAllTags();
  const currentList = tags[jid] || [];
  
  const index = currentList.findIndex(t => t.label.toLowerCase() === tag.label.toLowerCase());
  if (index > -1) {
    currentList.splice(index, 1);
  } else {
    currentList.push(tag);
  }
  
  if (currentList.length === 0) {
    delete tags[jid];
  } else {
    tags[jid] = currentList;
  }
  
  saveTags(tags);
}

/**
 * Clear all tags for a specific chat JID.
 * @param {string} jid
 */
export function clearTags(jid) {
  const tags = loadAllTags();
  delete tags[jid];
  saveTags(tags);
}

/**
 * Set single tag for a specific chat JID (legacy support).
 * @param {string} jid
 * @param {Object|null} tag - tag object or null to remove
 */
export function setTag(jid, tag) {
  if (tag === null) {
    clearTags(jid);
  } else {
    const tags = loadAllTags();
    tags[jid] = [tag];
    saveTags(tags);
  }
}

/**
 * Create a custom tag object with a stable, nice color based on label hash.
 * @param {string} label
 * @returns {Object}
 */
export function createCustomTag(label) {
  const colors = [
    { color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.12)' }, // Purple
    { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.12)' }, // Pink
    { color: '#06b6d4', bg: 'rgba(6, 180, 212, 0.12)' },  // Cyan
    { color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.12)' },   // Rose
    { color: '#10b981', bg: 'rgba(16, 185, 129, 0.12)' },  // Emerald
    { color: '#eab308', bg: 'rgba(234, 179, 8, 0.12)' },   // Yellow
  ];
  
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colorObj = colors[Math.abs(hash) % colors.length];

  return {
    value: `custom_${label.toLowerCase().replace(/\s+/g, '_')}`,
    label: label,
    color: colorObj.color,
    bg: colorObj.bg,
  };
}

const CUSTOM_TAGS_STORAGE_KEY = 'whatsapp_global_custom_tags';

/**
 * Load global list of custom tags from localStorage.
 * @returns {Array} List of custom tags
 */
export function loadGlobalCustomTags() {
  try {
    const stored = localStorage.getItem(CUSTOM_TAGS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Failed to load global custom tags:', e);
  }
  return [];
}

/**
 * Save global list of custom tags to localStorage.
 * @param {Array} tags
 */
export function saveGlobalCustomTags(tags) {
  try {
    localStorage.setItem(CUSTOM_TAGS_STORAGE_KEY, JSON.stringify(tags));
  } catch (e) {
    console.error('Failed to save global custom tags:', e);
  }
  window.dispatchEvent(new CustomEvent('contact-tags-updated'));
}

/**
 * Add a custom tag to the global options list.
 * @param {Object} tag
 */
export function addGlobalCustomTag(tag) {
  const customTags = loadGlobalCustomTags();
  const exists = customTags.some(t => t.label.toLowerCase() === tag.label.toLowerCase());
  if (!exists) {
    customTags.push(tag);
    saveGlobalCustomTags(customTags);
  }
}

/**
 * Delete a custom tag from the global options list and all contacts' tags.
 * @param {string} tagLabel
 */
export function deleteGlobalCustomTag(tagLabel) {
  // 1. Remove from global list
  const customTags = loadGlobalCustomTags();
  const filtered = customTags.filter(t => t.label.toLowerCase() !== tagLabel.toLowerCase());
  saveGlobalCustomTags(filtered);

  // 2. Remove from all contact records
  const contactsTags = loadAllTags();
  let updated = false;
  for (const jid of Object.keys(contactsTags)) {
    const list = contactsTags[jid] || [];
    const index = list.findIndex(t => t.label.toLowerCase() === tagLabel.toLowerCase());
    if (index > -1) {
      list.splice(index, 1);
      if (list.length === 0) {
        delete contactsTags[jid];
      } else {
        contactsTags[jid] = list;
      }
      updated = true;
    }
  }
  if (updated) {
    saveTags(contactsTags);
  }
}
