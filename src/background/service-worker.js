/**
 * Service Worker — Entry point for ModNetwork background logic.
 * 
 * MV3 requirement: All event listeners MUST be registered at the top level
 * (not inside async functions or callbacks) to ensure they survive service
 * worker restarts.
 */

import { handleDetach, syncState, toggleTab, isAttached, detachAll } from './debugger-manager.js';
import { handleRequestPaused } from './interceptor.js';
import {
  getRules, saveRule, updateRule, deleteRule, getRule, toggleRule,
  getGlobalEnabled, setGlobalEnabled, isTabAttached
} from '../storage/storage-manager.js';

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
    const { removeAttachedTab } = await import('../storage/storage-manager.js');
    await removeAttachedTab(tabId);
  }
});

/**
 * Handle extension install/update.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[ModNetwork] Installed: ${details.reason}`);

  if (details.reason === 'install') {
    // Set defaults on first install
    await setGlobalEnabled(true);

    // Create a sample rule to help users get started
    await saveRule({
      name: '🔧 Example: Replace Header HTML',
      enabled: false,
      match: {
        urlPattern: '*://example.com/*',
        resourceTypes: ['Document']
      },
      scripts: {
        onBeforeRequest: null,
        onResponse: [
          '// This script runs for each matching response.',
          '// `context` is provided with: { request, response, tabId, url }',
          '// Modify context.response and return it.',
          '//',
          '// Example: Fetch header HTML from local server and replace',
          '// const localHeader = await fetch("http://localhost:3000/header")',
          '//   .then(r => r.text());',
          '// context.response.body = context.response.body.replace(',
          '//   /<!-- HEADER_START -->[\\s\\S]*?<!-- HEADER_END -->/',
          '//   localHeader',
          '// );',
          '//',
          'return context.response;'
        ].join('\n')
      }
    });
  }
});

/**
 * On service worker startup, sync state.
 */
syncState();

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

    // ── Rule CRUD ──
    case 'GET_RULES': {
      const rules = await getRules();
      return { rules };
    }

    case 'GET_RULE': {
      const rule = await getRule(message.ruleId);
      return { rule };
    }

    case 'SAVE_RULE': {
      const rule = await saveRule(message.ruleData);
      return { rule };
    }

    case 'UPDATE_RULE': {
      const rule = await updateRule(message.ruleId, message.changes);
      return { rule };
    }

    case 'DELETE_RULE': {
      const success = await deleteRule(message.ruleId);
      return { success };
    }

    case 'TOGGLE_RULE': {
      const rule = await toggleRule(message.ruleId);
      return { rule };
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
