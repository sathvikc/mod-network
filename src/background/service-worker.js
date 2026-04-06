/**
 * Service Worker — Entry point for ModNetwork background logic.
 * 
 * MV3 requirement: All event listeners MUST be registered at the top level
 * (not inside async functions or callbacks) to ensure they survive service
 * worker restarts.
 */

import {
  handleDetach, syncState, toggleTab, isAttached, attachToTab, detachFromTab, 
  detachAll, updateIcon, updateActiveDebuggers 
} from './debugger-manager.js';
import { handleRequestPaused } from './interceptor.js';
import {
  getProfiles, saveProfile, updateProfile, deleteProfile, toggleProfile,
  getGlobalEnabled, setGlobalEnabled, getActiveProfileId, setActiveProfileId,
  isTabAttached, removeAttachedTab, getAttachedTabs,
  isTabEnabled, getEnabledTabs, addEnabledTab, removeEnabledTab,
  runMigrations
} from '../storage/storage-manager.js';
import { syncDNRRules, isAnyRuleActiveForUrl, hasAdvancedJSRuleForUrl } from './rule-engine.js';

// ── Event Listeners (top-level registration, MV3 requirement) ──────────

/**
 * Handle debugger events (CDP events from attached tabs).
 */
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Fetch.requestPaused') {
    handleRequestPaused(source, params);
  }
});

/**
 * Handle debugger detach (user closed tab, clicked stop, etc.).
 */
chrome.debugger.onDetach.addListener((source, reason) => {
  handleDetach(source, reason);
});

/**
 * Handle messages from popup, offscreen document, and content scripts.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // EXECUTE_SCRIPT messages are for the offscreen document, not the service worker.
  // Let them pass through by not returning true.
  if (message.type === 'EXECUTE_SCRIPT') return false;

  // Handle async responses
  handleMessage(message, sender).then(sendResponse).catch(error => {
    console.error('[ModNetwork] Message handler error:', error);
    sendResponse({ error: error.message });
  });
  return true; // Keep the message channel open for async response
});

/**
 * Handle tab removal — clean up debugger if tab is closed.
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (await isTabAttached(tabId)) {
    await removeAttachedTab(tabId);
  }
  // Also remove from enabled tabs so DNR session rules are cleaned up
  if (await isTabEnabled(tabId)) {
    await removeEnabledTab(tabId);
    await syncDNRRules();
  }
});

/**
 * Re-evaluate debugger state when a tab finishes loading.
 * Only attach if this is the active tab — background tabs are never attached.
 * Detach always fires if rules no longer match (cleans up tabs that navigated away).
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const url = tab.url;

  // Never attach to internal browser pages
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    if (await isTabAttached(tabId)) await detachFromTab(tabId);
    return;
  }

  // If tab is not user-enabled, do nothing to the debugger
  if (!(await isTabEnabled(tabId))) return;

  // Tab is enabled — manage the AdvJS debugger hook
  const needsAdvJS = await hasAdvancedJSRuleForUrl(url);
  const alreadyAttached = await isTabAttached(tabId);

  if (needsAdvJS && !alreadyAttached) {
    console.log(`[ModNetwork] Tab ${tabId} navigated to AdvJS-matching URL, attaching debugger`);
    await attachToTab(tabId);
  } else if (!needsAdvJS && alreadyAttached) {
    console.log(`[ModNetwork] Tab ${tabId} navigated away from AdvJS URL, detaching debugger`);
    await detachFromTab(tabId);
  } else if (alreadyAttached) {
    // Re-apply icon since Chrome clears it on navigation
    await updateIcon(tabId, true);
  }

  // Re-sync DNR in case the new page URL changes domain-locked patterns
  await syncDNRRules();
});

/**
 * When the user switches tabs:
 * - Attach to the newly active tab if it matches an AdvancedJS rule.
 * - Detach from all other tabs (only the active tab ever holds a debugger session).
 */
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  // Update icon state for the newly active tab
  const enabled = await isTabEnabled(tabId);
  await updateIcon(tabId, enabled);

  // Only manage debugger if tab is user-enabled
  if (!enabled) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.status !== 'complete' || !tab.url) return;
  if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) return;

  if (await hasAdvancedJSRuleForUrl(tab.url) && !(await isTabAttached(tabId))) {
    console.log(`[ModNetwork] Auto-attaching debugger on tab switch to tab ${tabId}: ${tab.url}`);
    await attachToTab(tabId);
  }
});

