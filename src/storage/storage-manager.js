/**
 * StorageManager — Abstraction over chrome.storage for Profile CRUD and session state.
 * 
 * Profiles are stored in chrome.storage.local (persistent).
 * Session state (attached tabs, etc.) is stored in chrome.storage.session (ephemeral).
 * 
 * An in-memory cache sits in front of chrome.storage.local reads to avoid
 * hitting storage on every intercepted network request (hot path).
 * The cache is warmed on first read and kept in sync via chrome.storage.onChanged.
 */

const STORAGE_KEYS = {
  PROFILES: 'modnetwork_profiles',
  GLOBAL_ENABLED: 'modnetwork_global_enabled',
  ACTIVE_PROFILE_ID: 'modnetwork_active_profile_id',
  SCHEMA_VERSION: 'modnetwork_schema_version'
};

const TARGET_SCHEMA_VERSION = 2;

const SESSION_KEYS = {
  ATTACHED_TABS: 'modnetwork_attached_tabs'
};

// ── In-Memory Cache ────────────────────────────────────────────────────
// Populated on first read, updated on every write, invalidated via onChanged.
const _cache = {
  profiles: undefined,       // undefined = not yet loaded, null/[] = loaded but empty
  globalEnabled: undefined,
  activeProfileId: undefined
};

// ── Write Mutex ────────────────────────────────────────────────────────
// Serializes writes so multiple parallel callers (e.g., fast UI clicks, background scripts) 
// don't overwrite each other's changes in the read-modify-write cycle.
let _profileWriteLock = Promise.resolve();

async function withProfileWriteLock(fn) {
  let release;
  const currentLock = _profileWriteLock;
  _profileWriteLock = new Promise(r => release = r);
  try {
    await currentLock;
    return await fn();
  } finally {
    release();
  }
}

/**
 * Invalidate cache when storage changes from another context (e.g. popup).
 */
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    if (changes[STORAGE_KEYS.PROFILES]) {
      _cache.profiles = changes[STORAGE_KEYS.PROFILES].newValue;
      console.log('[StorageManager] Cache updated: profiles');
    }
    if (changes[STORAGE_KEYS.GLOBAL_ENABLED]) {
      _cache.globalEnabled = changes[STORAGE_KEYS.GLOBAL_ENABLED].newValue;
      console.log('[StorageManager] Cache updated: globalEnabled');
    }
    if (changes[STORAGE_KEYS.ACTIVE_PROFILE_ID]) {
      _cache.activeProfileId = changes[STORAGE_KEYS.ACTIVE_PROFILE_ID].newValue;
      console.log('[StorageManager] Cache updated: activeProfileId');
    }
  });
}

/**
 * Generate a unique ID.
 */
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
}

/**
 * Create a new Profile with defaults.
 * @param {Object} overrides 
 * @returns {Object} Complete profile object.
 */
function createProfile(overrides = {}) {
  const now = Date.now();
  return {
    id: overrides.id || generateId(),
    name: overrides.name || 'Untitled Profile',
    color: overrides.color || 'var(--accent-primary)',
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    pinned: overrides.pinned || false,
    rules: overrides.rules || [],
    createdAt: overrides.createdAt || now,
    updatedAt: now
  };
}

/**
 * Create a new Rule with defaults.
 */
function createRule(type, overrides = {}) {
  const now = Date.now();
  const base = {
    id: overrides.id || generateId(),
    name: overrides.name || `New ${type}`,
    type: type, // 'ModifyHeader', 'Redirect', 'AdvancedJS'
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    match: overrides.match !== undefined ? overrides.match : { type: 'wildcard', urlPattern: '*://*/*', resourceTypes: ['Document', 'XHR', 'Fetch'] },
    createdAt: overrides.createdAt || now,
    updatedAt: now
  };

  if (type === 'AdvancedJS') {
    base.name = overrides.name || 'Advanced JS Script';
    base.scripts = {
      onBeforeRequest: overrides.scripts?.onBeforeRequest || null,
      onResponse: overrides.scripts?.onResponse || null
    };
  } else if (type === 'ModifyHeader') {
    // Array of { name, value, operation: 'set'|'remove'|'append', stage: 'Request'|'Response' }
    base.headers = overrides.headers || [];
  } else if (type === 'Redirect') {
    base.redirectUrl = overrides.redirectUrl || '';
  }

  return base;
}

// ── Persistent Storage (chrome.storage.local) ──────────────────────────

/**
 * Get all profiles.
 */
async function getProfiles() {
  // Return cached profiles if available
  if (_cache.profiles !== undefined) {
    return _cache.profiles;
  }

  let result = await chrome.storage.local.get(STORAGE_KEYS.PROFILES);
  let profiles = result[STORAGE_KEYS.PROFILES] || [];
  
  _cache.profiles = profiles;
  return profiles;
}

/**
 * Save a new profile.
 */
async function saveProfile(profileData) {
  return withProfileWriteLock(async () => {
    const profiles = await getProfiles();
    const profile = createProfile(profileData);
    profiles.push(profile);
    await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
    _cache.profiles = profiles;
    return profile;
  });
}

/**
 * Update a profile.
 */
async function updateProfile(id, changes) {
  return withProfileWriteLock(async () => {
    const profiles = await getProfiles();
    const index = profiles.findIndex(p => p.id === id);
    if (index === -1) return null;

    const existing = profiles[index];
    profiles[index] = { ...existing, ...changes, updatedAt: Date.now() };

    await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
    _cache.profiles = profiles;
    return profiles[index];
  });
}

