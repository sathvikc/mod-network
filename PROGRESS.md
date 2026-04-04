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

## Milestone 4: Smart Automation (Current) 🚧
- [x] **Intelligent Auto-Attach** — Automatically attach debugger to tabs matching AdvancedJS rules (on navigation + startup scan)
- [x] **Context-Aware Detach** — Silently detach debugger when tab navigates to a URL with no matching AdvancedJS rules
- [x] **Privacy-First Sweep** — Global/Profile/Mod toggles sweep all attached tabs and detach if rules no longer match

---

## UI Backlog

- [x] **Active Workspace Indicator** — Selected profile is visually highlighted; clicking a profile activates it (enables it + disables non-pinned others). Pin button (hover icon) keeps a workspace always active regardless of selection. `activeProfileId` persisted to `chrome.storage.local`.
- [ ] **Expand Active Rule Sections** — When a rule section (ModifyHeader / Redirect / AdvancedJS) has at least one enabled mod, expand it by default. If the user collapses it, show a subtle indicator (dot/count) on the section header to signal it contains active rules.

---

## Future Roadmap

### Milestone 5: Developer Experience
- [ ] **Script Console** — View log outputs from the sandbox in the popup
- [ ] **Rule Templates** — Pre-built snippets for common header/body hacks
- [ ] **JSON Path Editor** — Simplified UI for standard JSON response patches

### Milestone 6: Enterprise Features
- [ ] **Profile Sync** — Backup rules to Chrome account
- [ ] **Import/Export** — Share JSON workspace exports with teammates
- [ ] **Group Priority** — Conflict resolution between overlapping rules
