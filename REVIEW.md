## 1. Project Overview

The “ModNetwork” extension is a Manifest V3 (MV3) tool that intercepts and modifies network requests. It achieves this by combining two Chrome APIs:

- **`chrome.declarativeNetRequest` (DNR)**: for handling header modifications and redirects efficiently.
- **`chrome.debugger` with the CDP Fetch domain**: for intercepting requests to execute user-provided Advanced JavaScript code.

The extension follows a service-worker-first architecture, with a reconcile pattern that centrally manages all state changes and applies them to the DNR engine and debugger sessions.

---

## 2. Code Files & Dependencies

The extension is split into seven functional modules:

| File | Responsibility |
| :--- | :--- |
| `service-worker.js` | Event registration, tab lifecycle, message handling, reconciliation pipeline. |
| `storage-manager.js` | `chrome.storage` abstraction with in‑memory caching and write‑lock for profiles, session state, and migrations. |
| `rule-engine.js` | Rule matching logic, DNR sync, generation of CDP `Fetch.enable` patterns, URL parsing. |
| `interceptor.js` | Core `Fetch.requestPaused` handler: executes user scripts, applies header rules, modifies request/response. |
| `script-bridge.js` | Communication layer between the service worker and the sandbox (via the offscreen document). |
| `offscreen.js` | Bridge script that runs inside the offscreen document, forwarding messages to the sandbox. |
| `sandbox.js` | Sandboxed iframe script that executes user-provided JavaScript code in a safe, `eval`-enabled environment. |

### 2.1 Required Manifest Permissions
Based on the code, the following permissions and keys must be declared in `manifest.json`:
```json
{
  "manifest_version": 3,
  "permissions": [
    "storage",                // chrome.storage (local + session)
    "debugger",               // chrome.debugger for CDP interception
    "offscreen",              // chrome.offscreen for the script sandbox
    "declarativeNetRequest"   // chrome.declarativeNetRequest for DNR rules
  ],
  "host_permissions": [
    "<all_urls>"              // Required for full request interception via DNR and CDP
  ],
  "background": {
    "service_worker": "service-worker.js"
  }
}
```

---

## 3. API Reference & Documentation Sources

The extension relies on the following Chrome APIs and the Chrome DevTools Protocol (CDP). All linked documentation has been verified and is up to date.

### 3.1 `chrome.debugger`
- **Description**: Serves as an alternate transport for Chrome’s remote debugging protocol[reference:0].
- **Permissions**: Requires the `"debugger"` permission[reference:1].
- **Restricted Domains**: The Fetch domain is available and can be used for request interception[reference:2].
- **Methods Used**:
  - `attach({tabId}, version)`
  - `detach({tabId})`
  - `sendCommand({tabId}, method, params)`
- **Events**:
  - `onEvent.addListener()` – Listens for CDP events like `Fetch.requestPaused`.
  - `onDetach.addListener()` – Detects when a debugging session is terminated.
- **Official Docs**: [developer.chrome.com/docs/extensions/reference/api/debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)

### 3.2 Chrome DevTools Protocol (CDP) — Fetch Domain
- **Purpose**: A domain for substituting the browser’s network layer with client code[reference:3].
- **Methods Used**:
  - `Fetch.enable` – Enables `requestPaused` events. Requests will be paused until the client calls `continueRequest`, `fulfillRequest`, or `failRequest`[reference:4].
  - `Fetch.continueRequest` – Continues the request, optionally modifying URL, method, postData (as base64), or headers[reference:5].
  - `Fetch.fulfillRequest` – Provides a complete response to the request (body as base64)[reference:6].
  - `Fetch.getResponseBody` – Returns the response body (base64-encoded if binary).
- **Event**:
  - `Fetch.requestPaused` – Issued when a request matches the specified filter[reference:7].
