/**
 * Offscreen Document Script — Bridges Service Worker and Sandbox.
 * 
 * Receives EXECUTE_SCRIPT messages from the service worker via chrome.runtime,
 * forwards them to the sandboxed iframe via postMessage, and relays results back.
 */

const sandboxFrame = document.getElementById('sandbox');
const pendingRequests = new Map();

/**
 * Listen for messages from the service worker.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'EXECUTE_SCRIPT') return false;

  const { messageId, scriptCode, context } = message;

  // Store the pending request so we can resolve it when sandbox responds
  pendingRequests.set(messageId, { sendResponse, messageId });

  // Forward to the sandboxed iframe
  sandboxFrame.contentWindow.postMessage({
    messageId,
    scriptCode,
    context
  }, '*');

  // Return true to keep the message channel open for async response
  return true;
});

/**
 * Listen for results from the sandboxed iframe.
 */
window.addEventListener('message', (event) => {
  const { messageId, success, result, error, stack } = event.data;

  if (!messageId) return;

  const pending = pendingRequests.get(messageId);
  if (!pending) return;

  pendingRequests.delete(messageId);

  // Send result back to service worker
  chrome.runtime.sendMessage({
    type: 'SANDBOX_RESULT',
    messageId,
    result: success ? result : null,
    error: success ? null : error
  });
});

console.log('[ModNetwork Offscreen] Ready');
