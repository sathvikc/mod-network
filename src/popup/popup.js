/**
 * Popup Script — Compact UI for quick controls.
 * 
 * Shows rules list with toggles, tab debugger toggle, and "Open Dashboard" button.
 * All complex editing happens in the dashboard page.
 */

// ── State ──────────────────────────────────────────────────────
let currentTabId = null;

// ── DOM Helpers ────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Messaging ──────────────────────────────────────────────────
async function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

// ── Initialize ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Show version
  const manifest = chrome.runtime.getManifest();
  const appVersion = $('#appVersion');
  if (appVersion) appVersion.textContent = `v${manifest.version}`;

  // Cache tab ID
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) currentTabId = tab.id;

  await initTabStatus();
  await loadRules();
  await loadGlobalToggle();
  setupEventListeners();
});

// ── Tab Status ─────────────────────────────────────────────────
async function initTabStatus() {
  if (!currentTabId) return;
  const response = await sendMessage({ type: 'GET_TAB_STATUS', tabId: currentTabId });
  updateTabStatusUI(response.attached);
}

function updateTabStatusUI(attached) {
  const statusDot = $('#statusDot');
  const statusText = $('#statusText');
  const toggleBtn = $('#toggleBtn');
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
  const rulesList = $('#rulesList');
  const emptyState = $('#emptyState');
  rulesList.innerHTML = '';

  if (rules.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  rules.forEach(rule => {
    const hasReq = !!rule.scripts?.onBeforeRequest;
    const hasRes = !!rule.scripts?.onResponse;

    const card = document.createElement('div');
    card.className = `rule-card${rule.enabled ? '' : ' disabled'}`;

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
  // Toggle debugger on current tab
  $('#toggleBtn').addEventListener('click', async () => {
    if (!currentTabId) return;
    const btn = $('#toggleBtn');
    btn.disabled = true;
    $('#statusText').textContent = 'Connecting...';
    try {
      const response = await sendMessage({ type: 'TOGGLE_TAB', tabId: currentTabId });
      if (response.error) {
        $('#statusText').textContent = 'Error!';
        setTimeout(() => updateTabStatusUI(response.attached), 2000);
      } else {
        updateTabStatusUI(response.attached);
      }
    } catch (error) {
      $('#statusText').textContent = 'Error!';
    } finally {
      btn.disabled = false;
    }
  });

  // Global toggle
  $('#globalToggle').addEventListener('change', async () => {
    await sendMessage({ type: 'SET_GLOBAL_ENABLED', enabled: $('#globalToggle').checked });
  });

  // Open Dashboard
  $('#openDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    window.close();
  });

  // Rule list delegation
  $('#rulesList').addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    if (target.dataset.action === 'toggle') {
      e.stopPropagation();
      await sendMessage({ type: 'TOGGLE_RULE', ruleId: target.dataset.id });
      await loadRules();
    } else if (target.dataset.action === 'edit') {
      // Open dashboard with this rule
      chrome.tabs.create({
        url: chrome.runtime.getURL(`dashboard/dashboard.html#${target.dataset.id}`)
      });
      window.close();
    }
  });
}

// ── Global Toggle ──────────────────────────────────────────────
async function loadGlobalToggle() {
  const response = await sendMessage({ type: 'GET_GLOBAL_ENABLED' });
  $('#globalToggle').checked = response.enabled !== false;
}

// ── Utils ──────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
