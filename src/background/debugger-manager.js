/**
 * DebuggerManager — Manages Chrome Debugger API lifecycle for tabs.
 *
 * Handles attaching/detaching the debugger, enabling CDP Fetch domain,
 * and tracking which tabs have active debugger sessions.
 *
 * This module is purely about CDP lifecycle — it does NOT manage DNR rules
 * or UI state. The reconcile() pipeline in service-worker.js coordinates
 * when to call these functions.
 */

import {
  addAttachedTab, removeAttachedTab, isTabAttached, getAttachedTabs
} from '../storage/storage-manager.js';
import { generateFetchPatterns } from './rule-engine.js';

const CDP_VERSION = '1.3';

/**
 * Attach the debugger to a tab and enable the Fetch domain for interception.
 * @param {number} tabId — The tab to attach to.
 * @param {Array} patterns — Optional Fetch.RequestPattern array for filtering.
 * @returns {Promise<boolean>} True if successfully attached.
 */
async function attachToTab(tabId, patterns = null) {
  if (await isTabAttached(tabId)) {
    console.log(`[ModNetwork] Debugger already attached to tab ${tabId}`);
    return true;
  }

  try {
    await chrome.debugger.attach({ tabId }, CDP_VERSION);
    console.log(`[ModNetwork] Debugger attached to tab ${tabId}`);

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
    await removeAttachedTab(tabId);
    return true;
  } catch (error) {
    const errMsg = (error?.message || '').toLowerCase();
    const alreadyDetached = errMsg.includes('not attached') || errMsg.includes('no target with given id');
    console.warn(`[ModNetwork] Detach warning for tab ${tabId}:`, error.message);
    if (alreadyDetached) {
      await removeAttachedTab(tabId);
      return true;
    }
    return false;
  }
}

/**
 * Detach from all tabs cleanly.
 */
async function detachAll() {
  const tabs = await getAttachedTabs();
  await Promise.allSettled([...tabs].map(tabId => detachFromTab(tabId)));
  console.log('[ModNetwork] Detached from all tabs');
}

/**
 * Handle debugger detach events (user closed debugger bar, tab crashed, etc.).
 * Registered at the top level in service-worker.js.
 */
async function handleDetach(source, reason) {
  if (await isTabAttached(source.tabId)) {
    await removeAttachedTab(source.tabId);
  }
}

/**
 * Send a CDP command to a tab.
 */
async function sendCommand(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

/**
 * Re-evaluate rules and update the interception patterns for all attached tabs.
 * Called as part of the reconcile pipeline when rules change.
 */
async function updateActiveDebuggers() {
  const tabs = await getAttachedTabs();
  if (tabs.length === 0) return;

  const promises = [...tabs].map(async tabId => {
    try {
      const patterns = await generateFetchPatterns(tabId);
      const fetchParams = {
        patterns: patterns.length > 0 ? patterns : [{ urlPattern: 'http://255.255.255.255:0/*', requestStage: 'Request' }]
      };
      await chrome.debugger.sendCommand({ tabId }, 'Fetch.enable', fetchParams);
      console.log(`[ModNetwork] Updated Fetch patterns for active tab ${tabId}`);
    } catch (e) {
      console.warn(`[ModNetwork] Failed to update active tab ${tabId}: ${e.message}`);
    }
  });

  await Promise.allSettled(promises);
}

/**
 * Clean up zombie debuggers on startup.
 * Detaches any tabs that Chrome thinks are attached but we don't track.
 */
async function cleanupZombieDebuggers() {
  const actualAttachedTabs = await getAttachedTabs();

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

export {
  attachToTab,
  detachFromTab,
  detachAll,
  handleDetach,
  sendCommand,
  updateActiveDebuggers,
  cleanupZombieDebuggers
};