/**
 * Hook into storage changes to synchronize DNR rules.
 * Debugger sweep is NOT triggered here — it is handled directly by each message
 * handler that modifies storage, so the response is only sent after the sweep
 * completes. Calling sweep here would race with the message handler's sweep and
 * cause the popup to query tab status before detach has finished.
 */
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  if (namespace === 'local' && (changes.profiles || changes.global_enabled || changes.active_profile_id)) {
    // 1. Sync DNR rules (Redirects, Header modifications, blocks)
    await syncDNRRules();
    // 2. Sync Debugger rules (Advanced JS active fetch intercepted patterns)
    await updateActiveDebuggers();
  }
});

/**
 * Handle extension install/update.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[ModNetwork] Installed: ${details.reason}`);
  
  // Run schema migrations for updates before processing anything else
  await runMigrations();

  if (details.reason === 'install') {
    await setGlobalEnabled(true);
  }

  if (details.reason === 'install') {
    // First-time install only: seed a test profile for localhost dev server.
    // Do NOT run this on 'update' (extension reload) — that would recreate the
    // profile with enabled=true every time the user reloads, overriding their
    // disabled state and causing spurious debugger attaches.
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
          match: { type: 'wildcard', urlPattern: '*://*/*', resourceTypes: [] },
          headers: [{ operation: 'set', name: 'X-ModNetwork-Test', value: 'Active', stage: 'Request' }]
        },
        {
          type: 'Redirect',
          name: "Test Image Redirect",
          enabled: false,
          match: { type: 'wildcard', urlPattern: '*://localhost:8765/api/cat.svg', resourceTypes: [] },
          redirectUrl: 'http://localhost:8765/api/dog.svg'
        },
        {
          type: 'AdvancedJS',
          name: "Local Dev UI Injector",
          enabled: false,
          match: { type: 'wildcard', urlPattern: '*://localhost:8765/*', resourceTypes: [] },
          scripts: {
            onBeforeRequest: null,
            onResponse: responseScript
          }
        }
      ]
    });
    console.log('[ModNetwork] Test profile created');

    // Ensure DNR engine is synced with new base rules
    await syncDNRRules();
  }
});

/**
 * On service worker startup, sync state.
 * Must await syncState before autoAttachMatchingTabs to avoid stale-storage races.
 */
(async () => {
  await syncState();
  syncDNRRules(); // independent — has its own concurrency guard
  await updateExtensionBadge();
  // sweepDebuggerAttachments both detaches tabs whose rules are now disabled
  // AND attaches tabs that should be active. Using it here (instead of just
  // autoAttachMatchingTabs) handles the case where the SW restarted while a
  // rule was disabled but the Chrome debugger was still attached.
  await sweepDebuggerAttachments();
})();

/**
 * Re-evaluate all currently attached tabs against the current rule state.
 * Detaches any tab whose URL no longer matches an active AdvancedJS rule.
 * Also attaches to the active tab if a newly enabled rule now matches it.
 * Called whenever profiles or global toggle changes.
 *
 * Uses a concurrency guard: if a sweep is already running, the next call
 * queues one follow-up sweep rather than running a second concurrent pass.
 * This prevents race conditions when message handlers and storage.onChanged
 * both trigger a sweep for the same storage write.
 */
let _sweepInProgress = false;
let _sweepPending = false;

async function sweepDebuggerAttachments() {
  if (_sweepInProgress) {
    _sweepPending = true;
    return;
  }
  _sweepInProgress = true;
  try {
    await _doSweepDebuggerAttachments();
  } finally {
    _sweepInProgress = false;
    if (_sweepPending) {
      _sweepPending = false;
      await sweepDebuggerAttachments();
    }
  }
}

