/**
 * Offscreen Document Script — Bridges Service Worker and Sandbox.
 * 
 * Receives EXECUTE_SCRIPT messages from the service worker via chrome.runtime,
 * forwards them to the sandboxed iframe via postMessage, and relays results back.
 * Also proxies fetch requests from the sandbox (which has no network access).
 */

const sandboxFrame = document.getElementById('sandbox');
const pendingRequests = new Map();
const SCRIPT_EXECUTION_TIMEOUT_MS = 5000;

// Set the sandbox iframe src using chrome.runtime.getURL for proper extension URL resolution
sandboxFrame.src = chrome.runtime.getURL('sandbox/sandbox.html');

// Wait for sandbox to be ready
let sandboxReady = false;
sandboxFrame.addEventListener('load', () => {
  sandboxReady = true;
  console.log('[ModNetwork Offscreen] Sandbox iframe loaded');
});

function resolvePendingRequest(messageId, payload) {
  const pending = pendingRequests.get(messageId);
  if (!pending) return;

  pendingRequests.delete(messageId);
  clearTimeout(pending.timeoutId);
  pending.sendResponse(payload);
}

/**
 * Listen for messages from the service worker.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'EXECUTE_SCRIPT') return false;

  const { messageId, scriptCode, context } = message;
  // Store sendResponse callback and fail-safe timeout to avoid hanging requests.
  const timeoutId = setTimeout(() => {
    resolvePendingRequest(messageId, {
      error: `Script execution timeout after ${SCRIPT_EXECUTION_TIMEOUT_MS}ms`
    });
  }, SCRIPT_EXECUTION_TIMEOUT_MS);
  pendingRequests.set(messageId, { sendResponse, timeoutId });

  // Forward to the sandboxed iframe
  const sendToSandbox = () => {
    if (!sandboxFrame.contentWindow) {
      resolvePendingRequest(messageId, { error: 'Sandbox iframe not available' });
      return;
    }
    sandboxFrame.contentWindow.postMessage({
      messageId,
      scriptCode,
      context
    }, '*');
  };

  if (sandboxReady) {
    sendToSandbox();
  } else {
    sandboxFrame.addEventListener('load', sendToSandbox, { once: true });
  }

  // Return true to keep the message channel open for async sendResponse
  return true;
});

/**
 * Listen for messages from the sandboxed iframe.
 * Handles both script results and fetch proxy requests.
 */
window.addEventListener('message', async (event) => {
  const data = event.data;
  if (!data) return;

  // Handle fetch proxy requests from sandbox
  if (data.type === 'FETCH_REQUEST') {
    try {
      const response = await fetch(data.url, {
        method: data.options?.method || 'GET',
        headers: data.options?.headers || {},
        body: data.options?.body || undefined
      });
      const body = await response.text();
      
      // Send fetch result back to sandbox
      sandboxFrame.contentWindow.postMessage({
        fetchId: data.fetchId,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: body,
        headers: Object.fromEntries(response.headers.entries())
      }, '*');
    } catch (error) {
      sandboxFrame.contentWindow.postMessage({
        fetchId: data.fetchId,
        error: error.message
      }, '*');
    }
    return;
  }

  // Handle script execution results
  const { messageId, success, result, error } = data;
  if (!messageId) return;
  if (success) resolvePendingRequest(messageId, { result });
  else resolvePendingRequest(messageId, { error });
});

console.log('[ModNetwork Offscreen] Ready');
