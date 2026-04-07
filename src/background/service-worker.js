/**
 * Service Worker — Entry point for ModNetwork background logic.
 *
 * MV3 requirement: All event listeners MUST be registered at the top level
 * (not inside async functions or callbacks) to ensure they survive service
 * worker restarts.
 *
 * Orchestration model: Every state change flows through a single reconcile()
 * pipeline that re-derives all outputs (DNR rules, debugger attachments, UI)
 * from the current state. This eliminates scattered sync calls and race conditions.
 */

import {
  handleDetach, attachToTab, detachFromTab,
  detachAll, updateActiveDebuggers, cleanupZombieDebuggers
} from './debugger-manager.js';
import { handleRequestPaused } from './interceptor.js';
import {
  getProfiles, saveProfile, updateProfile, deleteProfile, toggleProfile,
  getGlobalEnabled, setGlobalEnabled, getActiveProfileId, setActiveProfileId,
  isTabAttached, removeAttachedTab, getAttachedTabs,
  runMigrations
} from '../storage/storage-manager.js';
import { syncDNRRules, isAnyRuleActiveForUrl, hasAdvancedJSRuleForUrl } from './rule-engine.js';

// ── Event Listeners (top-level registration, MV3 requirement) ──────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Fetch.requestPaused') {
    handleRequestPaused(source, params);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  handleDetach(source, reason);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // EXECUTE_SCRIPT messages are for the offscreen document, not the service worker.
  if (message.type === 'EXECUTE_SCRIPT') return false;

  handleMessage(message, sender).then(sendResponse).catch(error => {
    console.error('[ModNetwork] Message handler error:', error);
    sendResponse({ error: error.message });
  });
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (await isTabAttached(tabId)) {
    await removeAttachedTab(tabId);
  }
});

/**
 * When a tab finishes loading, reconcile debugger state for that tab.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // React to page load completion AND mid-navigation URL changes (e.g. redirects)
  if (!changeInfo.status && !changeInfo.url) return;
  if (!tab.url) return;

  if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
    if (await isTabAttached(tabId)) await detachFromTab(tabId);
    return;
  }

  await reconcileTab(tabId, tab.url);
});

/**
 * When user switches tabs, reconcile debugger state for ALL attached tabs.
 * Detach tabs that no longer need debugger, attach/keep the new tab if needed.
 */
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  // Detach all other attached tabs that no longer need the debugger
  const attachedTabs = await getAttachedTabs();
  for (const attachedTabId of attachedTabs) {
    if (attachedTabId === tabId) continue;
    try {
      const t = await chrome.tabs.get(attachedTabId);
      if (!t.url || !t.url.startsWith('http') || !(await hasAdvancedJSRuleForUrl(t.url))) {
        await detachFromTab(attachedTabId);
      }
    } catch {
      await removeAttachedTab(attachedTabId);
    }
  }

  // Handle the newly active tab
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;
  if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
    if (await isTabAttached(tabId)) await detachFromTab(tabId);
    return;
  }

  await reconcileTab(tabId, tab.url);
});

