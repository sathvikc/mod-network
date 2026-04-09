/**
 * Interceptor — Core CDP Fetch event handler.
 * 
 * Listens for Fetch.requestPaused events from the Chrome Debugger API,
 * evaluates rules, executes user scripts, and fulfills/continues requests.
 */

import { sendCommand } from './debugger-manager.js';
import { findMatchingRules, findMatchingRequestHeaderRules, findMatchingResponseHeaderRules } from './rule-engine.js';
import { executeRequestScript, executeResponseScript } from './script-bridge.js';

/**
 * Determine if a paused request is at the Response stage.
 */
function isResponseStage(params) {
  return params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;
}

/**
 * Convert CDP header array to a plain object.
 */
function headersArrayToObject(headerArray) {
  const obj = {};
  if (!headerArray) return obj;
  for (const { name, value } of headerArray) {
    obj[name] = value;
  }
  return obj;
}

/**
 * Convert header object back to CDP header array.
 */
function headersObjectToArray(headerObj) {
  if (!headerObj || typeof headerObj !== 'object') return [];
  return Object.entries(headerObj).map(([name, value]) => ({ name, value: String(value) }));
}

/**
 * Handle a Fetch.requestPaused event.
 */
async function handleRequestPaused(source, params) {
  const { tabId } = source;
  const { requestId, request } = params;
  const stage = isResponseStage(params) ? 'Response' : 'Request';
  const resourceType = params.resourceType || 'Other';

  console.log(`[ModNetwork] ⚡ requestPaused: ${stage} | ${resourceType} | ${request.url}`);

  try {
    const tab = await chrome.tabs.get(tabId);
    let tabDomains = [];
    if (tab && tab.url && tab.url.startsWith('http')) {
      tabDomains.push(new URL(tab.url).host);
    }

    const matchingRules = await findMatchingRules(request.url, resourceType, stage, tabDomains);
    console.log(`[ModNetwork] Matching rules: ${matchingRules.length} for ${request.url} (Host: ${tabDomains.join()})`);

    if (stage === 'Request') {
      // Always go through handleRequestStage — even with zero AdvJS matches.
      // This ensures explicit headers are passed in Fetch.continueRequest,
      // which fixes "Provisional Headers are shown" in DevTools.
      await handleRequestStage(tabId, requestId, request, matchingRules, resourceType, tabDomains);
    } else {
      if (matchingRules.length === 0) {
        await continueUnmodified(tabId, requestId);
        return;
      }
      await handleResponseStage(tabId, requestId, request, params.responseStatusCode, params.responseHeaders, resourceType, matchingRules);
    }
  } catch (error) {
    console.error(`[ModNetwork] ❌ Error handling ${stage} for ${request.url}:`, error);
    await continueUnmodified(tabId, requestId);
  }
}

/**
 * Handle interception at the Request stage.
 *
 * Pipeline order:
 *   1. Apply ModifyHeader request rules (so they're visible in DevTools
 *      instead of "Provisional Headers are shown")
 *   2. Run AdvancedJS onBeforeRequest scripts (see post-ModifyHeader headers)
 *   3. Always pass explicit headers in Fetch.continueRequest
 *
 * Note: DNR also applies ModifyHeader request rules at the network level.
 * 'set' and 'remove' are idempotent so double-application is harmless.
 * 'append' operations may result in the value being appended twice.
 */
async function handleRequestStage(tabId, requestId, request, rules, resourceType, tabDomains) {
  let modifiedHeaders = typeof request.headers === 'object' && !Array.isArray(request.headers)
    ? { ...request.headers }
    : headersArrayToObject(request.headers);

  let wasModified = false;

  // Step 1: Apply ModifyHeader request rules.
  const headerRules = await findMatchingRequestHeaderRules(request.url, resourceType, tabDomains);
  if (headerRules.length > 0) {
    applyHeaderRules(modifiedHeaders, headerRules);
    wasModified = true;
    console.log(`[ModNetwork] Applied ${headerRules.length} ModifyHeader request rules to ${request.url}`);
  }

  // Step 2: Run AdvancedJS onBeforeRequest scripts.
  let modifiedRequest = {
    url: request.url,
    method: request.method,
    headers: modifiedHeaders,
    postData: request.postData
  };

  for (const rule of rules) {
    if (!rule.scripts.onBeforeRequest) continue;

    const result = await executeRequestScript(
      rule.scripts.onBeforeRequest,
      modifiedRequest,
      tabId
    );

    if (result) {
      const newRequest = result.request || result;
      if (newRequest.url || newRequest.headers) {
        modifiedRequest = { ...modifiedRequest, ...newRequest };
        wasModified = true;
      }
    }
  }

  // Step 3: Always pass explicit headers in Fetch.continueRequest.
  // This fixes "Provisional Headers are shown" in DevTools by giving
  // CDP the full header set to report to the DevTools frontend.
  const continueParams = { requestId };
  if (modifiedRequest.url !== request.url) continueParams.url = modifiedRequest.url;
  if (modifiedRequest.method !== request.method) continueParams.method = modifiedRequest.method;
  if (modifiedRequest.postData !== request.postData) {
    continueParams.postData = btoa(modifiedRequest.postData || '');
  }

  const finalHeaders = typeof modifiedRequest.headers === 'object' && !Array.isArray(modifiedRequest.headers)
    ? modifiedRequest.headers
    : headersArrayToObject(modifiedRequest.headers);
  continueParams.headers = headersObjectToArray(finalHeaders);

  await sendCommand(tabId, 'Fetch.continueRequest', continueParams);
  if (wasModified) {
    console.log(`[ModNetwork] ✅ Request modified: ${request.url}`);
  }
}

