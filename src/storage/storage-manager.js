/**
 * StorageManager — Abstraction over chrome.storage for Profile CRUD and session state.
 * 
 * Profiles are stored in chrome.storage.local (persistent).
 * Session state (attached tabs, etc.) is stored in chrome.storage.session (ephemeral).
 */

const STORAGE_KEYS = {
  PROFILES: 'modnetwork_profiles',
  GLOBAL_ENABLED: 'modnetwork_global_enabled'
};

const SESSION_KEYS = {
  ATTACHED_TABS: 'modnetwork_attached_tabs'
};

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
    filters: overrides.filters || [
      { urlPattern: '*://*/*', resourceTypes: ['Document', 'XHR', 'Fetch'] }
    ],
    mods: overrides.mods || [],
    createdAt: overrides.createdAt || now,
    updatedAt: now
  };
}

/**
 * Create a new Mod with defaults.
 */
function createMod(type, overrides = {}) {
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
  let result = await chrome.storage.local.get([STORAGE_KEYS.PROFILES, 'modnetwork_rules']);
  
  // Migration logic: If old rules exist but no profiles, wrap them in a profile
  if (!result[STORAGE_KEYS.PROFILES] && result['modnetwork_rules']) {
    console.log('[ModNetwork] Migrating legacy rules to Profiles framework...');
    const legacyRules = result['modnetwork_rules'];
    
    // Group all rules into a single default profile
    const migratedProfile = createProfile({
      name: "Legacy Rules",
      filters: [{ urlPattern: '*://*/*', resourceTypes: [] }],
      mods: legacyRules.map(r => {
        // Legacy rules had match inside the rule itself.
        // We'll just map them as best we can. 
        // For accurate migration, AdvancedJS would need custom handling, but we are in alpha.
        return createMod(r.type || 'AdvancedJS', r);
      })
    });
    
    const initialProfiles = [migratedProfile];
    await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: initialProfiles });
    // Keep old keys for now just in case, but we read from PROFILES
    return initialProfiles;
  }
  
  let profiles = result[STORAGE_KEYS.PROFILES] || [];
  
  if (profiles.length === 0) {
    const defaultProfile = createProfile({
      name: "Demo Workspace",
      mods: [
        createMod('ModifyHeader', {
          name: "Test Header",
          match: { type: 'wildcard', urlPattern: '*://*/*', resourceTypes: ['Document', 'XHR', 'Fetch'] },
          headers: [{ operation: 'set', name: 'X-ModNetwork-Test', value: 'Active', stage: 'Request' }]
        }),
        createMod('Redirect', {
          name: "Test Image Redirect",
          enabled: false, // Disabled by default for clean testing
          match: { type: 'wildcard', urlPattern: '*://localhost:8765/api/cat.svg', resourceTypes: ['Image', 'Fetch'] },
          redirectUrl: 'http://localhost:8765/api/dog.svg'
        }),
        createMod('AdvancedJS', {
          name: "Local Dev UI Injector",
          enabled: false, // Disabled by default
          match: { type: 'wildcard', urlPattern: '*://localhost:8765/*', resourceTypes: ['Document'] },
          scripts: {
            onResponse: `// Fetch local dev header from our secondary port\nconst localHtml = await fetch("http://localhost:8766/header").then(r => r.text());\n\n// Inject it into the production page HTML\ncontext.response.body = context.response.body.replace(\n  /<!-- HEADER_START -->[\\\\s\\\\S]*?<!-- HEADER_END -->/,\n  localHtml\n);\n\nreturn context.response;`
          }
        })
      ]
    });
    profiles = [defaultProfile];
    await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
  }
  
  return profiles;
}

/**
 * Save a new profile.
 */
async function saveProfile(profileData) {
  const profiles = await getProfiles();
  const profile = createProfile(profileData);
  profiles.push(profile);
  await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
  return profile;
}

/**
 * Update a profile.
 */
async function updateProfile(id, changes) {
  const profiles = await getProfiles();
  const index = profiles.findIndex(p => p.id === id);
  if (index === -1) return null;

  const existing = profiles[index];
  profiles[index] = { ...existing, ...changes, updatedAt: Date.now() };

  await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
  return profiles[index];
}

/**
 * Delete a profile.
 */
async function deleteProfile(id) {
  let profiles = await getProfiles();
  const originalLength = profiles.length;
  profiles = profiles.filter(p => p.id !== id);
  if (profiles.length < originalLength) {
    await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
  }
}

/**
 * Toggle profile status safely.
 */
async function toggleProfile(id) {
  const profiles = await getProfiles();
  const index = profiles.findIndex(p => p.id === id);
  if (index !== -1) {
    profiles[index].enabled = !profiles[index].enabled;
    profiles[index].updatedAt = Date.now();
    await chrome.storage.local.set({ [STORAGE_KEYS.PROFILES]: profiles });
  }
}

// ── Global State ───────────────────────────────────────────────────────

/**
 * Get the master on/off switch for the extension interception engine.
 */
async function getGlobalEnabled() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.GLOBAL_ENABLED);
  return result[STORAGE_KEYS.GLOBAL_ENABLED] !== false; // Default true if not set
}

/**
 * Set the master kill switch state.
 */
async function setGlobalEnabled(enabled) {
  await chrome.storage.local.set({ [STORAGE_KEYS.GLOBAL_ENABLED]: !!enabled });
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
  createMod,
  getGlobalEnabled,
  setGlobalEnabled,
  isTabAttached,
  getAttachedTabs,
  addAttachedTab,
  removeAttachedTab
};
