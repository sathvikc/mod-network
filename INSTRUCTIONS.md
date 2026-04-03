# ModNetwork — Session Instructions

> **Read this file at the start of every session to understand the project, architecture, and current state.**

## What Is This?

ModNetwork is a **local-only Chrome extension** that uses the **Chrome Debugger API (CDP Fetch domain)** to intercept and modify network requests and responses. It's a power-user tool for web developers who need to:

- Replace parts of a page's HTML with locally-served content
- Modify request/response headers and bodies
- Inject or transform data flowing through the browser

**Key design principle**: Users write **JavaScript** to control everything. The extension provides the interception infrastructure; user scripts define what to modify.

## Architecture

```
Service Worker (background)
├── service-worker.js    — Entry point, event registration, message routing
├── debugger-manager.js  — Attach/detach Chrome Debugger to tabs
├── interceptor.js       — Handle Fetch.requestPaused CDP events
├── rule-engine.js       — Match URL patterns + resource types to rules
└── script-bridge.js     — Communication with sandbox for script execution

Sandbox (user script execution)
├── sandbox.html         — Sandboxed page (CSP allows eval)
└── sandbox.js           — Executes user JS via AsyncFunction constructor

Offscreen Document (bridge)
├── offscreen.html       — Hosts sandboxed iframe
└── offscreen.js         — Relays between service worker and sandbox

Popup UI
├── popup.html           — Two views: rules list + rule editor
├── popup.css            — Premium dark theme
└── popup.js             — UI logic, rule CRUD, code editor

Storage
└── storage-manager.js   — chrome.storage.local (rules) + session (tab state)

Content Script
└── content.js           — Scaffold for future DOM operations
```

## How The Interception Pipeline Works

1. User clicks toggle button → Service Worker attaches Chrome Debugger to tab
2. CDP `Fetch.enable` is sent with patterns for Request and Response stages
3. When a page makes a network request:
   - `Fetch.requestPaused` event fires in the service worker
   - Rule Engine finds matching rules by URL pattern + resource type
   - If at **Request stage**: user's `onBeforeRequest` script can modify URL, method, headers, body
   - If at **Response stage**: `Fetch.getResponseBody` gets the body, user's `onResponse` script can modify body, headers, status
4. User scripts execute in a **sandboxed iframe** (CSP allows eval there)
   - Service Worker → runtime message → Offscreen Document → postMessage → Sandbox
   - Results flow back the same path
5. Modified data is sent via `Fetch.fulfillRequest` or `Fetch.continueRequest`

## User Script Context

Scripts receive a `context` object:

```javascript
// onBeforeRequest
context = {
  request: { url, method, headers, postData },
  tabId: number,
  url: string,
  stage: 'request'
}

// onResponse  
context = {
  request: { url, method, headers },
  response: { body, headers, statusCode },
  tabId: number,
  url: string,
  stage: 'response'
}
```

Scripts should modify and return the context (or `context.request` / `context.response`).

## Rule Schema

```javascript
{
  id: 'uuid',
  name: 'Human readable name',
  enabled: true,
  match: {
    urlPattern: '*://example.com/*',      // Wildcard URL pattern
    resourceTypes: ['Document', 'XHR']     // CDP resource types
  },
  scripts: {
    onBeforeRequest: 'js code string',     // null if not used
    onResponse: 'js code string'           // null if not used
  },
  createdAt: timestamp,
  updatedAt: timestamp
}
```

## Key Technical Decisions

1. **Chrome Debugger API** over webRequest/declarativeNetRequest — only way to modify response bodies
2. **Sandbox for eval** — MV3 CSP blocks eval in service workers and extension pages, but sandboxed pages allow it
3. **Offscreen document as bridge** — service workers can't create iframes, so we use chrome.offscreen API
4. **ES modules** in service worker — cleaner code organization (`"type": "module"` in manifest)
5. **No external dependencies** — everything is vanilla JS, CSS, HTML
6. **chrome.storage.session** for ephemeral state — tracks which tabs have debugger attached (survives SW restarts)

## Development Setup

1. `chrome://extensions/` → Developer mode → Load unpacked → select `src/` directory
2. Click the ModNetwork icon in the toolbar to open popup
3. Toggle interception on a tab, create rules with JS scripts
4. Service worker logs: click "service worker" link on extensions page

## Current State

Check `PROGRESS.md` for completed milestones and `BACKLOG.md` for the full backlog details.

**What's working:**
- Extension loads, popup shows rules, toggle attaches Chrome Debugger
- CDP Fetch interception pipeline: Request and Response stages
- User scripts execute in sandboxed iframe with fetch proxy
- Rule CRUD (create, read, update, delete, toggle)
- Badge shows ON state, persists through page reloads
- Test server (`test/server.js`) demonstrates header replacement use case

## Backlog

> See `BACKLOG.md` for full details. Key items below.

### UI / UX
- [ ] **Dashboard page** — Automa-style: compact popup for quick controls, full-tab page for code editor and complex config
- [ ] **Theme support** — Light, dark, and auto (system preference). Currently dark-only
- [ ] **Popup sizing** — Increase default size or make resizable for better code editor UX

### Features
- [ ] **Import/export rules** — JSON backup and sharing
- [ ] **Request/response log viewer** — Show intercepted requests and modifications
- [ ] **Script templates/snippets** — Pre-built transform examples
- [ ] **Syntax highlighting** — Custom highlighting in script editor (no library)
- [ ] **Script error display** — Show errors inline in editor
- [ ] **Breakpoints** — Pause and inspect before continuing
- [ ] **URL redirect rules** — Simple redirect without writing JS
- [ ] **Headers-only mode** — Modify headers without touching body (faster)
- [ ] **Rule ordering/priority** — Control execution order
- [ ] **Keyboard shortcuts** — Quick-access hotkeys

### Technical Debt
- [ ] Remove verbose debug logging once stable
- [ ] Add error boundaries in popup
- [ ] Only intercept resource types that have matching rules

## Git Conventions

- Prefix: `init:`, `feat(scope):`, `fix(scope):`, `docs:`, `style:`, `refactor:`, `chore:`
- Scope examples: `manifest`, `storage`, `background`, `popup`, `sandbox`, `content`
- Keep commits granular — one logical change per commit

## Versioning

**Follows Semantic Versioning (semver)** driven by commit types:

| Commit Type | Version Bump | Example |
|---|---|---|
| `fix:` | **Patch** (0.0.X) | Bug fix, typo, error handling |
| `feat:` | **Minor** (0.X.0) | New feature, new capability |
| Breaking change | **Major** (X.0.0) | Incompatible API/schema change |
| `docs:`, `style:`, `chore:`, `refactor:` | No bump | Non-functional changes |

**Version must be updated in TWO places:**
1. `src/manifest.json` → `"version"` field
2. Popup reads it automatically via `chrome.runtime.getManifest().version`

**When to bump:** After committing a `fix:` or `feat:` change, update the version in `manifest.json` and commit as `chore: bump version to X.Y.Z`.
