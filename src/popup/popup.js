/**
 * Popup Script — UI logic for ModNetwork popup.
 * 
 * Handles rule CRUD, tab toggle, views, and code editor line numbers.
 * Communicates with service worker via chrome.runtime.sendMessage.
 */

// ── State ──────────────────────────────────────────────────────
let currentView = 'rules'; // 'rules' | 'editor'
let editingRuleId = null;   // null = creating new rule
let currentTabId = null;    // Cache the tab ID at popup open time

// ── DOM References ─────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const rulesView = $('#rulesView');
const editorView = $('#editorView');
const rulesList = $('#rulesList');
const emptyState = $('#emptyState');
const toggleBtn = $('#toggleBtn');
const statusDot = $('#statusDot');
const statusText = $('#statusText');
const addRuleBtn = $('#addRuleBtn');
const backBtn = $('#backBtn');
const saveRuleBtn = $('#saveRuleBtn');
const deleteRuleBtn = $('#deleteRuleBtn');
const globalToggle = $('#globalToggle');

// Editor fields
const ruleName = $('#ruleName');
const urlPattern = $('#urlPattern');
const scriptOnBeforeRequest = $('#script-onBeforeRequest');
const scriptOnResponse = $('#script-onResponse');

// ── Messaging ──────────────────────────────────────────────────
async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

// ── Initialize ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Show version from manifest
  const manifest = chrome.runtime.getManifest();
  const appVersion = $('#appVersion');
  if (appVersion) appVersion.textContent = `v${manifest.version}`;

  // Cache the active tab ID immediately — this is the tab the user was on
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
  }
  
  await initTabStatus();
  await loadRules();
  await loadGlobalToggle();
  setupEventListeners();
  setupCodeEditors();
});

// ── Tab Status ─────────────────────────────────────────────────
async function initTabStatus() {
  if (!currentTabId) return;
  const response = await sendMessage({ type: 'GET_TAB_STATUS', tabId: currentTabId });
  updateTabStatusUI(response.attached);
}

function updateTabStatusUI(attached) {
  if (attached) {
    statusDot.classList.add('active');
    statusText.textContent = 'Active';
    toggleBtn.classList.add('active');
  } else {
    statusDot.classList.remove('active');
    statusText.textContent = 'Inactive';
    toggleBtn.classList.remove('active');
  }
}

// ── Rules ──────────────────────────────────────────────────────
async function loadRules() {
  const response = await sendMessage({ type: 'GET_RULES' });
  const rules = response.rules || [];
  renderRules(rules);
}

function renderRules(rules) {
  rulesList.innerHTML = '';

  if (rules.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  rules.forEach(rule => {
    const card = document.createElement('div');
    card.className = `rule-card${rule.enabled ? '' : ' disabled'}`;
    card.dataset.ruleId = rule.id;

    // Determine which scripts are set
    const hasReq = !!rule.scripts?.onBeforeRequest;
    const hasRes = !!rule.scripts?.onResponse;

    card.innerHTML = `
      <label class="toggle-switch rule-toggle" title="Enable/disable rule">
        <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-action="toggle" data-id="${rule.id}">
        <span class="toggle-track"></span>
      </label>
      <div class="rule-info" data-action="edit" data-id="${rule.id}">
        <div class="rule-name">${escapeHtml(rule.name)}</div>
        <div class="rule-pattern">${escapeHtml(rule.match?.urlPattern || '*')}</div>
      </div>
      <div class="rule-badges">
        ${hasReq ? '<span class="badge req">REQ</span>' : ''}
        ${hasRes ? '<span class="badge res">RES</span>' : ''}
      </div>
    `;

    rulesList.appendChild(card);
  });
}

// ── Event Listeners ────────────────────────────────────────────
function setupEventListeners() {
  // Toggle interception on current tab
  toggleBtn.addEventListener('click', async () => {
    if (!currentTabId) {
      console.warn('[ModNetwork Popup] No active tab ID cached');
      statusText.textContent = 'No tab';
      return;
    }

    console.log('[ModNetwork Popup] Toggle clicked, tabId:', currentTabId);
    toggleBtn.disabled = true;
    statusText.textContent = 'Connecting...';
    
    try {
      const response = await sendMessage({ type: 'TOGGLE_TAB', tabId: currentTabId });
      console.log('[ModNetwork Popup] Toggle response:', JSON.stringify(response));
      
      if (response.error) {
        statusText.textContent = 'Error!';
        console.error('[ModNetwork Popup] Toggle failed:', response.error);
        // Show error briefly
        setTimeout(() => updateTabStatusUI(response.attached), 2000);
      } else {
        updateTabStatusUI(response.attached);
      }
    } catch (error) {
      console.error('[ModNetwork Popup] Toggle error:', error);
      statusText.textContent = 'Error!';
    } finally {
      toggleBtn.disabled = false;
    }
  });

  // Add new rule
  addRuleBtn.addEventListener('click', () => {
    editingRuleId = null;
    clearEditor();
    showView('editor');
    deleteRuleBtn.style.display = 'none';
  });

  // Back to rules list
  backBtn.addEventListener('click', () => {
    showView('rules');
    loadRules();
  });

  // Save rule
  saveRuleBtn.addEventListener('click', saveCurrentRule);

  // Delete rule
  deleteRuleBtn.addEventListener('click', deleteCurrentRule);

  // Global toggle
  globalToggle.addEventListener('change', async () => {
    await sendMessage({ type: 'SET_GLOBAL_ENABLED', enabled: globalToggle.checked });
  });

  // Rule list delegation (toggle & edit clicks)
  rulesList.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === 'toggle') {
      e.stopPropagation();
      await sendMessage({ type: 'TOGGLE_RULE', ruleId: id });
      await loadRules();
    } else if (action === 'edit') {
      await openRuleEditor(id);
    }
  });

  // Script tab switching
  $$('.script-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      $$('.script-tab').forEach(t => t.classList.remove('active'));
      $$('.script-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`#panel-${tabName}`).classList.add('active');
    });
  });
}

