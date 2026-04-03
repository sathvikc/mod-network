/**
 * Sandbox Script — Executes user-written JavaScript in a safe sandboxed context.
 * 
 * This runs inside a sandboxed iframe where eval() is allowed by CSP.
 * Receives script code + context via postMessage from the offscreen document,
 * executes it, and sends the result back.
 * 
 * IMPORTANT: Sandboxed pages have no network access. We provide a custom 
 * `fetch` function that proxies through the service worker.
 */

// Listen for script execution requests from the parent (offscreen document)
window.addEventListener('message', async (event) => {
  const { messageId, scriptCode, context } = event.data;

  if (!messageId || !scriptCode) return;

  try {
    // Build an async function from the user's script code.
    // The function receives `context` and a `fetch` proxy.
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

    // Create a fetch proxy that asks the parent (offscreen doc) to do the fetch
    // via the service worker (which has network access).
    const fetchProxy = async (url, options = {}) => {
      return new Promise((resolve, reject) => {
        const fetchId = 'fetch_' + Math.random().toString(36).substring(2);
        
        const handler = (e) => {
          if (e.data?.fetchId === fetchId) {
            window.removeEventListener('message', handler);
            if (e.data.error) {
              reject(new Error(e.data.error));
            } else {
              // Return a fetch-like response object
              resolve({
                ok: e.data.ok,
                status: e.data.status,
                statusText: e.data.statusText || '',
                headers: e.data.headers || {},
                text: async () => e.data.body,
                json: async () => JSON.parse(e.data.body)
              });
            }
          }
        };
        window.addEventListener('message', handler);

        // Ask parent to fetch
        event.source.postMessage({
          type: 'FETCH_REQUEST',
          fetchId,
          url,
          options: {
            method: options.method || 'GET',
            headers: options.headers || {},
            body: options.body || null
          }
        }, event.origin || '*');

        // Timeout
        setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(new Error(`Fetch timeout: ${url}`));
        }, 15000);
      });
    };

    const userFunction = new AsyncFunction('context', 'fetch', scriptCode);

    // Execute with the fetch proxy
    const result = await userFunction(context, fetchProxy);

    // Send result back to the offscreen document
    event.source.postMessage({
      messageId,
      success: true,
      result: result || context
    }, event.origin || '*');

  } catch (error) {
    event.source.postMessage({
      messageId,
      success: false,
      error: error.message,
      stack: error.stack
    }, event.origin || '*');
  }
});

console.log('[ModNetwork Sandbox] Ready');
