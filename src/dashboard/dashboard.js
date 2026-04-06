/**
 * Dashboard Script — Full-page UI for rule management and script editing.
 *
 * Communicates with the service worker via chrome.runtime.sendMessage.
 * Provides spacious code editor and config UI that the popup can't fit.
 *
 * ⚠️  PARKED — This file uses the old flat-rules message API (GET_RULES, SAVE_RULE,
 * UPDATE_RULE, DELETE_RULE, TOGGLE_RULE) which no longer exists in the service worker.
 * The SW now uses the profiles-based API (GET_PROFILES, SAVE_PROFILE, UPDATE_PROFILE,
 * DELETE_PROFILE, TOGGLE_PROFILE). The dashboard is non-functional until it is
 * rewritten to use the profiles API. Do not remove — rebuild planned.
 */

// ── State ──────────────────────────────────────────────────────
let editingRuleId = null;

// ── DOM Helpers ────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Messaging ──────────────────────────────────────────────────
async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

// ── Initialize ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Version
  const manifest = chrome.runtime.getManifest();
  $('#dashVersion').textContent = `v${manifest.version}`;

  await loadRules();
  await loadGlobalToggle();
  setupEventListeners();
  setupCodeEditors();

  // Check if a rule ID was passed via URL hash
  const hash = window.location.hash.slice(1);
  if (hash) {
    await openRuleEditor(hash);
  }
});

// ── Rules ──────────────────────────────────────────────────────
async function loadRules() {
  const response = await sendMessage({ type: 'GET_RULES' });
  const rules = response.rules || [];
  renderRules(rules);
}

function renderRules(rules) {
  const list = $('#dashRulesList');
  const empty = $('#dashEmptyState');
  list.innerHTML = '';

  if (rules.length === 0) {
    empty.style.display = 'flex';
    list.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'flex';

  rules.forEach(rule => {
    const hasReq = !!rule.scripts?.onBeforeRequest;
    const hasRes = !!rule.scripts?.onResponse;

    const row = document.createElement('div');
    row.className = `rule-row${rule.enabled ? '' : ' disabled'}`;
    row.dataset.ruleId = rule.id;

    row.innerHTML = `
      <label class="toggle-switch" title="Enable/disable rule" onclick="event.stopPropagation()">
        <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-action="toggle" data-id="${rule.id}">
        <span class="toggle-track"></span>
      </label>
      <div class="rule-info">
        <div class="rule-name">${escapeHtml(rule.name)}</div>
        <div class="rule-pattern">${escapeHtml(rule.match?.urlPattern || '*')}</div>
      </div>
      <div class="rule-badges">
        ${hasReq ? '<span class="badge req">REQ</span>' : ''}
        ${hasRes ? '<span class="badge res">RES</span>' : ''}
      </div>
      <svg class="rule-edit-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    `;

    // Click row to edit (except toggle)
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="toggle"]')) return;
      openRuleEditor(rule.id);
    });

    list.appendChild(row);
  });
}

// ── Event Listeners ────────────────────────────────────────────
function setupEventListeners() {
  // Add rule buttons
  $('#dashAddRule').addEventListener('click', () => openNewRule());
  $('#dashAddRuleEmpty').addEventListener('click', () => openNewRule());

  // Save rule
  $('#dashSaveRule').addEventListener('click', saveCurrentRule);

  // Delete rule
  $('#dashDeleteRule').addEventListener('click', deleteCurrentRule);

  // Global toggle
  $('#dashGlobalToggle').addEventListener('change', async () => {
    await sendMessage({ type: 'SET_GLOBAL_ENABLED', enabled: $('#dashGlobalToggle').checked });
  });

  // Sidebar nav
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (view === 'rules') {
        showView('rules');
        loadRules();
      }
    });
  });

  // Rule list toggle delegation
  $('#dashRulesList').addEventListener('change', async (e) => {
    const toggle = e.target.closest('[data-action="toggle"]');
    if (!toggle) return;
    await sendMessage({ type: 'TOGGLE_RULE', ruleId: toggle.dataset.id });
    await loadRules();
  });

  // Script tab switching
  $$('.script-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      $$('.script-tab').forEach(t => t.classList.remove('active'));
      $$('.script-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`#dashPanel-${tabName}`).classList.add('active');
    });
  });
}

// ── Editor ─────────────────────────────────────────────────────
function openNewRule() {
  editingRuleId = null;
  $('#editorTitle').textContent = 'New Rule';
  $('#dashDeleteRule').style.display = 'none';
  clearEditor();
  showView('editor');
}