// ── Editor ─────────────────────────────────────────────────────
async function openRuleEditor(ruleId) {
  const response = await sendMessage({ type: 'GET_RULE', ruleId });
  if (!response.rule) return;

  editingRuleId = ruleId;
  const rule = response.rule;

  ruleName.value = rule.name || '';
  urlPattern.value = rule.match?.urlPattern || '*://*/*';

  // Set resource type checkboxes
  const types = rule.match?.resourceTypes || [];
  $$('#resourceTypes input[type="checkbox"]').forEach(cb => {
    cb.checked = types.includes(cb.value);
  });

  // Set scripts
  scriptOnBeforeRequest.value = rule.scripts?.onBeforeRequest || '';
  scriptOnResponse.value = rule.scripts?.onResponse || '';

  // Update line numbers
  updateLineNumbers('onBeforeRequest');
  updateLineNumbers('onResponse');

  deleteRuleBtn.style.display = 'inline-flex';
  showView('editor');
}

function clearEditor() {
  ruleName.value = '';
  urlPattern.value = '*://*/*';
  scriptOnBeforeRequest.value = '';
  scriptOnResponse.value = '';

  // Reset resource types to defaults
  $$('#resourceTypes input[type="checkbox"]').forEach(cb => {
    cb.checked = ['Document', 'XHR', 'Fetch'].includes(cb.value);
  });

  updateLineNumbers('onBeforeRequest');
  updateLineNumbers('onResponse');

  // Show onResponse tab by default (more common use case)
  $$('.script-tab').forEach(t => t.classList.remove('active'));
  $$('.script-panel').forEach(p => p.classList.remove('active'));
  $('[data-tab="onResponse"]').classList.add('active');
  $('#panel-onResponse').classList.add('active');
}

async function saveCurrentRule() {
  const name = ruleName.value.trim() || 'Untitled Rule';
  const pattern = urlPattern.value.trim() || '*://*/*';

  const resourceTypes = [];
  $$('#resourceTypes input[type="checkbox"]:checked').forEach(cb => {
    resourceTypes.push(cb.value);
  });

  const onBeforeRequest = scriptOnBeforeRequest.value.trim() || null;
  const onResponse = scriptOnResponse.value.trim() || null;

  const ruleData = {
    name,
    match: { urlPattern: pattern, resourceTypes },
    scripts: { onBeforeRequest, onResponse }
  };

  if (editingRuleId) {
    await sendMessage({ type: 'UPDATE_RULE', ruleId: editingRuleId, changes: ruleData });
  } else {
    await sendMessage({ type: 'SAVE_RULE', ruleData });
  }

  showView('rules');
  await loadRules();
}

async function deleteCurrentRule() {
  if (!editingRuleId) return;
  if (!confirm('Delete this rule?')) return;

  await sendMessage({ type: 'DELETE_RULE', ruleId: editingRuleId });
  editingRuleId = null;
  showView('rules');
  await loadRules();
}

// ── View Switching ─────────────────────────────────────────────
function showView(view) {
  currentView = view;
  rulesView.style.display = view === 'rules' ? 'block' : 'none';
  editorView.style.display = view === 'editor' ? 'block' : 'none';
}

// ── Code Editor Helpers ────────────────────────────────────────
function setupCodeEditors() {
  [scriptOnBeforeRequest, scriptOnResponse].forEach(textarea => {
    const panel = textarea.id.replace('script-', '');

    // Update line numbers on input
    textarea.addEventListener('input', () => updateLineNumbers(panel));
    textarea.addEventListener('scroll', () => syncScroll(panel));
    textarea.addEventListener('keydown', handleTabKey);

    updateLineNumbers(panel);
  });
}

function updateLineNumbers(panel) {
  const textarea = $(`#script-${panel}`);
  const lineNumbersEl = $(`#lineNumbers-${panel}`);
  if (!textarea || !lineNumbersEl) return;

  const lineCount = (textarea.value || '').split('\n').length;
  const lines = [];
  for (let i = 1; i <= Math.max(lineCount, 6); i++) {
    lines.push(`<span class="ln">${i}</span>`);
  }
  lineNumbersEl.innerHTML = lines.join('');
}

function syncScroll(panel) {
  const textarea = $(`#script-${panel}`);
  const lineNumbersEl = $(`#lineNumbers-${panel}`);
  if (textarea && lineNumbersEl) {
    lineNumbersEl.scrollTop = textarea.scrollTop;
  }
}

function handleTabKey(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const textarea = e.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + 2;

    // Trigger input event for line numbers
    textarea.dispatchEvent(new Event('input'));
  }
}

// ── Global Toggle ──────────────────────────────────────────────
async function loadGlobalToggle() {
  const response = await sendMessage({ type: 'GET_GLOBAL_ENABLED' });
  globalToggle.checked = response.enabled !== false;
}

// ── Utils ──────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