/**
 * Delete a profile.
 */
async function deleteProfile(id) {
  return withProfileWriteLock(async () => {
    let profiles = await getProfiles();
    const originalLength = profiles.length;
    profiles = profiles.filter(p => p.id !== id);
    if (profiles.length < originalLength) {
      await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
      _cache.profiles = profiles;
    }
  });
}

/**
 * Toggle profile status safely.
 */
async function toggleProfile(id) {
  return withProfileWriteLock(async () => {
    const profiles = await getProfiles();
    const index = profiles.findIndex(p => p.id === id);
    if (index !== -1) {
      profiles[index].enabled = !profiles[index].enabled;
      profiles[index].updatedAt = Date.now();
      await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
      _cache.profiles = profiles;
    }
  });
}

// ── Schema Versioning & Migrations ───────────────────────────────────

/**
 * Run schema migrations on extension startup.
 */
async function runMigrations() {
  return withProfileWriteLock(async () => {
    let result = await chrome.storage.local.get([STORAGE_KEYS.SCHEMA_VERSION, STORAGE_KEYS.PROFILES]);
    let currentVersion = result[STORAGE_KEYS.SCHEMA_VERSION] || 1;
    
    if (currentVersion >= TARGET_SCHEMA_VERSION) return;
    
    let profiles = result[STORAGE_KEYS.PROFILES] || [];

    if (currentVersion < 2) {
      console.log('[StorageManager] Running migration v1 -> v2 (mods to rules)...');
      let needsSave = false;
      profiles.forEach(p => {
        if (p.mods !== undefined) {
          if (!p.rules) p.rules = p.mods;
          delete p.mods;
          needsSave = true;
        }
        if (p.filters !== undefined) {
          delete p.filters;
          needsSave = true;
        }
      });
      if (needsSave && profiles.length > 0) {
        await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
      }
      currentVersion = 2;
    }

    // Persist new version
    await chrome.storage.local.set({ [STORAGE_KEYS.SCHEMA_VERSION]: currentVersion });
    console.log(`[StorageManager] Schema migration complete. Current version: ${currentVersion}`);
  });
}

// ── Active Profile ─────────────────────────────────────────────────────

/**
 * Get the currently selected/active profile ID.
 */
async function getActiveProfileId() {
  if (_cache.activeProfileId !== undefined) {
    return _cache.activeProfileId;
  }
  const result = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_PROFILE_ID);
  _cache.activeProfileId = result[STORAGE_KEYS.ACTIVE_PROFILE_ID] || null;
  return _cache.activeProfileId;
}

/**
 * Set the currently selected/active profile ID.
 */
async function setActiveProfileId(id) {
  await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_PROFILE_ID]: id });
  _cache.activeProfileId = id;
}

// ── Global State ───────────────────────────────────────────────────────

/**
 * Get the master on/off switch for the extension interception engine.
 */
async function getGlobalEnabled() {
  if (_cache.globalEnabled !== undefined) {
    return _cache.globalEnabled;
  }
  const result = await chrome.storage.local.get(STORAGE_KEYS.GLOBAL_ENABLED);
  _cache.globalEnabled = result[STORAGE_KEYS.GLOBAL_ENABLED] !== false; // Default true if not set
  return _cache.globalEnabled;
}

/**
 * Set the master kill switch state.
 */
async function setGlobalEnabled(enabled) {
  await chrome.storage.local.set({ [STORAGE_KEYS.GLOBAL_ENABLED]: !!enabled });
  _cache.globalEnabled = !!enabled;
  return !!enabled;
}


// ── Ephemeral Session State (chrome.storage.session) ───────────────────

/**
 * Check if the debugger is actively attached to a tab.
 */
async function isTabAttached(tabId) {
  try {
    const result = await chrome.storage.session.get(SESSION_KEYS.ATTACHED_TABS);
    const tabs = result[SESSION_KEYS.ATTACHED_TABS] || [];
    return tabs.includes(tabId);
  } catch (err) {
    // Session storage occasionally throws in some contexts if not initialized
    return false;
  }
}

/**
 * Get all tab IDs that have the debugger attached.
 */
async function getAttachedTabs() {
  try {
    const result = await chrome.storage.session.get(SESSION_KEYS.ATTACHED_TABS);
    return result[SESSION_KEYS.ATTACHED_TABS] || [];
  } catch {
    return [];
  }
}

/**
 * Record a tab as attached.
 */
async function addAttachedTab(tabId) {
  const tabs = await getAttachedTabs();
  if (!tabs.includes(tabId)) {
    tabs.push(tabId);
    await chrome.storage.session.set({ [SESSION_KEYS.ATTACHED_TABS]: tabs });
  }
}

/**
 * Remove a tab record.
 */
async function removeAttachedTab(tabId) {
  let tabs = await getAttachedTabs();
  tabs = tabs.filter(id => id !== tabId);
  await chrome.storage.session.set({ [SESSION_KEYS.ATTACHED_TABS]: tabs });
}


export {
  getProfiles,
  saveProfile,
  updateProfile,
  deleteProfile,
  toggleProfile,
  createRule,
  runMigrations,
  getActiveProfileId,
  setActiveProfileId,
  getGlobalEnabled,
  setGlobalEnabled,
  isTabAttached,
  getAttachedTabs,
  addAttachedTab,
  removeAttachedTab
};