/**
 * When profiles/global state changes in storage, run the full reconcile.
 * Message handlers already call reconcile() after mutations, but storage
 * can also change from the popup writing directly. The concurrency guard
 * deduplicates overlapping calls.
 */
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && (changes.profiles || changes.global_enabled || changes.active_profile_id)) {
    await reconcile();
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[ModNetwork] Installed: ${details.reason}`);

  await runMigrations();

  if (details.reason === 'install') {
    await setGlobalEnabled(true);

    const responseScript = [
      '// Fetch replacement header from local dev server',
      'const localHeader = await fetch("http://localhost:8766/header")',
      '  .then(r => r.text());',
      '',
      '// Replace the header section between comment markers',
      'context.response.body = context.response.body.replace(',
      '  /<!-- HEADER_START -->[\\s\\S]*?<!-- HEADER_END -->/,',
      '  localHeader',
      ');',
      '',
      'return context.response;'
    ].join('\n');

    await saveProfile({
      name: "Demo Workspace",
      enabled: true,
      rules: [
        {
          type: 'ModifyHeader',
          name: "Test Header",
          enabled: true,
          match: { type: 'wildcard', urlPattern: 'http://localhost:8765/', resourceTypes: [] },
          headers: [{ operation: 'set', name: 'X-ModNetwork-Request', value: 'Added', stage: 'Request' }]
        },
        {
          type: 'Redirect',
          name: "Test Image Redirect",
          enabled: false,
          match: { type: 'wildcard', urlPattern: 'http://localhost:8765/api/cat.svg', resourceTypes: [] },
          redirectUrl: 'http://localhost:8765/api/dog.svg'
        },
        {
          type: 'AdvancedJS',
          name: "Local Dev UI Injector",
          enabled: true,
          match: { type: 'wildcard', urlPattern: 'http://localhost:8765/', resourceTypes: [] },
          scripts: {
            onBeforeRequest: null,
            onResponse: responseScript
          }
        },
        {
          type: 'ModifyHeader',
          name: "Test Header",
          enabled: true,
          match: { type: 'wildcard', urlPattern: 'http://localhost:8765/', resourceTypes: [] },
          headers: [{ operation: 'set', name: 'X-ModNetwork-Response', value: 'Added', stage: 'Response' }]
        },
      ]
    });
    console.log('[ModNetwork] Demo profile created');
  }

  await reconcile();
});

// ── Startup ───────────────────────────────────────────────────────────

(async () => {
  await cleanupZombieDebuggers();
  await reconcile();
})();

// ── Reconcile Pipeline ────────────────────────────────────────────────
//
// Single entry point for synchronizing all derived state.
// Every trigger (message handler, tab event, storage change) calls this.
// Concurrency-guarded: if already running, queues one follow-up pass.

let _reconcileInProgress = false;
let _reconcilePending = false;

async function reconcile() {
  if (_reconcileInProgress) {
    _reconcilePending = true;
    return;
  }
  _reconcileInProgress = true;
  try {
    await _doReconcile();
  } finally {
    _reconcileInProgress = false;
    if (_reconcilePending) {
      _reconcilePending = false;
      await reconcile();
    }
  }
}

async function _doReconcile() {
  // Step 1: Compile & apply DNR rules (headers, redirects, blocks — global scope)
  await syncDNRRules();

  // Step 2: Reconcile debugger attachments for all tracked tabs
  await reconcileAllDebuggers();

  // Step 3: Update extension badge
  await updateExtensionBadge();
}

/**
 * Reconcile debugger state for a single tab.
 * Used by tab events (onUpdated, onActivated) for fast, targeted updates.
 */
async function reconcileTab(tabId, url) {
  const globalEnabled = await getGlobalEnabled();
  const needsAdvJS = globalEnabled && await hasAdvancedJSRuleForUrl(url);
  const attached = await isTabAttached(tabId);

  if (needsAdvJS && !attached) {
    console.log(`[ModNetwork] Auto-attaching debugger to tab ${tabId}: ${url}`);
    await attachToTab(tabId);
  } else if (!needsAdvJS && attached) {
    console.log(`[ModNetwork] Detaching debugger from tab ${tabId} — no AdvJS rules match`);
    await detachFromTab(tabId);
  }
}

/**
 * Reconcile debugger state for all currently attached tabs + the active tab.
 * Detaches tabs that no longer match, attaches active tab if it should match.
 */
async function reconcileAllDebuggers() {
  const globalEnabled = await getGlobalEnabled();

  // Detach tabs that no longer match any AdvancedJS rule
  const attachedTabs = await getAttachedTabs();
  for (const tabId of attachedTabs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || !tab.url.startsWith('http')) {
        await detachFromTab(tabId);
        continue;
      }
      if (!globalEnabled || !(await hasAdvancedJSRuleForUrl(tab.url))) {
        console.log(`[ModNetwork] Reconcile: detaching tab ${tabId} — no AdvJS match`);
        await detachFromTab(tabId);
      }
    } catch {
      // Tab no longer exists
      await removeAttachedTab(tabId);
    }
  }

  // Update Fetch patterns for tabs that remain attached
  await updateActiveDebuggers();

  // Auto-attach to the currently active tab if it matches
  if (globalEnabled) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.url && activeTab.url.startsWith('http')) {
        if (await hasAdvancedJSRuleForUrl(activeTab.url) && !(await isTabAttached(activeTab.id))) {
          console.log(`[ModNetwork] Reconcile: auto-attaching to active tab ${activeTab.id}`);
          await attachToTab(activeTab.id);
        }
      }
    } catch (e) {
      // No active tab or query failed
    }
  }
}

async function updateExtensionBadge() {
  const enabled = await getGlobalEnabled();
  if (enabled) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Message Handler ────────────────────────────────────────────────────

async function handleMessage(message, sender) {
  switch (message.type) {
    // ── Debugger Controls ──
    case 'GET_TAB_STATUS': {
      // Return whether any rule is active for this tab's URL
      try {
        const tab = await chrome.tabs.get(message.tabId);
        if (tab && tab.url) {
          const active = await isAnyRuleActiveForUrl(tab.url);
          return { active };
        }
      } catch (e) { }
      return { active: false };
    }

    case 'DETACH_ALL': {
      await detachAll();
      return { success: true };
    }

    // ── Profile CRUD ──
    case 'GET_PROFILES': {
      const profiles = await getProfiles();
      return { profiles };
    }

    case 'SAVE_PROFILE': {
      const profile = await saveProfile(message.profileData);
      await reconcile();
      return { profile };
    }

    case 'UPDATE_PROFILE': {
      const profile = await updateProfile(message.profileId, message.changes);
      await reconcile();
      return { profile };
    }

    case 'DELETE_PROFILE': {
      const currentActiveId = await getActiveProfileId();
      await deleteProfile(message.profileId);
      if (currentActiveId === message.profileId) {
        await setActiveProfileId(null);
      }
      await reconcile();
      return { success: true };
    }

    case 'TOGGLE_PROFILE': {
      await toggleProfile(message.profileId);
      await reconcile();
      return { success: true };
    }

    // ── Active Profile ──
    case 'SET_ACTIVE_PROFILE': {
      await setActiveProfileId(message.profileId);
      await reconcile();
      return { success: true };
    }

    // ── Global State ──
    case 'GET_GLOBAL_ENABLED': {
      const enabled = await getGlobalEnabled();
      return { enabled };
    }

    case 'SET_GLOBAL_ENABLED': {
      await setGlobalEnabled(message.enabled);
      await reconcile();
      return { success: true };
    }

    // ── Content Script API ──
    case 'CHECK_ACTIVE_STATUS': {
      const active = await isAnyRuleActiveForUrl(message.url);
      return { active };
    }

    default:
      console.warn('[ModNetwork] Unknown message type:', message.type);
      return { error: `Unknown message type: ${message.type}` };
  }
}
