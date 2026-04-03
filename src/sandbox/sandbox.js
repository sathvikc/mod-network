/**
 * Sandbox Script — Executes user-written JavaScript in a safe sandboxed context.
 * 
 * This runs inside a sandboxed iframe where eval() is allowed by CSP.
 * Receives script code + context via postMessage from the offscreen document,
 * executes it, and sends the result back.
 */

// Listen for script execution requests from the parent (offscreen document)
window.addEventListener('message', async (event) => {
  const { messageId, scriptCode, context } = event.data;

  if (!messageId || !scriptCode) return;

  try {
    // Build an async function from the user's script code.
    // The function receives `context` as its argument and has access to `fetch`.
    // User's code should modify context.response or context.request and return it.
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

    const userFunction = new AsyncFunction('context', 'fetch', scriptCode);

    // Execute with a sandboxed fetch (we provide the real fetch since sandbox has it)
    const result = await userFunction(context, fetch.bind(window));

    // Send result back to the offscreen document
    event.source.postMessage({
      messageId,
      success: true,
      result: result || context // If user returns nothing, return the context as-is
    }, event.origin || '*');

  } catch (error) {
    // Send error back
    event.source.postMessage({
      messageId,
      success: false,
      error: error.message,
      stack: error.stack
    }, event.origin || '*');
  }
});

// Signal that sandbox is ready
console.log('[ModNetwork Sandbox] Ready');