async function _doSweepDebuggerAttachments() {
  const enabledTabs = await getEnabledTabs();

  // For each user-enabled tab, decide whether AdvJS debugger should be attached
  for (const tabId of enabledTabs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || !tab.url.startsWith('http')) {
        // Non-HTTP tab — detach debugger if attached, keep in ENABLED_TABS
        if (await isTabAttached(tabId)) await detachFromTab(tabId);
        continue;
      }

      const needsAdvJS = await hasAdvancedJSRuleForUrl(tab.url);
      const isAttachedNow = await isTabAttached(tabId);

      if (needsAdvJS && !isAttachedNow) {
        console.log(`[ModNetwork] Sweep: attaching AdvJS hook to enabled tab ${tabId}`);
        await attachToTab(tabId);
      } else if (!needsAdvJS && isAttachedNow) {
        console.log(`[ModNetwork] Sweep: detaching AdvJS hook from tab ${tabId} — no AdvJS rules match`);
        await detachFromTab(tabId);
      }
    } catch {
      // Tab no longer exists — clean up both state arrays
      await removeEnabledTab(tabId);
      await removeAttachedTab(tabId);
    }
  }

  // Detach any attached tabs that are NOT in enabledTabs (safety net)
  const attachedTabs = await getAttachedTabs();
  for (const tabId of attachedTabs) {
    if (!enabledTabs.includes(tabId)) {
      console.log(`[ModNetwork] Sweep: detaching orphaned attached tab ${tabId}`);
      await detachFromTab(tabId);
    }
  }
}

async function autoAttachMatchingTabs() {
  // Only attach to user-enabled active tabs
  const enabledTabs = await getEnabledTabs();
  for (const tabId of enabledTabs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !tab.url || tab.status !== 'complete') continue;
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) continue;
      if (await hasAdvancedJSRuleForUrl(tab.url) && !(await isTabAttached(tabId))) {
        console.log(`[ModNetwork] Auto-attaching to enabled tab ${tab.id}: ${tab.url}`);
        await attachToTab(tab.id);
      }
    } catch(e) {}
  }
}

async function updateExtensionBadge() {
  const enabled = await getGlobalEnabled();
  if (enabled) {
    chrome.action.setBadgeText({ text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Emerald Green
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ── Message Handler ────────────────────────────────────────────────────

/**
 * Route messages from popup and other extension components.
 * @param {Object} message
 * @param {Object} sender
 * @returns {Promise<Object>} Response
 */
async function handleMessage(message, sender) {
  switch (message.type) {
    // ── Debugger Controls ──
    case 'TOGGLE_TAB': {
      try {
        console.log('[ModNetwork] TOGGLE_TAB for tabId:', message.tabId);
        const attached = await toggleTab(message.tabId);
        console.log('[ModNetwork] TOGGLE_TAB result:', attached);
        return { success: true, attached };
      } catch (error) {
        console.error('[ModNetwork] TOGGLE_TAB error:', error);
        return { success: false, attached: false, error: error.message };
      }
    }

    case 'GET_TAB_STATUS': {
      const attached = await isAttached(message.tabId);
      return { attached };
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
      await sweepDebuggerAttachments();
      return { profile };
    }

    case 'UPDATE_PROFILE': {
      const profile = await updateProfile(message.profileId, message.changes);
      await sweepDebuggerAttachments();
      return { profile };
    }

    case 'DELETE_PROFILE': {
      await deleteProfile(message.profileId);
      await sweepDebuggerAttachments();
      return { success: true };
    }

    case 'TOGGLE_PROFILE': {
      await toggleProfile(message.profileId);
      await sweepDebuggerAttachments();
      return { success: true };
    }

    // ── Active Profile ──
    case 'SET_ACTIVE_PROFILE': {
      await setActiveProfileId(message.profileId);
      await syncDNRRules();
      await sweepDebuggerAttachments();
      return { success: true };
    }

    // ── Global State ──
    case 'GET_GLOBAL_ENABLED': {
      const enabled = await getGlobalEnabled();
      return { enabled };
    }

    case 'SET_GLOBAL_ENABLED': {
      await setGlobalEnabled(message.enabled);
      await updateExtensionBadge();
      await sweepDebuggerAttachments();
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
