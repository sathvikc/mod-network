# ModNetwork — Progress Tracker

## Milestone 1: Core Extension Foundation ✅
- [x] Project initialized with git & storage-manager logic
- [x] **MV3 Architecture** — Debugger, offscreen sandbox, and declarativeNetRequest (DNR)
- [x] **DNR Engine** — Core Header modification and URL Redirect support
- [x] **Debugger Engine** — Attach/detach logic for heavy response body modification
- [x] **Sandbox Runtime** — Postman-style API (`context.json()`, `context.getRequestHeader()`)
- [x] **Workspace Profiles** — Multi-profile support with nested Mods

## Milestone 2: UI & UX Excellence ✅
- [x] **Sidebar Dashboard** — Ultra-dense 2-column sidebar UI
- [x] **Professional Styling** — Dark theme with CSS pill-sliders (ui-switch)
- [x] **Global Toggle** — Extension-wide master switch
- [x] **Extension Badge** — "ON" label indicates active global status (v0.7.0)
- [x] **Workspace Management** — Create, Delete, and Toggle profile workspaces

## Milestone 3: In-Tab Feedback & Security ✅
- [x] **Visual Indicators** — Persistent Top-Border Glow & 3s Ephemeral Toast (v0.7.0)
- [x] **DNR Visibility** — manifestation of `declarativeNetRequestFeedback` for Network tab tracking
- [x] **Test Suite** — Mock SVG Image server for Redirect testing (`cat.svg` -> `dog.svg`)

---

## Milestone 4: Unified Interception Engine ✅
- [x] **Intelligent Auto-Attach** — Automatically attach debugger to tabs matching AdvancedJS rules (on navigation + startup scan)
- [x] **Context-Aware Detach** — Silently detach debugger when tab navigates to a URL with no matching AdvancedJS rules
- [x] **Privacy-First Sweep** — Global/Profile/Mod toggles sweep all attached tabs and detach if rules no longer match
- [x] **Smart URL Compiler** (`parseSmartUrlPattern`) — Converts partial user inputs (`/api/`, `localhost:8765`) into strict regex patterns; shared by both DNR and AdvancedJS engines for 1:1 match parity
- [x] **Domain-Locked Matching** — When tab domain is known, path-only inputs auto-bind to that host (e.g. `/api/` → `localhost:8765/api/*`)
- [x] **Surgical CDP Patterns** (`parseChromeMatchPattern`) — `Fetch.enable` receives domain-locked Chrome URL match strings; prevents over-interception of CSS/fonts and reduces DevTools "Provisional headers" noise
- [x] **Two-Engine Decoupling: `ENABLED_TABS` vs `ATTACHED_TABS`** — DNR engine binds to user-enabled tabs (`ENABLED_TABS`); Chrome Debugger only attaches when AdvJS rules are active (`ATTACHED_TABS`). Disabling AdvJS no longer breaks Redirect/Block/ModifyHeader.
- [x] **Execution Priority Pipeline** — Block (4) > Redirect (3) > ModifyHeader (2) > AdvancedJS; AdvancedJS only passes headers to CDP if the script actually changed them
- [x] **Header Guard in Interceptor** — JSON structural diff prevents AdvancedJS from overwriting DNR-injected headers
- [x] **Tab Cleanup** — `tabs.onRemoved` cleans both `ENABLED_TABS` and `ATTACHED_TABS`; `tabs.onActivated` restores badge state from `ENABLED_TABS`

## UI / Incremental Improvements

- [x] **Active Workspace Indicator** — Selected profile is visually highlighted; clicking a profile activates it. Pin button keeps a workspace always active. `activeProfileId` persisted to `chrome.storage.local`.
- [ ] **Expand Active Rule Sections** — When a rule section has at least one enabled mod, expand it by default. Show a dot/count on the header when collapsed.

---

## Storage / Architecture (Already Implemented — moved from Backlog)

- [x] **In-Memory Cache** — `_cache = { profiles, globalEnabled, activeProfileId }` in `storage-manager.js`. Invalidated via `storage.onChanged`. Eliminates repeated storage reads on the hot interception path.
- [x] **Write Mutex** — `withProfileWriteLock` in `storage-manager.js`. Serializes all profile read-modify-write operations to prevent TOCTOU races.
- [x] **Schema Version & Migration Runner** — `runMigrations()` in `storage-manager.js`. Runs v1→v2 (mods→rules rename) and v2→v3 (key prefix removal + silent backup) on every startup.
- [x] **Schema v3** — All storage keys migrated from `modnetwork_*` prefixed keys to unprefixed keys.

---

## Bug Fixes (2026-04-06)

- [x] **Bug 1 — `CHECK_ACTIVE_STATUS` missing ENABLED_TABS gate** (`service-worker.js:419`) — Added `isTabEnabled(sender.tab?.id)` check. Without this, a `*://*/*` rule would show the glow-bar indicator on every page regardless of whether the user had enabled that tab.
- [x] **Bug 4 — `updateActiveDebuggers` lost domain-locking** (`debugger-manager.js:218`) — Now calls `generateFetchPatterns(tabId)` per-tab inside the loop instead of once globally with no tabId. Path-only patterns like `/api/*` now correctly resolve to the attached tab's host domain.
- [x] **Bug 5 — Stale `activeProfileId` after profile deletion** (`service-worker.js:380`) — `DELETE_PROFILE` now resets `activeProfileId` to null if the deleted profile was the active one. Prevents `isProfileActive` returning false for ALL profiles after deletion.