/**
 * Apply ModifyHeader rules (set/append/remove) to a headers object.
 * Mutates the headers object in place.
 * @param {Object} headers — Plain object of header name → value.
 * @param {Array} headerRules — Array of { name, value, operation }.
 */
function applyHeaderRules(headers, headerRules) {
  for (const rule of headerRules) {
    const op = rule.operation || 'set';
    if (op === 'remove') {
      // Case-insensitive removal
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === rule.name.toLowerCase()) {
          delete headers[key];
        }
      }
    } else if (op === 'append') {
      // Find existing header (case-insensitive) and append, or create new.
      // Skip if the value is already present (guards against double-apply
      // when both CDP and DNR process the same append rule).
      const existingKey = Object.keys(headers).find(k => k.toLowerCase() === rule.name.toLowerCase());
      if (existingKey) {
        const parts = headers[existingKey].split(',').map(s => s.trim());
        if (!parts.includes(rule.value.trim())) {
          headers[existingKey] = headers[existingKey] + ', ' + rule.value;
        }
      } else {
        headers[rule.name] = rule.value;
      }
    } else {
      // 'set' — overwrite or create (case-insensitive match for existing)
      const existingKey = Object.keys(headers).find(k => k.toLowerCase() === rule.name.toLowerCase());
      if (existingKey) {
        delete headers[existingKey];
      }
      headers[rule.name] = rule.value;
    }
  }
}

/**
 * Handle interception at the Response stage.
 *
 * Pipeline order:
 *   1. Fetch original response body + headers
 *   2. Apply ModifyHeader response rules (equivalent to what DNR would do,
 *      but DNR response headers are bypassed when Fetch.fulfillRequest is used)
 *   3. Run AdvancedJS onResponse scripts (can see and override header changes)
 *   4. Fulfill or continue the request
 */
async function handleResponseStage(tabId, requestId, request, statusCode, responseHeaders, resourceType, rules) {
  console.log(`[ModNetwork] Processing response for: ${request.url}`);

  // Get the original response body
  let bodyResult;
  try {
    bodyResult = await sendCommand(tabId, 'Fetch.getResponseBody', { requestId });
  } catch (error) {
    console.warn(`[ModNetwork] Can't get response body for ${request.url}:`, error.message);
    await sendCommand(tabId, 'Fetch.continueRequest', { requestId });
    return;
  }

  const originalBody = bodyResult.base64Encoded
    ? new TextDecoder('utf-8').decode(Uint8Array.from(atob(bodyResult.body), c => c.charCodeAt(0)))
    : bodyResult.body;

  const headersObj = headersArrayToObject(responseHeaders);

  let modifiedResponse = {
    body: originalBody,
    headers: headersObj,
    statusCode: statusCode
  };

  let wasModified = false;

  // Step 1: Apply ModifyHeader response rules.
  // When Fetch.fulfillRequest replaces the response, DNR response header
  // modifications are bypassed. We manually apply them here so they're
  // included regardless of whether AdvancedJS also modifies the body.
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  let tabDomains = [];
  if (tab && tab.url && tab.url.startsWith('http')) {
    tabDomains.push(new URL(tab.url).host);
  }

  const headerRules = await findMatchingResponseHeaderRules(request.url, resourceType, tabDomains);

  if (headerRules.length > 0) {
    applyHeaderRules(modifiedResponse.headers, headerRules);
    wasModified = true;
    console.log(`[ModNetwork] Applied ${headerRules.length} ModifyHeader response rules to ${request.url}`);
  }

  // Step 2: Run AdvancedJS onResponse scripts.
  // Scripts see the headers after ModifyHeader rules have been applied,
  // so they can inspect or override them.
  for (const rule of rules) {
    if (!rule.scripts.onResponse) continue;

    console.log(`[ModNetwork] Running onResponse script from rule: "${rule.name}"`);

    const requestData = {
      url: request.url,
      method: request.method,
      headers: request.headers
    };

    const result = await executeResponseScript(
      rule.scripts.onResponse,
      requestData,
      modifiedResponse,
      tabId
    );

    if (result) {
      const newResponse = result.response || result;
      if (newResponse.body !== undefined) {
        modifiedResponse = { ...modifiedResponse, ...newResponse };
        wasModified = true;
        console.log(`[ModNetwork] Response body modified (${modifiedResponse.body.length} chars)`);
      }
    }
  }

  if (wasModified) {
    // Strip content-length since we may have mutated the body size.
    if (modifiedResponse.headers) {
      delete modifiedResponse.headers['Content-Length'];
      delete modifiedResponse.headers['content-length'];
    }

    const fulfillParams = {
      requestId,
      responseCode: modifiedResponse.statusCode || statusCode,
      responseHeaders: headersObjectToArray(modifiedResponse.headers || headersObj),
      body: btoa(unescape(encodeURIComponent(modifiedResponse.body || '')))
    };

    await sendCommand(tabId, 'Fetch.fulfillRequest', fulfillParams);
    console.log(`[ModNetwork] Response fulfilled: ${request.url}`);
  } else {
    await sendCommand(tabId, 'Fetch.continueRequest', { requestId });
    console.log(`[ModNetwork] Response passed through: ${request.url}`);
  }
}

/**
 * Continue a request/response without modifications.
 */
async function continueUnmodified(tabId, requestId) {
  try {
    await sendCommand(tabId, 'Fetch.continueRequest', { requestId });
  } catch (error) {
    console.warn(`[ModNetwork] continueRequest failed:`, error.message);
  }
}

export {
  handleRequestPaused,
  isResponseStage,
  headersArrayToObject,
  headersObjectToArray
};
