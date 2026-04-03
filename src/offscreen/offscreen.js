/**
 * Offscreen Document Script — Bridges Service Worker and Sandbox.
 * 
 * Receives EXECUTE_SCRIPT messages from the service worker via chrome.runtime,
 * forwards them to the sandboxed iframe via postMessage, and relays results back.
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
    // Wait for sandbox to load
    sandboxFrame.addEventListener('load', sendToSandbox, { once: true });
  }

  // Return true to keep the message channel open for async sendResponse
  return true;
});

/**
 * Listen for results from the sandboxed iframe.
 */
window.addEventListener('message', (event) => {
  const { messageId, success, result, error } = event.data;

  if (!messageId) return;

  const sendResponse = pendingRequests.get(messageId);
  if (!sendResponse) return;

  pendingRequests.delete(messageId);

  // Reply directly to the service worker via sendResponse (keeps the channel clean)
  if (success) {
    sendResponse({ result });
  } else {
    sendResponse({ error });
  }
});

console.log('[ModNetwork Offscreen] Ready');
