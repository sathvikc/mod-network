/**
 * Service Worker — Entry point for ModNetwork background logic.
 * 
 * MV3 requirement: All event listeners MUST be registered at the top level
 * (not inside async functions or callbacks) to ensure they survive service
 * worker restarts.
 */

import { handleDetach, syncState, toggleTab, isAttached, detachAll, updateIcon } from './debugger-manager.js';
import { handleRequestPaused } from './interceptor.js';
import {
  getProfiles, saveProfile, updateProfile, deleteProfile, toggleProfile,
  getGlobalEnabled, setGlobalEnabled, isTabAttached, removeAttachedTab
} from '../storage/storage-manager.js';
import { syncDNRRules } from './rule-engine.js';

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
});

/**
 * Re-apply badge when a tab finishes loading (Chrome clears per-tab badge on navigation).
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && await isTabAttached(tabId)) {
    await updateIcon(tabId, true);
  }
});

/**
 * Hook into storage changes to synchronize data across the engine.
 */
chrome.storage.onChanged.addListener(async (changes, namespace) => {
  // If rules or global toggle changed in persistent storage, sync DNR
  if (namespace === 'local' && (changes.modnetwork_profiles || changes.modnetwork_global_enabled)) {
    await syncDNRRules();
  }
});

/**
 * Handle extension install/update.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[ModNetwork] Installed: ${details.reason}`);

  if (details.reason === 'install') {
    await setGlobalEnabled(true);
  }

  if (details.reason === 'install' || details.reason === 'update') {
    // Remove any old example/test profiles
    const existingProfiles = await getProfiles();
    for (const profile of existingProfiles) {
      if (profile.name.includes('Example') || profile.name.includes('Test') || profile.name.includes('Legacy')) {
        await deleteProfile(profile.id);
      }
    }

    // Create a working test rule for the test server
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
      name: '🧪 Test Profile (Localhost)',
      enabled: true,
      filters: [{ urlPattern: '*://localhost:8765/*', resourceTypes: ['Document'] }],
      mods: [
        {
          type: 'AdvancedJS',
          name: 'Replace Header HTML',
          enabled: true,
          scripts: {
            onBeforeRequest: null,
            onResponse: responseScript
          }
        }
      ]
    });
    console.log('[ModNetwork] Test profile created/updated');
    
    // Ensure DNR engine is synced with new base rules
    await syncDNRRules();
  }
});

/**
 * On service worker startup, sync state.
 */
syncState();
syncDNRRules();

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
      return { profile };
    }

    case 'UPDATE_PROFILE': {
      const profile = await updateProfile(message.profileId, message.changes);
      return { profile };
    }

    case 'DELETE_PROFILE': {
      await deleteProfile(message.profileId);
      return { success: true };
    }

    case 'TOGGLE_PROFILE': {
      await toggleProfile(message.profileId);
      return { success: true };
    }

    // ── Global State ──
    case 'GET_GLOBAL_ENABLED': {
      const enabled = await getGlobalEnabled();
      return { enabled };
    }

    case 'SET_GLOBAL_ENABLED': {
      await setGlobalEnabled(message.enabled);
      return { success: true };
    }

    default:
      console.warn('[ModNetwork] Unknown message type:', message.type);
      return { error: `Unknown message type: ${message.type}` };
  }
}
