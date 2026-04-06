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
