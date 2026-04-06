# ModNetwork

A local-only Chrome extension for intercepting and modifying network requests and responses using the Chrome Debugger API (CDP Fetch domain).

## Why ModNetwork?

Existing tools like ModHeader, Requestly, and Inssman have limitations:
- Corporate policies block them
- They use external servers
- They can't modify response bodies
- Limited customization

ModNetwork uses the **Chrome Debugger API** for maximum power — modify URLs, request/response headers, request/response bodies, and inject JavaScript. Everything runs locally. Users write **JavaScript functions** to control every aspect of the interception.

## Features

- 🔧 **Full Request Control** — Modify URL, method, headers, body before sending
- 📦 **Full Response Control** — Modify status, headers, body after receiving
- 🚦 **Native Redirect & Block** — Fast DNS-level URL redirects and request blocking via Chrome DNR
- 📝 **User-Scriptable** — Write JavaScript transform functions for advanced interception
- 🎯 **Smart URL Matching** — Write partial URLs, paths, or domains — the engine expands them intelligently
- 🔒 **Tab-Isolated** — Rules only affect tabs you explicitly enable. Never leaks to other browser tabs.
- 💾 **Local Only** — Zero external dependencies, no servers, no data leaves your machine
- 🎨 **Premium UI** — Dark-themed, ultra-dense workspace interface

## Setup

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `src/` directory from this project
5. The ModNetwork icon appears in your toolbar

## Architecture

```
src/
├── manifest.json              # Extension manifest (MV3)
├── background/                # Service worker modules
│   ├── service-worker.js      # Entry point
│   ├── debugger-manager.js    # Debugger lifecycle
│   ├── interceptor.js         # CDP Fetch handling
│   ├── rule-engine.js         # Rule matching
│   └── script-bridge.js       # Sandbox communication
├── storage/
│   └── storage-manager.js     # Rule CRUD + session state
├── popup/                     # Extension popup UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── sandbox/                   # Sandboxed page for user script execution
│   ├── sandbox.html
│   └── sandbox.js
├── offscreen/                 # Offscreen doc bridging SW ↔ sandbox
│   ├── offscreen.html
│   └── offscreen.js
├── content/
│   └── content.js             # Content script (future use)
└── assets/icons/              # Extension icons
```

## How It Works

ModNetwork has **two independent engines** running side-by-side:

### Engine 1: Native DNR (fast, always-on when tab is enabled)
1. You click the toggle button → the tab is marked as **enabled**
2. ModNetwork compiles your Redirect, Block, and ModifyHeader rules into Chrome's native `declarativeNetRequest` engine, scoped only to your enabled tab
3. Chrome handles the network modifications natively — fully visible in DevTools, no debugger required

### Engine 2: AdvancedJS (powerful, attaches only when needed)
1. If you have an **AdvancedJS rule** matching the current tab's URL, the Chrome Debugger attaches
2. The CDP Fetch domain intercepts matching requests at the exact stages you specify
3. Your JavaScript functions execute in a **sandboxed iframe** and return modified data
4. The modified request/response continues through Chrome

> Turning off AdvancedJS rules automatically detaches the debugger — DNR rules keep running.

## Writing Transform Scripts

### Modify Response Body (e.g., replace header HTML)

```javascript
// This function receives the response and can modify it
// 'context' contains: request, response, tabId, url
// Return the modified response

const localHeader = await fetch('http://localhost:3000/header')
  .then(r => r.text());

const body = context.response.body;
context.response.body = body.replace(
  /<!-- HEADER_START -->[\s\S]*?<!-- HEADER_END -->/,
  localHeader
);

return context.response;
```

### Modify Request Headers

```javascript
// Add or modify request headers before sending
context.request.headers['X-Custom-Auth'] = 'my-token';
context.request.headers['X-Debug'] = 'true';

return context.request;
```

## License

Private — Not for distribution.
