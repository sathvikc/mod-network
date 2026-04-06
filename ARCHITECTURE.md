# ModNetwork — Architecture Diagram

> v0.20.x · Two-Engine MV3 Architecture

## Full System Flow

```mermaid
flowchart TD
    subgraph USER["User"]
        Popup["Popup UI\npopup.js"]
    end

    subgraph TAB["Active Browser Tab"]
        Page["Web Page\n(network requests)"]
        Indicator["indicator.js\ncontent script — runs on all URLs"]
    end

    subgraph SW["Service Worker (background)"]
        SWMain["service-worker.js\nEvent Router · Message Hub\nChrome event listeners"]
        DM["debugger-manager.js\nCDP Attach/Detach Lifecycle\nENABLED_TABS ↔ ATTACHED_TABS"]
        RE["rule-engine.js\nURL Matching · DNR Compile\ngenerateFetchPatterns · syncDNRRules"]
        IC["interceptor.js\nCDP Fetch.requestPaused handler\nRequest + Response stage router"]
        Bridge["script-bridge.js\nOffscreen Document bridge\nensureOffscreenDocument"]
    end

    subgraph OFFSCREEN["Offscreen Document"]
        OJS["offscreen.js\nReceives EXECUTE_SCRIPT msg\nProxies fetch for sandbox"]
        Sandbox["sandbox.js\nsandboxed iframe\nAsyncFunction constructor\neval allowed here"]
    end

    subgraph STORAGE["Storage"]
        Local["chrome.storage.local\nprofiles · globalEnabled · activeProfileId\n(in-memory cache in storage-manager.js)"]
        Session["chrome.storage.session\nENABLED_TABS — tabs user activated\nATTACHED_TABS — tabs with live debugger"]
    end

    subgraph ENGINE1["Engine 1 — declarativeNetRequest"]
        DNR["Session Rules\nBlock · Redirect · ModifyHeader\nscoped to condition.tabIds = ENABLED_TABS"]
    end

    subgraph ENGINE2["Engine 2 — Chrome Debugger (CDP)"]
        CDP["chrome.debugger\nFetch.enable · Fetch.requestPaused\nFetch.continueRequest · Fetch.fulfillRequest\nFetch.getResponseBody"]
    end

    %% ── User interactions ──
    Popup -->|"TOGGLE_TAB / SAVE_PROFILE\nUPDATE_PROFILE / DELETE_PROFILE\nTOGGLE_PROFILE / SET_ACTIVE_PROFILE\nSET_GLOBAL_ENABLED / GET_TAB_STATUS"| SWMain

    %% ── Content script ──
    Indicator -->|"CHECK_ACTIVE_STATUS + url"| SWMain
    SWMain -->|"active: true/false"| Indicator
    Indicator -->|"inject glow bar + toast\nif active"| Page

    %% ── Service Worker internal wiring ──
    SWMain -->|"toggleTab / attachToTab\ndetachFromTab / sweepDebuggerAttachments"| DM
    SWMain -->|"syncDNRRules\nisAnyRuleActiveForUrl\nhasAdvancedJSRuleForUrl"| RE
    SWMain -->|"chrome.debugger.onEvent\n→ Fetch.requestPaused"| IC

    %% ── Engine 1: DNR ──
    RE -->|"updateSessionRules\nregexFilter · tabIds constraint"| DNR
    RE <-->|"getProfiles · getGlobalEnabled\ngetActiveProfileId · getEnabledTabs"| Local
    DNR -->|"intercepts matching requests\nautomatically"| Page

    %% ── Engine 2: CDP ──
    DM <-->|"addAttachedTab · removeAttachedTab\ngetAttachedTabs"| Session
    DM <-->|"addEnabledTab · removeEnabledTab\ngetEnabledTabs"| Session
    DM -->|"debugger.attach\nFetch.enable patterns"| CDP
    CDP -->|"Fetch.requestPaused event"| IC

    %% ── Interception pipeline ──
    IC -->|"findMatchingRules\ngenerateFetchPatterns"| RE
    IC -->|"executeScript(code, context)"| Bridge
    Bridge -->|"EXECUTE_SCRIPT msg\nchrome.runtime.sendMessage"| OJS
    OJS -->|"postMessage to iframe"| Sandbox
    Sandbox -->|"new AsyncFunction\nexecutes user script"| Sandbox
    Sandbox -->|"result postMessage"| OJS
    OJS -->|"sendResponse"| Bridge
    Bridge -->|"modified context"| IC
    IC -->|"Fetch.continueRequest\nor Fetch.fulfillRequest"| CDP

    %% ── Request interception ──
    Page -->|"all network requests"| DNR
    Page -->|"all network requests\n(when debugger attached)"| CDP
```

