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

There are **two independent engines** that operate side-by-side:

### Engine 1: Native DNR (Redirect, Block, ModifyHeader)
1. User clicks toggle button in the popup → tab is added to `ENABLED_TABS` session storage
2. `syncDNRRules()` fires and compiles all active DNR rules into Chrome Session Rules scoped to `ENABLED_TABS`
3. Chrome natively applies blocks, redirects, and header modifications before the request reaches the network
4. These rules work **without the Chrome Debugger being attached** and are always visible in DevTools

### Engine 2: AdvancedJS (chrome.debugger / CDP)
1. If the tab is in `ENABLED_TABS` AND an AdvancedJS rule matches the tab's URL, the Chrome Debugger attaches
2. CDP `Fetch.enable` is sent with **surgical match patterns** locked to the current tab's domain (e.g. `*://localhost:8765/api/*`)
3. When a page makes a matching network request:
   - `Fetch.requestPaused` event fires
   - Rule Engine finds matching AdvancedJS rules by URL + resource type
   - If at **Request stage**: `onBeforeRequest` script can modify URL, method, headers, body
   - If at **Response stage**: `onResponse` script can modify body, headers, status
4. User scripts execute in a **sandboxed iframe** (CSP allows eval there)
   - Service Worker → runtime message → Offscreen Document → postMessage → Sandbox
   - Results flow back the same path
5. Modified data is sent via `Fetch.fulfillRequest` or `Fetch.continueRequest`
6. Headers are only passed to `Fetch.continueRequest` if the script actually changed them (prevents overwriting DNR header modifications)

### Execution Priority Order
```
Priority 4  — BlockRequest      (DNR, native)
Priority 3  — Redirect          (DNR, native)
Priority 2  — ModifyHeader      (DNR, native, visible in DevTools)
Exec Stage  — AdvancedJS        (chrome.debugger Fetch API)
```

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

1. **Two-engine architecture**: DNR (native) for headers/redirect/block; chrome.debugger (CDP) for body modification. They are fully decoupled.
2. **ENABLED_TABS vs ATTACHED_TABS**: `ENABLED_TABS` tracks user intent (toggle ON). `ATTACHED_TABS` tracks which tabs have the heavy debugger hook active (only when AdvJS rules exist). This means turning off AdvJS rules never breaks DNR.
3. **Smart URL Pattern Compiler** (`parseSmartUrlPattern`): Converts user-friendly partial inputs into strict regex. Used by both DNR and AdvancedJS engines for 1:1 match parity.
4. **Surgical CDP patterns** (`parseChromeMatchPattern`): For `Fetch.enable`, uses valid Chrome match strings (not regex), domain-locked to the active tab host. Prevents over-interception of CSS/fonts which causes "Provisional headers" in DevTools.
5. **Sandbox for eval** — MV3 CSP blocks eval in service workers and extension pages, but sandboxed pages allow it
6. **Offscreen document as bridge** — service workers can't create iframes, so we use chrome.offscreen API
7. **ES modules** in service worker — cleaner code organization (`"type": "module"` in manifest)
8. **No external dependencies** — everything is vanilla JS, CSS, HTML
9. **chrome.storage.session** for ephemeral state — two arrays: `ENABLED_TABS` and `ATTACHED_TABS` (both survive SW restarts)

## Development Setup

1. `chrome://extensions/` → Developer mode → Load unpacked → select `src/` directory
2. Click the ModNetwork icon in the toolbar to open popup
3. Toggle interception on a tab, create rules with JS scripts
4. Service worker logs: click "service worker" link on extensions page

## Current State (v0.20.3)

Check `PROGRESS.md` for completed milestones and open questions. Check `BACKLOG.md` for full backlog. Check `ARCHITECTURE.md` for Mermaid diagram.

**What's working:**
- Extension loads, popup shows rules, toggle adds tab to `ENABLED_TABS`
- DNR engine (ModifyHeader, Redirect, BlockRequest) runs natively and is always active when tab is enabled
- Chrome Debugger (AdvancedJS) attaches only when enabled AND AdvJS rules match the current URL
- CDP Fetch interception pipeline: Request and Response stages
- User scripts execute in sandboxed iframe with fetch proxy
- Rule CRUD (create, read, update, delete, toggle)
- Badge shows `ON` state driven by `ENABLED_TABS` (not debugger attachment)
- Smart URL matching: partial URLs, path-only inputs, domain inputs all compile correctly
- Tab navigation cleans up `ENABLED_TABS` and `ATTACHED_TABS` gracefully
- In-memory cache for profiles/globalEnabled/activeProfileId (avoids hot-path storage reads)
- Write mutex serializes all profile mutations
- Schema v3 with migration runner on startup
- `CHECK_ACTIVE_STATUS` (glow bar indicator) gated on ENABLED_TABS — only shows on user-enabled tabs
- `updateActiveDebuggers` passes `tabId` per-tab — domain-locking preserved on rule updates
- `DELETE_PROFILE` clears stale `activeProfileId` — prevents all rules silently stopping after deletion
- Header guard in `interceptor.js` uses sorted-key comparison — immune to CDP vs user-script key-order differences (v0.20.3)

**Known limitations:**
- "Provisional headers" warning in DevTools for AdvJS-intercepted requests (unavoidable when Debugger is attached)
- "Attach API" toggle button is a full kill switch (removes tab from ENABLED_TABS, stops both engines). Planned to be replaced with auto-attach based on rule matching.
- Dashboard page (`src/dashboard/dashboard.js`) is non-functional — uses old flat-rules API. Parked for rebuild.
- DNR response header modifications may be bypassed when AdvJS also modifies the response body (open question — needs testing, see PROGRESS.md)
- DNR response header modifications may be bypassed when AdvJS calls `Fetch.fulfillRequest` — needs empirical test (see PROGRESS.md Q2)

**Next planned feature:**
- Profile-Level Environment Variables (`{{VAR}}`) for dev/staging/prod switching without editing rules
- Auto-attach architecture (remove "Attach API" button, auto-populate ENABLED_TABS from rule matches)

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

## Agent Workflow & Testing Checklist

> **AI Agent Instructions**: Follow this strict workflow loop for every task. You must **make the change**, **test the change**, **commit the change**, and then **continue with the next task**.

### Agent Checklist:
1. [ ] **Make the Change**: Formulate and apply the code changes for the current task.
2. [ ] **Test the Change**:
   - [ ] Verify JavaScript syntax and logic.
   - [ ] Ask the user to **Reload the Extension** in `chrome://extensions` to pick up the new changes (or use the browser subagent to click reload).
   - [ ] Invoke the `browser_subagent` to open `src/popup/popup.html` and verify the UI rendering.
   - [ ] Invoke the `browser_subagent` to visit the target test site (e.g., `http://localhost:8765` running via `node test/server.js`) to ensure the interception or feature functions end-to-end.
3. [ ] **Commit the Change**: Run the included commit script: `node scripts/commit.js "type(scope): message"`. The script handles git staging, committing, and auto-bumping the semantic version in the manifest.
4. [ ] **Proceed to Next Task**: Read from the BACKLOG.md, begin the next task, and repeat this cycle.
