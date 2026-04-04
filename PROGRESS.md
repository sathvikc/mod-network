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
- [ ] **Intelligent Auto-Attach** — Automatically attach debugger to tabs matching JS rules
- [ ] **Context-Aware Detach** — Silently detach debugger when match is lost to hide yellow banner
- [ ] **Privacy-First Sweep** — Global/Profile toggles actively scan and clean up debugger instances

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
