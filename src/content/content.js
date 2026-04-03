/**
 * Content Script — Scaffold for future DOM-level operations.
 * 
 * Currently minimal. Future uses:
 * - Highlighting modified elements on the page
 * - Injecting user-defined JavaScript into the page context
 * - DOM manipulation that can't be done via response modification
 */

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'PING':
      sendResponse({ status: 'alive' });
      break;

    case 'INJECT_SCRIPT': {
      // Inject arbitrary JS into the page context
      const script = document.createElement('script');
      script.textContent = message.code;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
      sendResponse({ success: true });
      break;
    }

    case 'GET_PAGE_INFO': {
      sendResponse({
        url: window.location.href,
        title: document.title,
        readyState: document.readyState
      });
      break;
    }

    default:
      break;
  }
  return false;
});

console.log('[ModNetwork] Content script loaded');
