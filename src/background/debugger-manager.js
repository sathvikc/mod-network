/**
 * DebuggerManager — Manages Chrome Debugger API lifecycle for tabs.
 * 
 * Handles attaching/detaching the debugger, enabling CDP Fetch domain,
 * and tracking which tabs have active debugger sessions.
 */

import { addAttachedTab, removeAttachedTab, isTabAttached, getAttachedTabs } from '../storage/storage-manager.js';
import { generateFetchPatterns } from './rule-engine.js';

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
    const fetchPatterns = patterns || await generateFetchPatterns();

    // Workaround: if no patterns are provided, CDP intercepts ALL traffic by default.
    // To literally intercept nothing, we must pass a fake pattern that matches nothing.
    // However, Chrome expects valid patterns. If there are no rules, we can just detach,
    // or pass a pattern that realistically hits nothing, e.g. a dummy scheme.
    // Actually, passing `[]` might result in all traffic being intercepted (or none, depending on Chrome version).
    // Let's pass `[]` if possible. Wait, the docs say "If not set, all requests will be affected."
    // We should explicitly set it.
    await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', {
      patterns: fetchPatterns.length > 0 ? fetchPatterns : [{ urlPattern: 'http://255.255.255.255:0/*', requestStage: 'Request' }]
    });
    console.log(`[ModNetwork] Fetch.enable sent for tab ${tabId}`);

    // Track this tab as attached
    await addAttachedTab(tabId);

    // Update extension icon to indicate active state
    await updateIcon(tabId, true);

    return true;
  } catch (error) {
    // "Another debugger is already attached" means a concurrent sweep got here first.
    // Don't detach — that would kill their session. Just ensure our storage is consistent.
    if (error.message?.includes('Another debugger is already attached')) {
      console.log(`[ModNetwork] Tab ${tabId} was already attached by concurrent call — syncing state`);
      await addAttachedTab(tabId);
      await updateIcon(tabId, true);
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
  await updateIcon(tabId, false);
  return true;
}

/**
 * Detach from all tabs.
 * @returns {Promise<void>}
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
  return isTabAttached(tabId);
}

/**
 * Toggle debugger attachment for a tab.
 * @param {number} tabId
 * @returns {Promise<boolean>} New attachment state (true = attached).
 */
async function toggleTab(tabId) {
  if (await isTabAttached(tabId)) {
    await detachFromTab(tabId);
    return false;
  } else {
    return attachToTab(tabId);
  }
}

/**
 * Handle debugger detach events (user closed tab, clicked stop, etc.).
 * This is registered at the top level in service-worker.js.
 * @param {Object} source — { tabId }
 * @param {string} reason — Detach reason
 */
async function handleDetach(source, reason) {
  console.log(`[ModNetwork] Debugger detached from tab ${source.tabId}, reason: ${reason}`);
  await removeAttachedTab(source.tabId);
  await updateIcon(source.tabId, false);
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
    // Use badge to indicate active state
    await chrome.action.setBadgeText({
      text: active ? 'ON' : '',
      tabId
    });
    await chrome.action.setBadgeBackgroundColor({
      color: active ? '#00e676' : '#666666',
      tabId
    });
  } catch (error) {
    // Tab might not exist anymore
    console.warn('[ModNetwork] Icon update failed:', error.message);
  }
}

/**
 * Re-sync state on service worker startup.
 * Checks if previously-attached tabs are still valid.
 */
async function syncState() {
  const tabs = await getAttachedTabs();
  for (const tabId of tabs) {
    try {
      // Check if tab still exists
      await chrome.tabs.get(tabId);
      // Tab exists — check if debugger is still attached via getTargets
      const targets = await chrome.debugger.getTargets();
      const isStillAttached = targets.some(t => t.tabId === tabId && t.attached);
      if (!isStillAttached) {
        await removeAttachedTab(tabId);
        await updateIcon(tabId, false);
      }
    } catch (_) {
      // Tab doesn't exist anymore — clean up
      await removeAttachedTab(tabId);
    }
  }
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
  syncState
};
