/**
 * Popup Script — ModNetwork Ultra-Dense Dashboard UI
 */

// ── State ──────────────────────────────────────────────────────
let profiles = [];
let activeProfileId = null;
let currentTabId = null;

// ── DOM References ─────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const sidebar = $('#sidebar');
const profileList = $('#profileList');
const activeProfileName = $('#activeProfileName');
const profileToggle = $('#profileToggle');

const statusDot = $('#statusDot');
const statusText = $('#statusText');
const toggleBtn = $('#toggleBtn');
const globalToggle = $('#globalToggle');

// ── Messaging ──────────────────────────────────────────────────
async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

// ── Initialize ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const manifest = chrome.runtime.getManifest();
  const appVersion = $('#appVersion');
  if (appVersion) appVersion.textContent = `v${manifest.version}`;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) currentTabId = tab.id;
  
  await initTabStatus();
  await loadGlobalToggle();
  await loadData();
  setupEventListeners();
});

async function loadGlobalToggle() {
  const response = await sendMessage({ type: 'GET_GLOBAL_ENABLED' });
  globalToggle.checked = response.enabled;
}

async function initTabStatus() {
  if (!currentTabId) return;
  const response = await sendMessage({ type: 'GET_TAB_STATUS', tabId: currentTabId });
  updateTabUI(response.attached);
}

function updateTabUI(isAttached) {
  if (isAttached) {
    statusDot.className = 'status-dot active';
    statusText.textContent = 'Debugger Attached';
    toggleBtn.classList.add('active');
  } else {
    statusDot.className = 'status-dot inactive';
    statusText.textContent = 'API Idle';
    toggleBtn.classList.remove('active');
  }
}

async function loadData(preserveActiveId = null) {
  const res = await sendMessage({ type: 'GET_PROFILES' });
  profiles = res.profiles || [];

  if (profiles.length === 0) {
    activeProfileId = null;
  } else if (preserveActiveId && profiles.find(p => p.id === preserveActiveId)) {
    activeProfileId = preserveActiveId;
  } else if (!activeProfileId || !profiles.find(p => p.id === activeProfileId)) {
    // Restore from storage, else fall back to first profile
    const stored = await chrome.storage.local.get('modnetwork_active_profile_id');
    const storedId = stored['modnetwork_active_profile_id'];
    activeProfileId = (storedId && profiles.find(p => p.id === storedId)) ? storedId : profiles[0].id;
  }

  renderSidebar();
  renderMain();
}

/**
 * Activate a profile: select it in UI and notify the SW to sync rules.
 * If the profile was manually disabled, re-enable it so its rules take effect.
 */
async function activateProfile(profileId) {
  activeProfileId = profileId;

  const clicked = profiles.find(p => p.id === profileId);
  if (clicked && !clicked.enabled) {
    clicked.enabled = true;
    await sendMessage({ type: 'UPDATE_PROFILE', profileId: profileId, changes: { enabled: true } });
  }

  await sendMessage({ type: 'SET_ACTIVE_PROFILE', profileId });
  renderSidebar();
  renderMain();
  await initTabStatus();
}

// ── Rendering ──────────────────────────────────────────────────

