/**
 * Offscreen Document Script — Bridges Service Worker and Sandbox.
 * 
 * Receives EXECUTE_SCRIPT messages from the service worker via chrome.runtime,
 * forwards them to the sandboxed iframe via postMessage, and relays results back.
 * Also proxies fetch requests from the sandbox (which has no network access).
 */

const sandboxFrame = document.getElementById('sandbox');
const pendingRequests = new Map();

// Set the sandbox iframe src using chrome.runtime.getURL for proper extension URL resolution
sandboxFrame.src = chrome.runtime.getURL('sandbox/sandbox.html');

// Wait for sandbox to be ready
let sandboxReady = false;
sandboxFrame.addEventListener('load', () => {
  sandboxReady = true;
  console.log('[ModNetwork Offscreen] Sandbox iframe loaded');
});

/**
 * Listen for messages from the service worker.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'EXECUTE_SCRIPT') return false;

  const { messageId, scriptCode, context } = message;

  // Store the sendResponse callback to reply when sandbox returns
  pendingRequests.set(messageId, sendResponse);

  // Forward to the sandboxed iframe
  const sendToSandbox = () => {
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

  const sendResponse = pendingRequests.get(messageId);
  if (!sendResponse) return;

  pendingRequests.delete(messageId);

  if (success) {
    sendResponse({ result });
  } else {
    sendResponse({ error });
  }
});

console.log('[ModNetwork Offscreen] Ready');
