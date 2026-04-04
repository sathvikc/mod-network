/**
 * Popup Script — ModNetwork Ultra-Dense Dashboard UI
 */

// ── State ──────────────────────────────────────────────────────
let profiles = [];
let activeProfileId = null;

// ── DOM References ─────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const sidebar = $('#sidebar');
const profileList = $('#profileList');
const activeProfileName = $('#activeProfileName');
const profileToggle = $('#profileToggle');

// ── Messaging ──────────────────────────────────────────────────
async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

// ── Initialize ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupEventListeners();
});

async function loadData(preserveActiveId = null) {
  const res = await sendMessage({ type: 'GET_PROFILES' });
  profiles = res.profiles || [];
  
  if (profiles.length === 0) {
    activeProfileId = null;
  } else if (!activeProfileId || !profiles.find(p => p.id === activeProfileId)) {
    activeProfileId = preserveActiveId || profiles[0].id;
  }

  renderSidebar();
  renderMain();
}

// ── Rendering ──────────────────────────────────────────────────

function renderSidebar() {
  profileList.innerHTML = '';
  profiles.forEach(p => {
    const el = document.createElement('div');
    const color = p.color || 'var(--accent-primary)';
    
    // Auto-generate initials for collapsed view
    const initials = p.name ? p.name.substring(0, 2).toUpperCase() : 'W';

    el.className = `profile-item ${p.id === activeProfileId ? 'active' : ''} ${p.enabled ? 'enabled' : ''}`;
    el.innerHTML = `
      <div class="profile-dot" style="background: ${color}; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; width: 24px; height: 24px; border-radius: 4px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
        ${sidebar.classList.contains('collapsed') ? initials : ''}
      </div>
      <span class="profile-name">${p.name}</span>
    `;
    el.addEventListener('click', () => {
      activeProfileId = p.id;
      renderSidebar();
      renderMain();
    });
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
    'AdvancedJS': $('#list-AdvancedJS')
  };
  Object.values(listMap).forEach(el => el.innerHTML = '');

  const mods = activeProfile.mods || [];
  
  // Render Dense Rows
  mods.forEach((mod, index) => {
    const container = listMap[mod.type];
    if (!container) return;

    const wrapper = document.createElement('div');
    const matchUrl = mod.match?.urlPattern || '*://*/*';
    
    // Build specific row inputs based on type
    let rowContent = '';
    let submenuContent = '';

    if (mod.type === 'ModifyHeader') {
      const h = mod.headers && mod.headers[0] ? mod.headers[0] : { name: '', value: '', operation: 'set' };
      rowContent = `
        <input type="text" class="form-input flex-1 mod-h-name" data-index="${index}" value="${h.name}" placeholder="Header Name">
        <input type="text" class="form-input flex-2 mod-h-value" data-index="${index}" value="${h.value}" placeholder="Value">
      `;
      submenuContent = `
        <div class="form-group" style="grid-column: 1 / -1;">
          <label class="form-label">Behavior</label>
          <select class="form-input mod-h-op" data-index="${index}" style="width: 150px;">
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
        <input type="checkbox" class="native-checkbox mod-toggle" data-index="${index}" ${mod.enabled ? 'checked' : ''}>
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
}

function bindRowEvents() {
  const activeProfile = profiles.find(p => p.id === activeProfileId);
  if (!activeProfile) return;

  // Realtime saving on 'change' for any inputs
  const triggerSave = async (e) => {
    const idx = parseInt(e.target.dataset.index);
    if (isNaN(idx)) return;
    const mod = activeProfile.mods[idx];
    const wrapper = e.target.closest('div').parentElement.closest('div').parentElement; // Get the wrapper
    
    // Determine what field changed
    if (e.target.classList.contains('mod-toggle')) {
      mod.enabled = e.target.checked;
    } else if (e.target.classList.contains('mod-h-name') || e.target.classList.contains('mod-h-value') || e.target.classList.contains('mod-h-op')) {
      if (!mod.headers) mod.headers = [{}];
      mod.headers[0].name = wrapper.querySelector('.mod-h-name').value;
      mod.headers[0].value = wrapper.querySelector('.mod-h-value').value;
      mod.headers[0].operation = wrapper.querySelector('.mod-h-op')?.value || 'set';
      mod.headers[0].stage = 'Request';
    } else if (e.target.classList.contains('mod-redir')) {
      mod.redirectUrl = e.target.value;
    } else if (e.target.classList.contains('mod-js')) {
      if (!mod.scripts) mod.scripts = {};
      mod.scripts.onResponse = e.target.value;
    } else if (e.target.classList.contains('mod-url') || e.target.classList.contains('mod-url-type')) {
      mod.match = mod.match || { resourceTypes: ['Document', 'XHR', 'Fetch'] };
      mod.match.type = wrapper.querySelector('.mod-url-type').value;
      mod.match.urlPattern = wrapper.querySelector('.mod-url').value;
    }

    await saveActiveProfile();
  };

  $$('input.form-input, select.form-input, textarea.form-input, .mod-toggle').forEach(el => {
    el.addEventListener('change', triggerSave);
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
  });

  $$('.add-mod-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (!activeProfileId) return;
      const type = e.target.dataset.type;
      const activeProfile = profiles.find(p => p.id === activeProfileId);
      
      activeProfile.mods.push({
        id: crypto.randomUUID(),
        type: type,
        enabled: true,
        name: `New ${type}`,
        createdAt: Date.now()
      });
      await saveActiveProfile();
      renderMain();
    });
  });
}