function renderSidebar() {
  profileList.innerHTML = '';
  const isCollapsed = sidebar.classList.contains('collapsed');

  profiles.forEach(p => {
    const el = document.createElement('div');
    const color = p.color || 'var(--accent-primary)';
    const initials = p.name ? p.name.substring(0, 2).toUpperCase() : 'W';

    el.className = `profile-item ${p.id === activeProfileId ? 'active' : ''} ${p.enabled ? 'enabled' : ''} ${p.pinned ? 'pinned' : ''}`;
    el.innerHTML = `
      <div class="profile-dot" style="background: ${color}; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; width: 24px; height: 24px; border-radius: 4px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
        ${isCollapsed ? initials : ''}
      </div>
      <span class="profile-name">${p.name}</span>
      ${!isCollapsed ? `
      <button class="pin-btn icon-btn" title="${p.pinned ? 'Unpin workspace' : 'Pin workspace (keep always active)'}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="${p.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="17" x2="12" y2="22"></line>
          <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
        </svg>
      </button>` : ''}
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('.pin-btn')) return; // handled by pin-btn
      activateProfile(p.id);
    });

    if (!isCollapsed) {
      el.querySelector('.pin-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        p.pinned = !p.pinned;
        await sendMessage({ type: 'UPDATE_PROFILE', profileId: p.id, changes: { pinned: p.pinned } });
        renderSidebar();
      });
    }

    profileList.appendChild(el);
  });
}

function renderMain() {
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  
  if (!activeProfile) {
    activeProfileName.textContent = 'No Workspace Selected';
    profileToggle.disabled = true;
    $$('.category-body > div[id^="list-"]').forEach(el => el.innerHTML = '');
    return;
  }

  activeProfileName.textContent = activeProfile.name;
  profileToggle.disabled = false;
  profileToggle.checked = activeProfile.enabled;

  const listMap = {
    'ModifyHeader': $('#list-ModifyHeader'),
    'Redirect': $('#list-Redirect'),
    'BlockRequest': $('#list-BlockRequest'),
    'AdvancedJS': $('#list-AdvancedJS')
  };
  Object.values(listMap).forEach(el => el.innerHTML = '');

  const mods = activeProfile.mods || [];
  
  // Render Dense Rows
  mods.forEach((mod, index) => {
    const container = listMap[mod.type];
    if (!container) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'mod-wrapper';
    const matchUrl = mod.match?.urlPattern || '*://*/*';
    
    // Build specific row inputs based on type
    let rowContent = '';
    let submenuContent = '';

    if (mod.type === 'ModifyHeader') {
      const h = mod.headers && mod.headers[0] ? mod.headers[0] : { name: '', value: '', operation: 'set', stage: 'Request' };
      const isResponse = h.stage === 'Response';
      rowContent = `
        <button class="stage-badge ${isResponse ? 'stage-res' : 'stage-req'} mod-h-stage-toggle" data-index="${index}" title="Click to toggle Request / Response">${isResponse ? 'RES' : 'REQ'}</button>
        <input type="text" class="form-input flex-1 mod-h-name" data-index="${index}" value="${h.name}" placeholder="Header Name">
        <input type="text" class="form-input flex-2 mod-h-value" data-index="${index}" value="${h.value || ''}" placeholder="Value">
      `;
      submenuContent = `
        <div class="form-group" style="grid-column: 1 / -1;">
          <select class="form-input mod-h-op" data-index="${index}" style="width: 160px;">
            <option value="set" ${h.operation==='set'?'selected':''}>Override Value</option>
            <option value="append" ${h.operation==='append'?'selected':''}>Append Value</option>
            <option value="remove" ${h.operation==='remove'?'selected':''}>Remove Header</option>
          </select>
        </div>
      `;
    } else if (mod.type === 'Redirect') {
      // For Redirects, we bring the Target URL directly into the dense row for clarity
      rowContent = `
        <input type="text" class="form-input mod-url flex-1" data-index="${index}" value="${matchUrl}" placeholder="Source URL (e.g. *://*.old.com/*)" style="width: 140px;">
        <span style="color: var(--text-tertiary); font-weight: bold; margin: 0 4px;">→</span>
        <input type="text" class="form-input mod-redir flex-1" data-index="${index}" value="${mod.redirectUrl || ''}" placeholder="Destination URL">
      `;
    } else if (mod.type === 'BlockRequest') {
      rowContent = `
        <input type="text" class="form-input flex-1 mod-url" data-index="${index}" value="${matchUrl}" placeholder="URL to block (e.g. *://ads.example.com/*)">
      `;
    } else if (mod.type === 'AdvancedJS') {
      rowContent = `
        <span style="flex:1; font-family: monospace; color: var(--text-secondary); padding: 4px;">Scripts must be edited in submenu.</span>
      `;
      submenuContent = `
        <div class="form-group" style="grid-column: 1 / -1;">
          <label class="form-label">onResponse Javascript</label>
          <textarea class="form-input mod-js" data-index="${index}" placeholder="context.response.body = 'mock';">${mod.scripts?.onResponse || ''}</textarea>
        </div>
      `;
    }

    // Wrap row and submenu: [✓] [rowContent] [X] [⋮]
    wrapper.innerHTML = `
      <div class="dense-row">
        <label class="ui-switch" style="transform: scale(0.85);">
          <input type="checkbox" class="mod-toggle" data-index="${index}" ${mod.enabled ? 'checked' : ''}>
          <span class="ui-slider"></span>
        </label>
        ${rowContent}
        <button class="icon-btn danger-text mod-delete" data-index="${index}" title="Delete" style="width:20px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <button class="icon-btn mod-submenu-btn" title="Advanced Options">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="1"></circle>
            <circle cx="12" cy="5" r="1"></circle>
            <circle cx="12" cy="19" r="1"></circle>
          </svg>
        </button>
      </div>

      <div class="submenu-container">
        <div class="submenu-grid">
          ${mod.type !== 'Redirect' ? `
          <div class="submenu-label">URL Filter</div>
          <div style="display:flex; gap:8px;">
            <select class="form-input mod-url-type" data-index="${index}" style="width:90px;">
              <option value="wildcard" ${mod.match?.type === 'wildcard' || !mod.match?.type ? 'selected' : ''}>Wildcard</option>
              <option value="regex" ${mod.match?.type === 'regex' ? 'selected' : ''}>Regex</option>
            </select>
            <input type="text" class="form-input mod-url flex-1" data-index="${index}" value="${matchUrl}" placeholder="*://*/*">
          </div>
          ` : `
          <!-- URL type logic for redirect without the input since it's on the main row -->
          <input type="hidden" class="mod-url-type" value="${mod.match?.type || 'wildcard'}">
          `}

          <div class="submenu-label">Description</div>
          <input type="text" class="form-input mod-desc" data-index="${index}" value="${mod.name || ''}" placeholder="Rule notes...">

          ${submenuContent}
        </div>
      </div>
    `;

    container.appendChild(wrapper);

    // Submenu toggling
    const rowEl = wrapper.querySelector('.dense-row');
    const submenuBtn = wrapper.querySelector('.mod-submenu-btn');
    const submenuEl = wrapper.querySelector('.submenu-container');
    
    submenuBtn.addEventListener('click', () => {
      const isOpen = submenuEl.classList.contains('open');
      submenuEl.classList.toggle('open', !isOpen);
      rowEl.classList.toggle('has-submenu', !isOpen);
    });
  });

  bindRowEvents();
}

async function saveActiveProfile() {
  if (!activeProfileId) return;
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  await sendMessage({ type: 'UPDATE_PROFILE', profileId: activeProfileId, changes: { mods: activeProfile.mods } });
  await initTabStatus();
}

function bindRowEvents() {
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  if (!activeProfile) return;

  // Save on change (fires on blur for text, immediately for select/checkbox)
  const triggerSave = async (e) => {
    const idx = parseInt(e.target.dataset.index);
    if (isNaN(idx)) return;
    const mod = activeProfile.mods[idx];
    const w = e.target.closest('.mod-wrapper');

    if (e.target.classList.contains('mod-toggle')) {
      mod.enabled = e.target.checked;
    } else if (e.target.classList.contains('mod-h-name') || e.target.classList.contains('mod-h-value') || e.target.classList.contains('mod-h-op')) {
      if (!mod.headers) mod.headers = [{}];
      mod.headers[0].name = w.querySelector('.mod-h-name').value;
      mod.headers[0].value = w.querySelector('.mod-h-value').value;
      mod.headers[0].operation = w.querySelector('.mod-h-op')?.value || 'set';
      mod.headers[0].stage = mod.headers[0].stage || 'Request';
    } else if (e.target.classList.contains('mod-redir')) {
      mod.redirectUrl = e.target.value;
    } else if (e.target.classList.contains('mod-js')) {
      if (!mod.scripts) mod.scripts = {};
      mod.scripts.onResponse = e.target.value;
    } else if (e.target.classList.contains('mod-url') || e.target.classList.contains('mod-url-type')) {
      mod.match = mod.match || { resourceTypes: ['Document', 'XHR', 'Fetch'] };
      mod.match.type = w.querySelector('.mod-url-type').value;
      mod.match.urlPattern = w.querySelector('.mod-url').value;
    } else if (e.target.classList.contains('mod-desc')) {
      mod.name = e.target.value;
    }

    await saveActiveProfile();
  };

  $$('input.form-input, select.form-input, textarea.form-input, .mod-toggle').forEach(el => {
    el.addEventListener('change', triggerSave);
  });

  // Stage badge toggle — one click to flip REQ ↔ RES
  $$('.mod-h-stage-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.index);
      const mod = activeProfile.mods[idx];
      if (!mod.headers) mod.headers = [{}];
      const w = btn.closest('.mod-wrapper');
      mod.headers[0].stage = mod.headers[0].stage === 'Response' ? 'Request' : 'Response';
      mod.headers[0].name = w.querySelector('.mod-h-name').value;
      mod.headers[0].value = w.querySelector('.mod-h-value').value;
      mod.headers[0].operation = w.querySelector('.mod-h-op')?.value || 'set';
      await saveActiveProfile();
      renderMain();
    });
  });

  $$('.mod-delete').forEach(el => {
    el.addEventListener('click', async (e) => {
      const idx = parseInt(e.currentTarget.dataset.index);
      activeProfile.mods.splice(idx, 1);
      await saveActiveProfile();
      renderMain();
    });
  });
}

// ── Event Listeners ────────────────────────────────────────────
function setupEventListeners() {

  $('#sidebarToggleBtn').addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    renderSidebar(); // Update initials logic
  });

  // Category Accordions
  $$('.category-header').forEach(header => {
    header.addEventListener('click', (e) => {
      const section = e.currentTarget.closest('.category-section');
      section.classList.toggle('collapsed');
    });
  });

  $('#addProfileBtn').addEventListener('click', async () => {
    const res = await sendMessage({ type: 'SAVE_PROFILE', profileData: { name: 'New Workspace' } });
    await loadData(res.profile.id);
  });

  $('#deleteProfileBtn').addEventListener('click', async () => {
    if (!activeProfileId) return;
    if (confirm('Delete this workspace?')) {
      await sendMessage({ type: 'DELETE_PROFILE', profileId: activeProfileId });
      activeProfileId = null;
      await loadData();
    }
  });

  profileToggle.addEventListener('change', async (e) => {
    if (!activeProfileId) return;
    const activeProfile = profiles.find(p => p.id === activeProfileId);
    activeProfile.enabled = e.target.checked;
    await sendMessage({ type: 'UPDATE_PROFILE', profileId: activeProfileId, changes: { enabled: e.target.checked } });
    renderSidebar();
    await initTabStatus();
  });

  $$('.add-mod-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (!activeProfileId) return;
      const type = e.target.dataset.type;
      const activeProfile = profiles.find(p => p.id === activeProfileId);
      
      // Resource type defaults: BlockRequest matches everything by default (empty = all types).
      // Header/JS mods default to Document+XHR+Fetch since they're rarely needed for images/fonts.
      const defaultResourceTypes = type === 'BlockRequest' ? [] : ['Document', 'XHR', 'Fetch'];
      activeProfile.mods.push({
        id: crypto.randomUUID(),
        type: type,
        enabled: true,
        name: `New ${type}`,
        match: { type: 'wildcard', urlPattern: '*://*/*', resourceTypes: defaultResourceTypes },
        createdAt: Date.now()
      });
      await saveActiveProfile();
      renderMain();
    });
  });

  toggleBtn.addEventListener('click', async () => {
    if (!currentTabId) return;
    const response = await sendMessage({ type: 'TOGGLE_TAB', tabId: currentTabId });
    if (response && response.success) {
      updateTabUI(response.attached);
    }
  });

  globalToggle.addEventListener('change', async () => {
    await sendMessage({ type: 'SET_GLOBAL_ENABLED', enabled: globalToggle.checked });
    await initTabStatus();
  });
}