---

## State Gates — What controls when rules fire

| Gate | Storage Key | Set By | Required For |
|---|---|---|---|
| `globalEnabled` | `chrome.storage.local` | Global toggle in popup | Everything — both engines |
| `ENABLED_TABS` | `chrome.storage.session` | User clicks "Attach API" | DNR `tabIds` scope + debugger lifecycle |
| `ATTACHED_TABS` | `chrome.storage.session` | `attachToTab()` | Confirms live CDP session |
| `activeProfileId` | `chrome.storage.local` | User selects profile | Which profile's rules compile |
| Profile `enabled` flag | `chrome.storage.local` | Profile toggle | Whether profile rules compile |

---

## Request Lifecycle

### Engine 1 — Block / Redirect / ModifyHeader

```
User enables tab
  → addEnabledTab(tabId)
  → syncDNRRules()
  → compile session rules with condition.tabIds = [tabId]

Browser makes request
  → Chrome DNR matches rule automatically (no SW involvement)
  → Block / Redirect / ModifyHeader applied transparently
```

### Engine 2 — AdvancedJS Body Modification

```
User enables tab + AdvJS rule matches tab URL
  → attachToTab(tabId)
  → chrome.debugger.attach({ tabId })
  → Fetch.enable({ patterns: [domain-locked patterns] })

Browser makes request
  → Fetch.requestPaused fires in service-worker.js
  → interceptor.js routes to Request or Response stage handler
  → findMatchingRules() finds enabled AdvJS mods matching URL
  → script-bridge.js → offscreen.js → sandbox.js
  → user script runs: AsyncFunction(context, fetch, scriptCode)
  → result returned back through the chain
  → Fetch.continueRequest (modified request headers)
  → Fetch.fulfillRequest (modified response body)
```

---

## Profile Activation Logic (`isProfileActive`)

```
profile.enabled = false  →  inactive (always)
profile.pinned = true    →  always active (if enabled)
activeProfileId set      →  only the matching profile is active
activeProfileId = null   →  first profile in list acts as default
```

---

## Known Issues / Parked Work

| # | Location | Issue | Status |
|---|---|---|---|
| 1 | `service-worker.js:414` | `CHECK_ACTIVE_STATUS` did not check `ENABLED_TABS` → indicator could show on un-enabled tabs if rule is `*://*/*` | **Fixed** |
| 2 | `debugger-manager.js:99` | `isAttached()` returns `isTabEnabled()` not actual `ATTACHED_TABS` state → popup shows "Intercepting" when tab is merely enabled | Open |
| 3 | `dashboard.js` | Entire dashboard uses non-existent message types (`GET_RULES`, `SAVE_RULE`, etc.) — leftover from flat-rules architecture | **Parked — rebuild planned** |
| 4 | `debugger-manager.js:222` | `updateActiveDebuggers()` called `generateFetchPatterns()` without `tabId` — domain-locking lost on rule updates | **Fixed** |
| 5 | `service-worker.js:380` | `DELETE_PROFILE` did not clear stale `activeProfileId` → `isProfileActive` returned false for all profiles after deletion | **Fixed** |
