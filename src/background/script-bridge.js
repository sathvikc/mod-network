/**
 * ScriptBridge — Communication layer between Service Worker and Sandbox.
 * 
 * User scripts can't execute in the service worker (CSP blocks eval/Function).
 * Instead, we use an offscreen document that embeds a sandboxed iframe where
 * eval IS allowed. This module manages that communication pipeline:
 * 
 *   Service Worker → (runtime.sendMessage) → Offscreen Doc → (postMessage) → Sandbox
 *   Sandbox → (postMessage) → Offscreen Doc → (sendResponse) → Service Worker
 * 
 * The offscreen doc uses sendResponse to reply directly, avoiding message loops.
 */

let offscreenDocumentCreated = false;

const OFFSCREEN_URL = 'offscreen/offscreen.html';

/**
 * Ensure the offscreen document exists.
 * Chrome only allows one offscreen document per extension.
 */
async function ensureOffscreenDocument() {
  if (offscreenDocumentCreated) return;

  // Check if one already exists
  try {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
      offscreenDocumentCreated = true;
      return;
    }
  } catch (e) {
    // chrome.runtime.getContexts may not be available in older Chrome
    console.warn('[ModNetwork] getContexts not available, trying to create offscreen doc');
  }

  // Create the offscreen document
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['IFRAME_SCRIPTING'],
      justification: 'Execute user-defined transform scripts in a sandboxed iframe'
    });
    offscreenDocumentCreated = true;
    console.log('[ModNetwork] Offscreen document created');
  } catch (error) {
    if (error.message?.includes('Only a single offscreen')) {
      // Already exists
      offscreenDocumentCreated = true;
    } else {
      throw error;
    }
  }
}

/**
 * Execute a user script in the sandbox.
 * 
 * Sends the script to the offscreen doc, which forwards to sandbox iframe.
 * The offscreen doc replies via sendResponse (no message loop).
 * 
 * @param {string} scriptCode — The user's JavaScript code to execute.
 * @param {Object} context — Data to pass to the script (request, response, etc.)
 * @returns {Promise<Object>} — Result from the script execution.
 */
async function executeScript(scriptCode, context) {
  await ensureOffscreenDocument();

  // Send to offscreen doc and wait for sendResponse reply
  const response = await chrome.runtime.sendMessage({
    type: 'EXECUTE_SCRIPT',
    messageId: crypto.randomUUID(),
    scriptCode,
    context
  });

  if (response?.error) {
    throw new Error(response.error);
  }

  return response?.result || context;
}

/**
 * Execute a request-stage transform script.
 * @param {string} scriptCode — User's onBeforeRequest script
 * @param {Object} requestData — { url, method, headers, postData }
 * @param {number} tabId — The tab ID
 * @returns {Promise<Object|null>} Modified request or null to pass through
 */
async function executeRequestScript(scriptCode, requestData, tabId) {
  const context = {
    request: requestData,
    tabId,
    url: requestData.url,
    stage: 'request'
  };

  try {
    const result = await executeScript(scriptCode, context);
    return result;
  } catch (error) {
    console.error(`[ModNetwork] Request script error for ${requestData.url}:`, error);
    return null; // Pass through on error
  }
}

/**
 * Execute a response-stage transform script.
 * @param {string} scriptCode — User's onResponse script
 * @param {Object} requestData — { url, method, headers }
 * @param {Object} responseData — { body, headers, statusCode }
 * @param {number} tabId — The tab ID
 * @returns {Promise<Object|null>} Modified response or null to pass through
 */
async function executeResponseScript(scriptCode, requestData, responseData, tabId) {
  const context = {
    request: requestData,
    response: responseData,
    tabId,
    url: requestData.url,
    stage: 'response'
  };

  try {
    const result = await executeScript(scriptCode, context);
    return result;
  } catch (error) {
    console.error(`[ModNetwork] Response script error for ${requestData.url}:`, error);
    return null; // Pass through on error
  }
}

export {
  ensureOffscreenDocument,
  executeScript,
  executeRequestScript,
  executeResponseScript
};
