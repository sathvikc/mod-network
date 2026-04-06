# ModNetwork — Backlog

Non-urgent improvements to address when time permits.

---

## UI / UX

- [ ] **Theme support**: Add light, dark, and auto (system preference) themes.
- [ ] **Custom Color Templates**: Allow users to define their own UI color variables (fully custom themes).
- [ ] **Profile Colors**: Allow assigning distinct colors to different profiles for visual categorization.
- [ ] **Popup sizing**: Make popup resizable if Chrome API allows, otherwise increase default size for better code editor experience.

---

## Features (Next Up)

- [ ] **Profile-Level Variables** — Postman-style environment variables (`{{API_BASE}}`, `{{AUTH_TOKEN}}`) on each profile. Rules and scripts interpolate these in URL patterns, header values, and redirect URLs. Enables switching between dev/staging/prod without editing rules. **This is the safe way to handle default domains for path-only patterns.**
- [ ] **cURL / HAR Import** — Auto-generate rule configurations by pasting raw requests from Chrome DevTools (cURL or HAR format).

---

## Features (Future)

- [ ] **Dashboard page** — Open full-tab page for complex config (code editor, logs, settings); keep popup compact for quick controls (Automa pattern).
- [ ] **Profiles** — Group rules into profiles and assign specific profiles to tabs vs globally.
- [ ] **Advanced Environmental Filters UI (Roadmap)** — Support filters like Tab ID, Window ID, Tab Group, Auto-off Timer, and Method filters. Architecturally, consider:
  - *Pattern A (Profile-Level)*: Workspace has a global `contextFilters: {}` acting as a gatekeeper.
  - *Pattern B (Rule-Level)*: Highly granular context matches for individual dense-row actions.
  - *Pattern C (Filter-as-a-Rule-Type)*: Add `{ type: 'TabFilter' }` into the `rules` array itself, acting as a logical "middleware" that drops execution for subsequent rules if conditions aren't met.
    - *Why this is powerful*: It keeps the schema incredibly simple (just one `rules` array). It allows users to control the order (e.g., run a JS modifier first, THEN check a timer, THEN modify headers). It fits beautifully into a drag-and-drop dashboard pipeline.
    - *Example Pipeline*: `[ { type: 'AdvancedJS' }, { type: 'TimerFilter', expiresAt: 1234 }, { type: 'ModifyHeader' } ]`
- [ ] **cURL / HAR Import**: Auto-generate rule configurations by pasting raw requests from Chrome DevTools (cURL or HAR format).
- [ ] **Advanced URL Matchers**: Support Wildcard (Contains), Exact Equals, and full Regex matchers for granular rule targeting.
- [ ] **Rule Tags & Groups**: Add `tags` and optional `group` fields on rules for UI filtering, bulk enable/disable by tag, and visual organization. Tags are more flexible than strict folders since a rule can belong to multiple categories.
- [ ] **Rule Ordering via `order` Field**: Add an explicit numeric `order` field to rules (increments of 10) to decouple execution priority from array position. Predictable, user-controllable execution order.
- [ ] **Rule Event Hooks**: Extend AdvancedJS beyond `onBeforeRequest`/`onResponse` with `onError` (custom error pages, retry logic) and `onConnect` (WebSocket interception).
- [ ] **Script Versioning & Undo**: Store `previousCode` alongside current script content for one-level undo. Scripts are already separated in the normalized schema, making this cheap. Cap full `versions[]` history at 5-10 entries.
- [ ] **Import/Export with Schema Version**: JSON export includes `schemaVersion` for forward-compatible imports. Normalized schema makes export trivial — profile + referenced rules + scripts as a single payload.
- [ ] **Profile-Level URL Scoping**: Optional `profileMatch` field on profiles (e.g., `*://example.com/*`) as a gate before per-rule matching. Avoids repeating the same URL pattern on every rule within a profile.
- [ ] **Log Prefixing**: Provide customizable logging prefixes per-rule so developers can easily filter extension logs in their console.
- [ ] **Tooltip Helpers**: Add customizable `?` icons next to rule types to provide inline usage examples and documentation.
- [ ] **Inline Validation & Errors**: Surface compilation errors, regex warnings, and JS syntax issues directly on the rule cards to help users debug configuration issues.
- [ ] **In-Tab Active Indicator**: Inject a subtle floating badge or viewport border into the DOM of tabs that are actively being modified by the extension, making it obvious which tabs are affected without opening the popup.
- [ ] **Design Kit & Theming Architecture**: Create a central `styles/` folder containing a dedicated UI component library, standardized design tokens, and a single source of truth for the Extension's aesthetic to guarantee a premium, minimalist appearance across the popup and any future dashboards.
- [ ] **Proxy Mode vs Redirect**: Provide a "Transparent Proxy" rule type that fetches from a different server and fulfills the request silently without changing the browser URL.
- [ ] **Postman-style Helper APIs**: Inject a wrapper API into the Advanced JS context (e.g., `context.response.json()`) to abstract away complex String manipulation and DOMParsers.
- [ ] **Code Editor Upgrades**: Integrate Monaco or CodeMirror for actual JS syntax highlighting and code formatting in the Advanced JS view.
- [ ] **Request/response log viewer**: Show recent intercepted requests and what was modified.
- [ ] **Script templates/snippets**: Pre-built transform examples users can insert.
- [ ] **Syntax highlighting**: Custom code highlighting in script editor (no library).
- [ ] **Script error display**: Show script execution errors inline in the editor.
- [ ] **Breakpoints**: Pause and inspect before continuing a request.
- [ ] **Headers-only mode**: Modify headers without touching the body (faster).
- [ ] **Rule search/filter**: Search rules by name or pattern.
- [ ] **Keyboard shortcuts**: Quick-access hotkeys.