async function openRuleEditor(ruleId) {
  const response = await sendMessage({ type: 'GET_RULE', ruleId });
  if (!response.rule) return;

  editingRuleId = ruleId;
  const rule = response.rule;

  $('#editorTitle').textContent = rule.name || 'Edit Rule';
  $('#dashDeleteRule').style.display = 'inline-flex';
  $('#navEditorLabel').textContent = rule.name || 'Edit Rule';

  $('#dashRuleName').value = rule.name || '';
  $('#dashUrlPattern').value = rule.match?.urlPattern || '*://*/*';
  $('#dashRuleEnabled').checked = rule.enabled !== false;

  // Resource types
  $$('#dashResourceTypes input[type="checkbox"]').forEach(cb => {
    cb.checked = (rule.match?.resourceTypes || []).includes(cb.value);
  });

  // Scripts
  $('#dashScript-onBeforeRequest').value = rule.scripts?.onBeforeRequest || '';
  $('#dashScript-onResponse').value = rule.scripts?.onResponse || '';

  updateLineNumbers('onBeforeRequest');
  updateLineNumbers('onResponse');

  showView('editor');
}

function clearEditor() {
  $('#dashRuleName').value = '';
  $('#dashUrlPattern').value = '*://*/*';
  $('#dashRuleEnabled').checked = true;
  $('#dashScript-onBeforeRequest').value = '';
  $('#dashScript-onResponse').value = '';

  $$('#dashResourceTypes input[type="checkbox"]').forEach(cb => {
    cb.checked = ['Document', 'XHR', 'Fetch'].includes(cb.value);
  });

  // Default to onResponse tab
  $$('.script-tab').forEach(t => t.classList.remove('active'));
  $$('.script-panel').forEach(p => p.classList.remove('active'));
  $('[data-tab="onResponse"]').classList.add('active');
  $('#dashPanel-onResponse').classList.add('active');

  updateLineNumbers('onBeforeRequest');
  updateLineNumbers('onResponse');
}

async function saveCurrentRule() {
  const name = $('#dashRuleName').value.trim() || 'Untitled Rule';
  const pattern = $('#dashUrlPattern').value.trim() || '*://*/*';
  const enabled = $('#dashRuleEnabled').checked;

  const resourceTypes = [];
  $$('#dashResourceTypes input[type="checkbox"]:checked').forEach(cb => {
    resourceTypes.push(cb.value);
  });

  const onBeforeRequest = $('#dashScript-onBeforeRequest').value.trim() || null;
  const onResponse = $('#dashScript-onResponse').value.trim() || null;

  const ruleData = {
    name,
    enabled,
    match: { urlPattern: pattern, resourceTypes },
    scripts: { onBeforeRequest, onResponse }
  };

  if (editingRuleId) {
    await sendMessage({ type: 'UPDATE_RULE', ruleId: editingRuleId, changes: ruleData });
  } else {
    const response = await sendMessage({ type: 'SAVE_RULE', ruleData });
    if (response.rule) {
      editingRuleId = response.rule.id;
    }
  }

  // Show saved feedback
  const btn = $('#dashSaveRule');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Saved!';
  btn.style.background = '#059669';
  setTimeout(() => {
    btn.innerHTML = originalText;
    btn.style.background = '';
  }, 1500);

  // Update editor title
  $('#editorTitle').textContent = name;
  $('#navEditorLabel').textContent = name;
  $('#dashDeleteRule').style.display = 'inline-flex';
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
  $$('.view').forEach(v => v.classList.remove('active'));
  $$('.nav-item').forEach(n => n.classList.remove('active'));

  if (view === 'rules') {
    $('#viewRules').classList.add('active');
    $('[data-view="rules"]').classList.add('active');
    $('#navEditor').style.display = 'none';
  } else {
    $('#viewEditor').classList.add('active');
    $('#navEditor').style.display = 'flex';
    $('#navEditor').classList.add('active');
  }
}

// ── Code Editor ────────────────────────────────────────────────
function setupCodeEditors() {
  ['onBeforeRequest', 'onResponse'].forEach(panel => {
    const textarea = $(`#dashScript-${panel}`);
    textarea.addEventListener('input', () => updateLineNumbers(panel));
    textarea.addEventListener('scroll', () => syncScroll(panel));
    textarea.addEventListener('keydown', handleTabKey);
    updateLineNumbers(panel);
  });
}

function updateLineNumbers(panel) {
  const textarea = $(`#dashScript-${panel}`);
  const lineNumbersEl = $(`#dashLineNumbers-${panel}`);
  if (!textarea || !lineNumbersEl) return;

  const lineCount = (textarea.value || '').split('\n').length;
  const lines = [];
  for (let i = 1; i <= Math.max(lineCount, 20); i++) {
    lines.push(`<span class="ln">${i}</span>`);
  }
  lineNumbersEl.innerHTML = lines.join('');
}

function syncScroll(panel) {
  const textarea = $(`#dashScript-${panel}`);
  const lineNumbersEl = $(`#dashLineNumbers-${panel}`);
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
    textarea.dispatchEvent(new Event('input'));
  }
}

// ── Global Toggle ──────────────────────────────────────────────
async function loadGlobalToggle() {
  const response = await sendMessage({ type: 'GET_GLOBAL_ENABLED' });
  $('#dashGlobalToggle').checked = response.enabled !== false;
}

// ── Utils ──────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
