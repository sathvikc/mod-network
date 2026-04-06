/**
 * DebuggerManager — Manages Chrome Debugger API lifecycle for tabs.
 * 
 * Handles attaching/detaching the debugger, enabling CDP Fetch domain,
 * and tracking which tabs have active debugger sessions.
 */

import { 
  addAttachedTab, removeAttachedTab, isTabAttached, getAttachedTabs,
  addEnabledTab, removeEnabledTab, isTabEnabled, getEnabledTabs
} from '../storage/storage-manager.js';
import { generateFetchPatterns, hasAdvancedJSRuleForUrl, syncDNRRules } from './rule-engine.js';

const CDP_VERSION = '1.3';

/**
 * Attach the debugger to a tab and enable the Fetch domain for interception.
 * @param {number} tabId — The tab to attach to.
 * @param {Array} patterns — Optional Fetch.RequestPattern array for filtering.
 * @returns {Promise<boolean>} True if successfully attached.
 */
async function attachToTab(tabId, patterns = null) {
  // Check if already attached
  if (await isTabAttached(tabId)) {
    console.log(`[ModNetwork] Debugger already attached to tab ${tabId}`);
    return true;
  }

  try {
    // Attach the debugger
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
    console.log(`[ModNetwork] Debugger attached to tab ${tabId}`);

    // Enable Fetch domain to intercept requests
    // Only intercept traffic matching user rules
    const fetchPatterns = patterns || await generateFetchPatterns(tabId);
    
    await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', {
      patterns: fetchPatterns.length > 0 ? fetchPatterns : [{ urlPattern: 'http://255.255.255.255:0/*', requestStage: 'Request' }]
    });

    console.log(`[ModNetwork] Successfully attached to tab ${tabId}`);
    await addAttachedTab(tabId);

    return true;
  } catch (error) {
    if (error.message.includes('Already attached')) {
      console.log(`[ModNetwork] Tab ${tabId} was already attached by concurrent call — syncing state`);
      await addAttachedTab(tabId);
      return true;
    }

    console.error(`[ModNetwork] Failed to attach debugger to tab ${tabId}:`, error);
    // Clean up if partial attachment happened (e.g. Fetch.enable failed after attach)
    try {
      await chrome.debugger.detach({ tabId });
    } catch (_) {
      // Ignore — wasn't attached
    }
    return false;
  }
}

/**
 * Detach the debugger from a tab.
 * @param {number} tabId — The tab to detach from.
 * @returns {Promise<boolean>} True if successfully detached.
 */
async function detachFromTab(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
    console.log(`[ModNetwork] Debugger detached from tab ${tabId}`);
  } catch (error) {
    // Might already be detached
    console.warn(`[ModNetwork] Detach warning for tab ${tabId}:`, error.message);
  }

  // Always clean up tracking state
  await removeAttachedTab(tabId);
  return true;
}

/**
 * Detach from all tabs cleanly. Does NOT adjust ENABLED_TABS.
 */
async function detachAll() {
  const tabs = await getAttachedTabs();
  const promises = [...tabs].map(tabId => detachFromTab(tabId));
  await Promise.allSettled(promises);
  console.log('[ModNetwork] Detached from all tabs');
}

/**
 * Check if debugger is attached to a tab.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function isAttached(tabId) {
  return await isTabEnabled(tabId);
}

/**
 * Toggle debugger attachment for a tab.
 * @param {number} tabId
 * @returns {Promise<boolean>} New attachment state (true = attached).
 */
async function toggleTab(tabId) {
  if (await isTabEnabled(tabId)) {
    console.log(`[ModNetwork] Toggling OFF tab ${tabId}`);
    await removeEnabledTab(tabId);
    if (await isTabAttached(tabId)) {
      await detachFromTab(tabId);
    }
    await updateIcon(tabId, false);
    await syncDNRRules();
    return false;
  } else {
    console.log(`[ModNetwork] Toggling ON tab ${tabId}`);
    await addEnabledTab(tabId);
    await updateIcon(tabId, true);
    await syncDNRRules();

    // Auto-attach AdvancedJS component if necessary
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url && await hasAdvancedJSRuleForUrl(tab.url)) {
        await attachToTab(tabId);
      }
    } catch(e) {}
    return true;
  }
}

/**
 * Handle debugger detach events (user closed tab, clicked stop, etc.).
 * This is registered at the top level in service-worker.js.
 * @param {Object} source — { tabId }
 * @param {string} reason — Detach reason
 */
async function handleDetach(source, reason) {
  if (await isTabAttached(source.tabId)) {
    await removeAttachedTab(source.tabId);
  }
}

/**
 * Send a CDP command to a tab.
 * @param {number} tabId
 * @param {string} method — CDP method name (e.g., 'Fetch.continueRequest')
 * @param {Object} params — CDP method parameters
 * @returns {Promise<Object>} CDP response
 */
async function sendCommand(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

/**
 * Update the extension action icon based on attachment state.
 * @param {number} tabId
 * @param {boolean} active
 */
async function updateIcon(tabId, active) {
  try {
    const enabledTabs = await getEnabledTabs();
  
    // Enable UI if it is physically in ENABLED_TABS array
    if (enabledTabs.includes(tabId)) {
      chrome.action.setBadgeText({ tabId, text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#f59e0b' }); // Amber/Orange
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (error) {
    // Tab might not exist anymore
    console.warn('[ModNetwork] Icon update failed:', error.message);
  }
}

/**
 * Synchronize internal tracking state with actual extension UI logic.
 */
async function syncState() {
  const enabledTabs = await getEnabledTabs();
  const actualAttachedTabs = await getAttachedTabs();
  
  // Set icons for all enabled tabs
  for (const tabId of enabledTabs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab) {
        await updateIcon(tabId, true);
      }
    } catch {
      await removeEnabledTab(tabId);
    }
  }

  // Find zombie debuggers (Chrome thinks attached, but we forgot)
  try {
    const targets = await chrome.debugger.getTargets();
    for (const target of targets) {
      if (target.attached && target.tabId) {
        if (!actualAttachedTabs.includes(target.tabId)) {
          console.warn(`[ModNetwork] Found untracked attached tab ${target.tabId}, detaching...`);
          await detachFromTab(target.tabId);
        }
      }
    }
  } catch (error) {
    console.warn('[ModNetwork] Failed to sync debugger targets:', error);
  }
}

/**
 * Re-evaluate rules and update the interception patterns for all attached tabs.
 * Call this when the user modifies their enabled rules.
 */
async function updateActiveDebuggers() {
  const tabs = await getAttachedTabs();
  if (tabs.length === 0) return;

  const patterns = await generateFetchPatterns();
  const fetchParams = {
    patterns: patterns.length > 0 ? patterns : [{ urlPattern: 'http://255.255.255.255:0/*', requestStage: 'Request' }]
  };

  const promises = [...tabs].map(async tabId => {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', fetchParams);
      console.log(`[ModNetwork] Updated Fetch patterns for active tab ${tabId}`);
    } catch (e) {
      console.warn(`[ModNetwork] Failed to update active tab ${tabId}: ${e.message}`);
    }
  });

  await Promise.allSettled(promises);
}

export {
  attachToTab,
  detachFromTab,
  detachAll,
  isAttached,
  toggleTab,
  handleDetach,
  sendCommand,
  updateIcon,
  syncState,
  updateActiveDebuggers
};