---

## Storage & Architecture

- [ ] **Schema Normalization — Separate Scripts into Lazy-Loaded Storage**: Store AdvancedJS script strings in `modnetwork_scripts` keyed by script ID, separate from rule metadata. The hot path (match-checking) never touches scripts; they're loaded only when the interceptor needs to execute. Prevents quota pressure from large scripts.
- [ ] **Computed Domain Match Index**: On cache invalidation, pre-compute a `domain → ruleIds` lookup map. Enables O(1) domain matching instead of iterating all rules with regex. Matters at scale (50+ rules).
- [ ] **Quota Validation on Save**: Check `chrome.storage.local.getBytesInUse()` before writing large script updates. Surface warnings in the UI when approaching the 10MB quota (or declare `unlimitedStorage` permission).

### Auto-Attach Architecture (removes "Attach API" button)

- [ ] **Auto-populate ENABLED_TABS**: On `tabs.onUpdated` and `tabs.onActivated`, if `globalEnabled` AND any active rule matches the tab URL → auto-add to `ENABLED_TABS` + call `syncDNRRules()`. Remove the requirement for the user to manually click "Attach API".
- [ ] **Sweep all open tabs on rule changes**: Modify `_doSweepDebuggerAttachments` to evaluate ALL open Chrome tabs (not just ENABLED_TABS). Tabs with no matching rules should be removed from ENABLED_TABS; tabs with matching rules auto-added.
- [ ] **Remove "Attach API" toggle button from popup**: Once auto-attach is wired, the button is redundant. Consider replacing with a per-tab opt-out ("Pause for this tab") instead of the current opt-in model.
- [ ] **Auto-remove from ENABLED_TABS on navigation**: When a tab navigates to a URL that no longer matches any rule, remove it from ENABLED_TABS and recompile DNR. Currently `tabs.onUpdated` skips this step if tab was never manually enabled.

---

## Technical Debt

- [ ] Remove verbose debug logging once stable (the `⚡📦🔧🎉` logs).
- [ ] Add proper error boundaries in popup.
- [ ] Performance: Only load AdvJS scripts when the interceptor actually needs to execute them (hot path currently loads everything).
- [ ] Remove legacy `modnetwork_rules` → profiles migration code from `runMigrations()`. No user should have pre-v0.12.0 data after the v3 migration runs.
- [ ] **Popup `add-mod-btn` creates rules inline without `createRule()`** — new rules have no type-specific defaults (no `headers` array for ModifyHeader, no `scripts` for AdvancedJS). Fix: use `createRule(type)` from storage-manager in the `add-mod-btn` handler in `popup.js`.
- [ ] **Popup only supports one header per ModifyHeader rule** — `mod.headers[0]` hardcoded. Multi-header UI needed.
- [ ] **`isAttached()` in `debugger-manager.js` returns `isTabEnabled()`** — misleading; means popup shows "Debugger Attached" even for DNR-only tabs. Rename or split: use `isTabEnabled` for the badge/status indicator, `isTabAttached` for actual CDP state. Fix popup label from "Debugger Attached" → "Intercepting".
- [ ] **DNR response header modifications may be bypassed when AdvJS calls `Fetch.fulfillRequest`** — `fulfillRequest` replaces the entire response; if Chrome's DNR response-header rules run AFTER CDP Fetch, they are skipped. Needs empirical testing on Chrome ≥ 120. (See PROGRESS.md open questions.)
- [ ] **Architecture Note**: The two-engine design (`ENABLED_TABS` for DNR + `ATTACHED_TABS` for Debugger) is now stable. Any future change to tab attachment logic must maintain this decoupling or DNR features will break when AdvJS is disabled.
