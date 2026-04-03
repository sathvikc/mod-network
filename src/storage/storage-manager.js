/**
 * StorageManager — Abstraction over chrome.storage for rule CRUD and session state.
 * 
 * Rules are stored in chrome.storage.local (persistent).
 * Session state (attached tabs, etc.) is stored in chrome.storage.session (ephemeral).
 */

const STORAGE_KEYS = {
  RULES: 'modnetwork_rules',
  GLOBAL_ENABLED: 'modnetwork_global_enabled'
};

const SESSION_KEYS = {
  ATTACHED_TABS: 'modnetwork_attached_tabs',
  TAB_RULES: 'modnetwork_tab_rules'
};

/**
 * Generate a unique ID for a rule.
 * Uses crypto.randomUUID if available, falls back to timestamp + random.
 */
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
}

/**
 * Create a new rule with defaults.
 * @param {Object} overrides — Fields to set on the rule.
 * @returns {Object} Complete rule object.
 */
function createRule(overrides = {}) {
  const now = Date.now();
  const id = overrides.id || generateId();
  return {
    id,
    type: overrides.type || 'AdvancedJS',
    name: overrides.name || 'Untitled Rule',
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    match: {
      urlPattern: overrides.match?.urlPattern || '*://*/*',
      resourceTypes: overrides.match?.resourceTypes || ['Document', 'XHR', 'Fetch']
    },
    // Type-specific configs
    scripts: {
      // User-written JS executed when request is intercepted at Request stage
      onBeforeRequest: overrides.scripts?.onBeforeRequest || null,
      // User-written JS executed when request is intercepted at Response stage
      onResponse: overrides.scripts?.onResponse || null
    },
    headers: overrides.headers || [], // Array of { name, value, operation: 'set'|'remove'|'append' }
    redirectUrl: overrides.redirectUrl || '',
    createdAt: overrides.createdAt || now,
    updatedAt: now
  };
}

// ── Persistent Storage (chrome.storage.local) ──────────────────────────

/**
 * Get all rules from persistent storage.
 * @returns {Promise<Array>} Array of rule objects.
 */
async function getRules() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.RULES);
  return result[STORAGE_KEYS.RULES] || [];
}

/**
 * Save a new rule to storage.
 * @param {Object} ruleData — Rule fields (will be merged with defaults).
 * @returns {Promise<Object>} The created rule.
 */
async function saveRule(ruleData) {
  const rules = await getRules();
  const rule = createRule(ruleData);
  rules.push(rule);
  await chrome.storage.local.set({ [STORAGE_KEYS.RULES]: rules });
  return rule;
}

/**
 * Update an existing rule by ID.
 * @param {string} id — Rule ID.
 * @param {Object} changes — Fields to update.
 * @returns {Promise<Object|null>} Updated rule or null if not found.
 */
async function updateRule(id, changes) {
  const rules = await getRules();
  const index = rules.findIndex(r => r.id === id);
  if (index === -1) return null;

  // Merge changes, preserving nested objects
  const existing = rules[index];
  const updated = {
    ...existing,
    ...changes,
    match: { ...existing.match, ...(changes.match || {}) },
    scripts: { ...existing.scripts, ...(changes.scripts || {}) },
    updatedAt: Date.now()
  };
  rules[index] = updated;
  await chrome.storage.local.set({ [STORAGE_KEYS.RULES]: rules });
  return updated;
}

/**
 * Delete a rule by ID.
 * @param {string} id — Rule ID.
 * @returns {Promise<boolean>} True if deleted, false if not found.
 */
async function deleteRule(id) {
  const rules = await getRules();
  const filtered = rules.filter(r => r.id !== id);
  if (filtered.length === rules.length) return false;
  await chrome.storage.local.set({ [STORAGE_KEYS.RULES]: filtered });
  return true;
}

/**
 * Get a single rule by ID.
 * @param {string} id — Rule ID.
 * @returns {Promise<Object|null>} Rule or null.
 */
async function getRule(id) {
  const rules = await getRules();
  return rules.find(r => r.id === id) || null;
}

/**
 * Toggle a rule's enabled state.
 * @param {string} id — Rule ID.
 * @returns {Promise<Object|null>} Updated rule or null.
 */
async function toggleRule(id) {
  const rule = await getRule(id);
  if (!rule) return null;
  return updateRule(id, { enabled: !rule.enabled });
}

/**
 * Get global enabled state.
 * @returns {Promise<boolean>}
 */
async function getGlobalEnabled() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.GLOBAL_ENABLED);
  return result[STORAGE_KEYS.GLOBAL_ENABLED] !== false; // default true
}

/**
 * Set global enabled state.
 * @param {boolean} enabled
 */
async function setGlobalEnabled(enabled) {
  await chrome.storage.local.set({ [STORAGE_KEYS.GLOBAL_ENABLED]: enabled });
}

// ── Session Storage (chrome.storage.session) ───────────────────────────

/**
 * Get the set of attached tab IDs.
 * @returns {Promise<Set<number>>}
 */
async function getAttachedTabs() {
  const result = await chrome.storage.session.get(SESSION_KEYS.ATTACHED_TABS);
  const tabs = result[SESSION_KEYS.ATTACHED_TABS] || [];
  return new Set(tabs);
}

/**
 * Mark a tab as having the debugger attached.
 * @param {number} tabId
 */
async function addAttachedTab(tabId) {
  const tabs = await getAttachedTabs();
  tabs.add(tabId);
  await chrome.storage.session.set({ [SESSION_KEYS.ATTACHED_TABS]: [...tabs] });
}

/**
 * Remove a tab from the attached set.
 * @param {number} tabId
 */
async function removeAttachedTab(tabId) {
  const tabs = await getAttachedTabs();
  tabs.delete(tabId);
  await chrome.storage.session.set({ [SESSION_KEYS.ATTACHED_TABS]: [...tabs] });
}

/**
 * Check if a tab has the debugger attached.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function isTabAttached(tabId) {
  const tabs = await getAttachedTabs();
  return tabs.has(tabId);
}

// ── Exports ────────────────────────────────────────────────────────────

export {
  STORAGE_KEYS,
  SESSION_KEYS,
  generateId,
  createRule,
  getRules,
  saveRule,
  updateRule,
  deleteRule,
  getRule,
  toggleRule,
  getGlobalEnabled,
  setGlobalEnabled,
  getAttachedTabs,
  addAttachedTab,
  removeAttachedTab,
  isTabAttached
};
