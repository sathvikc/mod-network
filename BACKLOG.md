# ModNetwork — Backlog

Non-urgent improvements to address when time permits.

---

## UI / UX

- [ ] **Theme support**: Add light, dark, and auto (system preference) themes. Currently dark-only.
- [ ] **Popup sizing**: Make popup resizable if Chrome API allows, otherwise increase default size for better code editor experience.

---

## Features (Future)

- [ ] **Dashboard page**: Open full-tab page for complex config (code editor, logs, settings) — keep popup compact for quick controls (like Automa pattern).
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