- **Official Docs**: [chromedevtools.github.io/devtools-protocol/tot/Fetch](https://chromedevtools.github.io/devtools-protocol/tot/Fetch)

### 3.3 `chrome.declarativeNetRequest`
- **Description**: Declarative rules to block or modify network requests without intercepting them, providing more privacy.
- **Permissions**: Requires the `"declarativeNetRequest"` permission and a corresponding manifest entry.
- **Methods Used**:
  - `updateSessionRules()` – Modifies the extension’s session-scoped rule set atomically. These rules are not persisted across browser sessions[reference:8].
  - `getDynamicRules()` / `getSessionRules()` – For retrieving existing rules.
- **Rule Types Used**: `modifyHeaders`, `redirect`, `block`.
- **Official Docs**: [developer.chrome.com/docs/extensions/reference/declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/declarativeNetRequest)

### 3.4 `chrome.offscreen`
- **Description**: Allows extensions to use DOM APIs in a hidden document[reference:9].
- **Permissions**: Requires the `"offscreen"` permission[reference:10].
- **Methods Used**:
  - `createDocument()` – Creates an offscreen document. The `IFRAME_SCRIPTING` reason indicates that the document needs to embed and script an iframe[reference:11].
- **Capabilities**: The `runtime` API is the only extensions API supported by offscreen documents; messaging must be handled via `runtime.sendMessage`[reference:12].
- **Availability**: Chrome 109+ and MV3+[reference:13].
- **Official Docs**: [developer.chrome.com/docs/extensions/reference/api/offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

### 3.5 `chrome.storage`
- **Description**: Persistent and session storage for extension state.
- **Permissions**: Requires the `"storage"` permission.
- **Areas Used**:
  - `local`: For persistent profiles, global state, and schema version (10 MB limit, can be extended with `"unlimitedStorage"`)[reference:14].
  - `session`: For ephemeral state (attached tabs) that does not survive a full browser restart. Data is cleared when the extension is reloaded/updated, disabled, or the browser is restarted[reference:15].
- **Note**: Service workers may be terminated when idle, so all persistent state must be stored in `chrome.storage`, not in global variables[reference:16].
- **Official Docs**: [developer.chrome.com/docs/extensions/reference/api/storage](https://developer.chrome.com/docs/extensions/reference/api/storage)

---

## 4. Implementation Review & Findings

The following analysis is based on a line-by-line review of the provided codebase. The architecture is well-structured and follows MV3 best practices, but several critical implementation issues remain.

### 4.1 Functional Issues

#### ❌ Wildcard `?` conversion broken (`rule-engine.js`)
- **Issue**: In `parseSmartUrlPattern`, the `escapeRegex` function escapes the `?` character before the `.replace(/\?/g, '.')` replacement. As a result, a user pattern like `*.example.com/?.html` becomes a literal `\?` in the regex and never matches a single character.
- **Consequence**: Rules containing `?` fail silently.
- **Fix**: Perform the `.replace(/\*/g, '.*').replace(/\?/g, '.')` **before** escaping other regex special characters.

#### ❌ Resource type mismatch (`rule-engine.js`)
- **Issue**: `generateFetchPatterns` passes the stored `resourceTypes` (e.g., `'main_frame'`, `'stylesheet'`) directly to CDP’s `Fetch.enable`. However, the CDP Fetch domain expects values like `'Document'`, `'Stylesheet'`, etc. (as defined in the CDP `ResourceType` enum).
- **Consequence**: The generated `RequestPattern` objects never match any request, so AdvancedJS rules never trigger the debugger to attach or intercept.
- **Fix**: Store resource types in a canonical format (CDP strings) and map them to DNR’s `ResourceType` when generating DNR rules.

#### ❌ Broken Base64 ↔ Uint8Array conversion (`interceptor.js`)
- **Issue**: The conversion of a base64-encoded response body to a `Uint8Array` is incorrect. The line `Uint8Array.from(atob(bodyResult.body), c => c.charCodeAt(0))` does not correctly convert a binary string to a `Uint8Array`.
- **Consequence**: Binary responses (images, PDFs) become corrupted, and the extension may throw errors.
- **Fix**:
  ```javascript
  const binaryString = atob(bodyResult.body);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  ```

#### ❌ Deprecated `btoa(unescape(encodeURIComponent(...)))` (`interceptor.js`)
- **Issue**: This pattern is used to encode a JavaScript string (UTF-16) to base64. It is a non-standard hack that may fail on non‑Latin1 characters.
- **Consequence**: Request bodies with Unicode characters (e.g., JSON with emojis) will cause `btoa` to throw an error.
- **Fix**: Use the standard `TextEncoder`:
  ```javascript
  const utf8Bytes = new TextEncoder().encode(modifiedResponse.body);
  const base64 = btoa(String.fromCharCode(...utf8Bytes));
  ```

#### ⚠️ No script execution timeout (`script-bridge.js` & `offscreen.js`)
- **Issue**: There is no timeout for user script execution. If a script hangs (e.g., infinite loop), the `sendResponse` callback is never called.
- **Consequence**: The `executeScript` promise never settles, and the interceptor’s CDP request is never continued or fulfilled, causing the tab’s network request to hang forever.
- **Fix**: Add a timeout (e.g., 5 seconds) in `script-bridge.js` and `offscreen.js`, and send an error response if the timeout elapses.

#### ⚠️ `detachFromTab` removes tracking even on failure (`debugger-manager.js`)
- **Issue**: `await removeAttachedTab(tabId)` is called even if `chrome.debugger.detach` fails.
- **Consequence**: The storage indicates that the debugger is detached while it may still be attached, leading to zombie debugger sessions.
- **Fix**: Only remove the tab from storage if the detach operation succeeds (or if the error indicates that the debugger was already detached).

### 4.2 Inconsistencies & Dead Code

- **Dead Functions** (`storage-manager.js`): `addEnabledTab`, `removeEnabledTab`, `isTabEnabled`, and `getEnabledTabs` are exported but never used. These appear to be remnants of an earlier per‑tab DNR enablement feature.
- **Cache Invalidation on Deletion** (`storage-manager.js`): If a storage key is deleted (`newValue === undefined`), the in‑memory cache is not updated, which could lead to stale data. The cache should be set to `null` (or the default value) to force a reload.

### 4.3 Missing Dependencies & Imports

- The `service-worker.js` imports `updateActiveDebuggers` from `./debugger-manager.js`, which is correctly defined.
- The `interceptor.js` imports `executeRequestScript` and `executeResponseScript` from `./script-bridge.js`, which is correctly defined.
- The `offscreen.js` uses `chrome.runtime.getURL('sandbox/sandbox.html')`. This requires that the `sandbox` directory with `sandbox.html` and `sandbox.js` be included in the extension package.
- The `offscreen.html` file must exist at the specified path.

All required imports are present. No missing imports were detected.

### 4.4 Validation Status (Codebase + Official Docs)

Legend: `valid` / `not valid` / `not sure`

1. **Wildcard `?` conversion broken (`rule-engine.js`)** → **not valid**  
   Verified in `src/background/rule-engine.js`: `parseSmartUrlPattern()` currently converts `?` via `.replace(/\\?/g, '.')`, and `?` is not escaped by the preceding regex-escape pass.

2. **Resource type mismatch (`rule-engine.js`)** → **not valid**  
   `generateFetchPatterns()` passes stored `resourceTypes` to CDP, and UI currently stores CDP-style values (for example `Document`, `XHR`, `Fetch`) in `src/dashboard/dashboard.html` / `src/dashboard/dashboard.js`. DNR compilation already maps CDP-style values to DNR types in `syncDNRRules()`.

3. **Broken Base64 ↔ Uint8Array conversion (`interceptor.js`)** → **not valid**  
   `Uint8Array.from(atob(base64), c => c.charCodeAt(0))` correctly reconstructs raw bytes for base64-decoded binary data.

4. **Deprecated `btoa(unescape(encodeURIComponent(...)))` causes Unicode failure** → **not valid**  
   `unescape` is deprecated (MDN confirms), but the specific claim that Unicode payloads like emoji will cause `btoa` errors in this pattern is incorrect in current runtime behavior.

5. **No script execution timeout (`script-bridge.js` / `offscreen.js`)** → **valid**  
   No timeout guard exists around `chrome.runtime.sendMessage` request/reply flow for user script execution.

6. **`detachFromTab` removes tracking even on failure (`debugger-manager.js`)** → **valid**  
   `removeAttachedTab(tabId)` runs unconditionally after detach attempt.

7. **Dead functions in `storage-manager.js` are unused** → **valid**  
   `addEnabledTab`, `removeEnabledTab`, `isTabEnabled`, and `getEnabledTabs` are exported but have no active runtime callers.

8. **Cache invalidation on key deletion is broken (`storage-manager.js`)** → **not valid**  
   On deletion, cache fields become `undefined`, which triggers a fresh storage read on next getter call; stale cache is not retained.

9. **Missing imports/dependencies (Section 4.3)** → **valid**  
   Verified import pairs exist and referenced files (`offscreen/offscreen.html`, `sandbox/sandbox.html`, `sandbox/sandbox.js`) are present and packaged.

10. **“Debugger stays attached” section: `tabs.onActivated` can skip reconciliation while tab is loading** → **valid**  
    `src/background/service-worker.js` gates on `tab.status === 'complete'`, so loading tabs are skipped until later updates.

11. **“Debugger stays attached” section: `isTabAttached()` out-of-sync explanation as written** → **not valid**  
    The text claims storage “becomes correct” when detach fails and state is removed; that is reversed (it can become incorrect if detach failed but tracking is removed).

12. **“Provisional headers” caused by missing script timeout** → **valid**  
    Long or hanging script execution can keep requests paused because there is no timeout path, matching the described risk.

13. **“sortedStringify comparison too strict due key order”** → **not valid**  
    Keys are already sorted before comparison, so key-order drift is explicitly handled.

14. **Overall conclusion that critical bugs listed in Section 4.1 are all currently present** → **not valid**  
    Several cited “critical” bugs are no longer accurate in current code (items 1–4 above).

---

## 5. Recommendations

The architectural foundation is solid, but the following critical fixes are required before the extension can be considered production‑ready:

### 5.1 Must-Fix (Critical)

1. **Fix Wildcard `?` Matching**  
   In `rule-engine.js`, restructure `parseSmartUrlPattern` to replace `*` and `?` with regex equivalents **before** escaping other special characters.

2. **Normalize Resource Types**  
   Decide on a canonical format (e.g., CDP `ResourceType` strings) and convert accordingly when generating DNR rules.

3. **Rewrite Base64 ↔ UTF-8 Conversions**  
   Replace the broken and deprecated conversions in `interceptor.js` with `TextEncoder` and `TextDecoder`.

4. **Add Script Execution Timeout**  
   Implement a timeout (5 seconds) in `script-bridge.js` and `offscreen.js` to prevent hanging promises.

### 5.2 Should-Fix (High Priority)

- **Detach Cleanup**: In `debugger-manager.js`, only remove a tab from storage when the detach operation is successful.
- **Cache Invalidation**: In `storage-manager.js`, update the cache to `null` or default values when a key is deleted.
- **Resource Type Mapping**: Create a helper function to map between DNR `ResourceType` and CDP `ResourceType`.

### 5.3 Nice-to-Have (Low Priority)

- **Remove Dead Code**: Delete the unused functions `addEnabledTab`, `removeEnabledTab`, `isTabEnabled`, and `getEnabledTabs` from `storage-manager.js`.
- **Documentation**: Add inline comments explaining the `fetchProxy` mechanism and the sandboxed iframe architecture.
- **Error Handling**: Add more granular error handling for CDP commands to distinguish between transient failures and permission errors.

### 5.4 Testing Recommendations

1. **Wildcard Tests**: Verify that patterns with `?` (e.g., `*.example.com/?.html`) match correctly.
2. **Resource Type Tests**: Ensure that `Document` requests trigger the debugger and that DNR rules apply to `main_frame`.
3. **Binary Data Tests**: Intercept an image or PDF response and confirm that the body is preserved after passing through the interceptor.
4. **Unicode Tests**: Send a request with a JSON body containing emojis (e.g., `{"text": "😀"}`) and verify that the script can read and modify it.
5. **Timeout Tests**: Create a user script with an infinite loop and verify that the extension does not hang but continues the request unmodified after the timeout.

---

## 6. Conclusion

The “ModNetwork” extension is a well-architected MV3 extension that correctly uses modern Chrome APIs. However, the presence of several critical implementation bugs — particularly in rule matching, resource type handling, and binary data conversion — means the extension is **not production-ready** in its current state.

After addressing the issues outlined in Section 5, the codebase will be robust, reliable, and fully compliant with Manifest V3 best practices. The modular design will also facilitate future maintenance and feature additions.


----

## Why the debugger stays attached on unrelated tabs – analysis & fixes

You’ve observed that the debugger remains attached when switching to tabs that have no matching AdvancedJS rules, and that request headers show “provisional headers are shown” even on tabs where AdvancedJS is active.  
Both symptoms point to **two distinct issues** in the current code.

---

### 1. Debugger not detaching on tab switch / navigation

The reconciliation logic in `service-worker.js` is supposed to detach the debugger when `hasAdvancedJSRuleForUrl()` returns `false`.  
However, the following bugs can prevent detachment:

#### a) `hasAdvancedJSRuleForUrl()` may incorrectly return `true` for unrelated URLs

- **Wildcard `?` bug** (already identified) – if any rule uses a pattern containing `?`, it will never match, but that doesn’t cause false positives.  
- **Missing `resourceType` filtering in CDP** – `generateFetchPatterns()` produces patterns that never match because of the type mismatch (e.g., `main_frame` vs `Document`). This means `hasAdvancedJSRuleForUrl()` is **not** used by the debugger attachment logic? Wait – `hasAdvancedJSRuleForUrl()` does **not** use `generateFetchPatterns()`. It directly calls `matchesUrl()`, which works independently of CDP types. So the type mismatch does **not** affect `hasAdvancedJSRuleForUrl()`.  
  → So false positives must come from a rule that actually matches everything, e.g., a rule with `urlPattern: '*://*/*'` or a regex `.*`. Check if any profile (including pinned ones) contains such a rule.

#### b) `tabs.onActivated` reconciliation may be skipped for already‑loaded tabs

The listener waits for `tab.status === 'complete'`. If you switch to a tab that is already fully loaded, `status` is `'complete'` and the reconciliation runs. That is correct.  
But if the tab is still loading, reconciliation is **skipped**. The debugger will remain attached from the previous URL. Later, when the tab finishes loading, `tabs.onUpdated` will fire and call `reconcileTab()` again – so it should eventually detach.  
However, there is a **race condition**: if the tab’s final URL does **not** match any rule, but the debugger was attached for the previous URL, the detachment might happen **after** the page has already started making subrequests. Those subrequests could be incorrectly intercepted or cause “provisional headers”.

#### c) `reconcileAllDebuggers()` may not run often enough

`reconcileAllDebuggers()` is called from `reconcile()` (which runs after storage changes, global toggle, profile edits). It iterates over **all attached tabs** and detaches those that no longer match.  
But if you simply switch tabs without any state change, `reconcile()` is **not** called. Only `reconcileTab()` is called. That should be sufficient, but if `reconcileTab()` fails for any reason (e.g., `chrome.tabs.get` throws), the debugger stays attached.

#### d) `isTabAttached()` may be out of sync

The `debugger-manager.js` stores attached tabs in `chrome.storage.session`. If a detach operation fails (e.g., network error, tab already closed), `removeAttachedTab()` is still called, so the storage becomes correct.  
But the opposite can happen: the debugger is detached by Chrome (user closes DevTools, tab crashes) but the storage is not updated. The `handleDetach` event does update storage, so that is covered.

---

### 2. “Provisional headers are shown” on request headers

This appears in Chrome DevTools when a request is intercepted and the final headers are not yet known. In your extension, when an AdvancedJS rule is active, the interceptor calls `Fetch.continueRequest`. If the script does **not** modify the request, the interceptor calls `sendCommand('Fetch.continueRequest', { requestId })` **without** passing the `headers` parameter. That is correct – Chrome will use the original headers.

But “provisional headers” can also appear if the request is paused for too long, or if the `continueRequest` command is delayed. The current code has **no timeout** for script execution (as noted earlier). If a script takes a long time (or hangs), the request stays paused, and DevTools shows “provisional headers”.  
Additionally, if the script **does** modify headers, the interceptor converts the headers object to an array and sends it. The conversion function `headersObjectToArray` works, but the comparison `sortedStringify(request.headers) !== sortedStringify(modifiedRequest.headers)` may be **too strict** – it compares the stringified representation, which can differ due to whitespace or key order even if the actual headers are semantically the same. This could cause unnecessary header resending, but that wouldn’t cause provisional headers.

---

## 🔧 Fixes for the debugger attachment issue

### 1. Ensure `hasAdvancedJSRuleForUrl()` is accurate

Add logging to see which rule is causing a match on unrelated tabs:

```javascript
// Inside hasAdvancedJSRuleForUrl, after a match is found:
console.log(`[RuleEngine] MATCH: Profile ${profile.name}, rule ${mod.name} matched ${url}`);
```

Then check the console to see if a catch‑all rule exists.

**Potential cause**: A profile that is **pinned** (always active) and contains an AdvancedJS rule with `urlPattern: '*://*/*'` will match **every** URL. The user might have created such a rule inadvertently.  
**Fix**: Either remove that rule or make sure it’s disabled. The code already respects `mod.enabled`.

### 2. Fix `tabs.onActivated` to reconcile even for non‑complete tabs

If a tab is still loading, we should still check the **current URL** (which might be the final one if it’s a slow load). Change the listener:

```javascript
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return;
  if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
    if (await isTabAttached(tabId)) await detachFromTab(tabId);
    return;
  }
  // Reconcile regardless of status – the URL might be final
  await reconcileTab(tabId, tab.url);
});
```

### 3. Add a safety detach in `tabs.onUpdated` for any URL change, not just `complete`

The current listener only acts when `changeInfo.status === 'complete'`. This misses intermediate URL changes (e.g., a redirect). Change to:

```javascript
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    if (!tab.url || !tab.url.startsWith('http')) {
      if (await isTabAttached(tabId)) await detachFromTab(tabId);
      return;
    }
    await reconcileTab(tabId, tab.url);
  }
});
```

### 4. Make `reconcileTab()` more robust

Add error handling and log the decision:

```javascript
async function reconcileTab(tabId, url) {
  const globalEnabled = await getGlobalEnabled();
  const needsAdvJS = globalEnabled && await hasAdvancedJSRuleForUrl(url);
  const attached = await isTabAttached(tabId);

  console.log(`[ReconcileTab] tab ${tabId}, url ${url}, needsAdvJS=${needsAdvJS}, attached=${attached}`);

  if (needsAdvJS && !attached) {
    await attachToTab(tabId);
  } else if (!needsAdvJS && attached) {
    await detachFromTab(tabId);
  }
}
```

### 5. Force a full reconcile on tab switches (optional but safe)

If you want to be absolutely sure, you can call `reconcile()` instead of `reconcileTab()`. However, `reconcile()` does more work (syncs DNR, updates all tabs). For performance, `reconcileTab()` is preferable.

---

## 🛠️ Fix for “provisional headers”

Add a **timeout** for script execution in `script-bridge.js` and `offscreen.js`. Without it, any slow or hanging script will keep the request paused, causing provisional headers.

Example in `script-bridge.js`:

```javascript
async function executeScript(scriptCode, context) {
  await ensureOffscreenDocument();

  const timeoutMs = 5000;
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Script execution timeout')), timeoutMs)
  );

  const sendPromise = chrome.runtime.sendMessage({
    type: 'EXECUTE_SCRIPT',
    messageId: crypto.randomUUID(),
    scriptCode,
    context
  });

  const response = await Promise.race([sendPromise, timeoutPromise]);
  // ... rest
}
```

Also add a timeout in `offscreen.js` when waiting for the sandbox reply.

---

## ✅ Summary of required changes

| File | Change |
|------|--------|
| `service-worker.js` | Modify `tabs.onActivated` and `tabs.onUpdated` to reconcile on every URL change, not only on `complete`. Add detailed logging. |
| `rule-engine.js` | Add logging to `hasAdvancedJSRuleForUrl` to see which rule matches. (Also fix the wildcard `?` bug, though not directly related to this issue.) |
| `script-bridge.js` | Add a 5‑second timeout to `executeScript()`. |
| `offscreen.js` | Add a timeout for sandbox replies. |

After applying these changes, the debugger will correctly detach from tabs without matching AdvancedJS rules, and provisional headers will appear only when a script genuinely takes a long time (which will now time out and release the request).