---

## Open Questions / Needs Testing

### Q1 — Req/Res ModifyHeader without AdvJS (Confidence: 97%)
DNR-only header modification is fully independent of the debugger. Confirmed via code trace (`_doSyncDNRRules` compiles rules to Chrome session rules with `condition.tabIds`). The 3% gap:
- Unverified: minimum Chrome version compatibility for `updateSessionRules` with `tabIds` constraint
- Unverified: whether Chrome silently drops a session rule if the `tabIds` array contains a closed/invalid tab ID vs. erroring
- Action: test on Chrome 108 (lowest MV3 with DNR session rules) and verify via `chrome.declarativeNetRequest.getSessionRules()` after compile

### Q2 — DNR response headers when AdvJS Fetch.fulfillRequest is called (Confidence: 60%)
**This is the highest-risk open question.** When AdvJS intercepts a response and calls `Fetch.fulfillRequest`, it passes explicit `responseHeaders` built from `params.responseHeaders` (the CDP event payload). The question is whether Chrome's DNR `modifyHeaders` (response) rules are applied before or after CDP Fetch pauses the response.

- If DNR response mods run BEFORE `Fetch.requestPaused` fires → they appear in `params.responseHeaders` → `Fetch.fulfillRequest` includes them → safe ✅
- If DNR response mods run AFTER CDP Fetch is done (on `Fetch.fulfillRequest`) → they are skipped entirely → DNR response headers silently lost ❌

There is no header guard equivalent on the response path (the request-stage guard exists at `interceptor.js:116`). If both DNR response headers and AdvJS body modification are configured, the result is unpredictable without empirical testing.
- **Action**: Create a test with a ModifyHeader (Response stage) rule AND an AdvancedJS (onResponse) rule on the same URL. Verify via DevTools Network tab that the DNR-added response header appears in the fulfilled response.

### Q3 — Block/Redirect/Headers when AdvJS rule disabled (Confidence: 98%)
Disabling an AdvJS rule runs `sweepDebuggerAttachments` → `detachFromTab` (removes from ATTACHED_TABS only) → tab stays in ENABLED_TABS → DNR continues. The 2% gap:
- Unverified: race condition in concurrent sweep + rule save. If `updateProfile` and `sweepDebuggerAttachments` run concurrently, the sweep sees a stale profile snapshot. The write mutex serializes storage writes but the sweep is NOT inside the mutex.
- Action: Confirm `withProfileWriteLock` in `updateProfile` completes before `sweepDebuggerAttachments` reads profiles. Current order in `service-worker.js:374`: `await updateProfile(...)` then `await sweepDebuggerAttachments()` — sequential, not concurrent. ✅ The 2% is theoretical only.

### Q4 — AdvJS doesn't clobber DNR request headers (Confidence: 100%) ✅ FIXED
Header guard in `interceptor.js` prevents passing headers to `Fetch.continueRequest` unless the script changed them.
- **Fix applied (v0.20.3)**: Replaced `JSON.stringify` comparison with a sorted-key comparison (`sortedStringify`). Header keys are sorted alphabetically before comparing, eliminating false-positive diffs from key-order differences between CDP responses and user script return values.
- Guard is now structurally correct — headers only forwarded to CDP when the user script genuinely changed header content.

### Q5 — Attach API removal / Auto-attach architecture
The "Attach API" toggle button (`toggleBtn` in popup) currently calls `TOGGLE_TAB` which adds/removes tabs from ENABLED_TABS. Removing it requires:
1. Auto-populate ENABLED_TABS in `tabs.onUpdated` when any rule matches the URL
2. Auto-remove from ENABLED_TABS when tab navigates to non-matching URL
3. Expand `_doSweepDebuggerAttachments` to scan ALL open tabs, not just current ENABLED_TABS
4. Use `isAnyRuleActiveForUrl(url)` (already in `rule-engine.js:139`) as the gate for ENABLED_TABS decisions
5. Remove `toggleBtn` from popup UI (or repurpose as "Pause for this tab" opt-out)
See BACKLOG.md → "Auto-Attach Architecture" section for full task list.

---

## Future Roadmap

### Milestone 5: Configuration & Developer Experience (Next)
- [ ] **Profile-Level Environment Variables** — Postman-style `{{VAR}}` interpolation in rule URLs, header values, and redirect URLs. Enables dev/staging/prod switching without editing rules.
- [ ] **cURL / HAR Import** — Auto-generate rules from DevTools cURL or HAR format
- [ ] **Script Console** — View sandbox log outputs in the popup
- [ ] **Rule Templates** — Pre-built snippets for common header/body transformations
- [ ] **JSON Path Editor** — Simplified UI for standard JSON response patches

### Milestone 6: Enterprise Features
- [ ] **Profile Sync** — Backup rules to Chrome account
- [ ] **Import/Export** — Share JSON workspace exports with teammates
- [ ] **Group Priority** — Conflict resolution between overlapping rules
