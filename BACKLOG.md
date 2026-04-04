# ModNetwork — Backlog

Non-urgent improvements to address when time permits.

---

## UI / UX

- [ ] **Theme support**: Add light, dark, and auto (system preference) themes.
- [ ] **Custom Color Templates**: Allow users to define their own UI color variables (fully custom themes).
- [ ] **Profile Colors**: Allow assigning distinct colors to different profiles for visual categorization.
- [ ] **Popup sizing**: Make popup resizable if Chrome API allows, otherwise increase default size for better code editor experience.

---

## Features (Future)

- [ ] **Dashboard page**: Open full-tab page for complex config (code editor, logs, settings) — keep popup compact for quick controls (like Automa pattern).
- [ ] **Profiles**: Group rules into profiles and assign specific profiles to specific tabs vs globally.
- [ ] **cURL / HAR Import**: Auto-generate rule configurations by pasting raw requests from Chrome DevTools (cURL or HAR format).
- [ ] **Advanced URL Matchers**: Support Wildcard (Contains), Exact Equals, and full Regex matchers for granular rule targeting.
- [ ] **Log Prefixing**: Provide customizable logging prefixes per-rule so developers can easily filter extension logs in their console.
- [ ] **Tooltip Helpers**: Add customizable `?` icons next to rule types to provide inline usage examples and documentation.
- [ ] **Inline Validation & Errors**: Surface compilation errors, regex warnings, and JS syntax issues directly on the rule cards to help users debug configuration issues.
- [ ] **In-Tab Active Indicator**: Inject a subtle floating badge or viewport border into the DOM of tabs that are actively being modified by the extension, making it obvious which tabs are affected without opening the popup.
- [ ] **Design Kit & Theming Architecture**: Create a central `styles/` folder containing a dedicated UI component library, standardized design tokens, and a single source of truth for the Extension's aesthetic to guarantee a premium, minimalist appearance across the popup and any future dashboards.
- [ ] **Proxy Mode vs Redirect**: Provide a "Transparent Proxy" rule type that fetches from a different server and fulfills the request silently without changing the browser URL.
- [ ] **Postman-style Helper APIs**: Inject a wrapper API into the Advanced JS context (e.g., `context.response.json()`) to abstract away complex String manipulation and DOMParsers.
- [ ] **Code Editor Upgrades**: Integrate Monaco or CodeMirror for actual JS syntax highlighting and code formatting in the Advanced JS view.
- [ ] **Import/export rules**: JSON export/import for backup and sharing.
- [ ] **Request/response log viewer**: Show recent intercepted requests and what was modified.
- [ ] **Script templates/snippets**: Pre-built transform examples users can insert.
- [ ] **Syntax highlighting**: Custom code highlighting in script editor (no library).
- [ ] **Script error display**: Show script execution errors inline in the editor.
- [ ] **Breakpoints**: Pause and inspect before continuing a request.
- [ ] **URL redirect rules**: Simple redirect without writing JS.
- [ ] **Headers-only mode**: Modify headers without touching the body (faster).
- [ ] **Rule ordering/priority**: Control which rules run first.
- [ ] **Rule search/filter**: Search rules by name or pattern.
- [ ] **Keyboard shortcuts**: Quick-access hotkeys.

---

## Technical Debt

- [ ] Remove verbose debug logging once stable (the `⚡📦🔧🎉` logs).
- [ ] Add proper error boundaries in popup.
- [ ] Performance: Only intercept resource types that have matching rules.
