/**
 * Interceptor — Core CDP Fetch event handler.
 * 
 * Listens for Fetch.requestPaused events from the Chrome Debugger API,
 * evaluates rules, executes user scripts, and fulfills/continues requests.
 */

import { sendCommand } from './debugger-manager.js';
import { findMatchingRules } from './rule-engine.js';
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
    const matchingRules = await findMatchingRules(request.url, resourceType, stage);
    console.log(`[ModNetwork] Matching rules: ${matchingRules.length} for ${request.url}`);

    if (matchingRules.length === 0) {
      await continueUnmodified(tabId, requestId);
      return;
    }

    if (stage === 'Request') {
      await handleRequestStage(tabId, requestId, request, matchingRules);
    } else {
      await handleResponseStage(tabId, requestId, request, params.responseStatusCode, params.responseHeaders, matchingRules);
    }
  } catch (error) {
    console.error(`[ModNetwork] ❌ Error handling ${stage} for ${request.url}:`, error);
    await continueUnmodified(tabId, requestId);
  }
}

/**
 * Handle interception at the Request stage.
 */
async function handleRequestStage(tabId, requestId, request, rules) {
  let modifiedRequest = {
    url: request.url,
    method: request.method,
    headers: request.headers,
    postData: request.postData
  };

  let wasModified = false;

  for (const rule of rules) {
    if (!rule.scripts.onBeforeRequest) continue;

    const result = await executeRequestScript(
      rule.scripts.onBeforeRequest,
      modifiedRequest,
      tabId
    );

    if (result) {
      // The script returns context or context.request
      const newRequest = result.request || result;
      if (newRequest.url || newRequest.headers) {
        modifiedRequest = { ...modifiedRequest, ...newRequest };
        wasModified = true;
      }
    }
  }

  if (wasModified) {
    const continueParams = { requestId };
    if (modifiedRequest.url !== request.url) continueParams.url = modifiedRequest.url;
    if (modifiedRequest.method !== request.method) continueParams.method = modifiedRequest.method;
    if (modifiedRequest.postData !== request.postData) {
      continueParams.postData = btoa(modifiedRequest.postData || '');
    }
    if (modifiedRequest.headers) {
      continueParams.headers = headersObjectToArray(
        typeof modifiedRequest.headers === 'object' && !Array.isArray(modifiedRequest.headers)
          ? modifiedRequest.headers
          : headersArrayToObject(modifiedRequest.headers)
      );
    }
    await sendCommand(tabId, 'Fetch.continueRequest', continueParams);
    console.log(`[ModNetwork] ✅ Request modified: ${request.url}`);
  } else {
    await sendCommand(tabId, 'Fetch.continueRequest', { requestId });
  }
}

/**
 * Handle interception at the Response stage.
 */
async function handleResponseStage(tabId, requestId, request, statusCode, responseHeaders, rules) {
  console.log(`[ModNetwork] 📦 Processing response for: ${request.url}`);

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

  for (const rule of rules) {
    if (!rule.scripts.onResponse) continue;

    console.log(`[ModNetwork] 🔧 Running onResponse script from rule: "${rule.name}"`);

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

    console.log(`[ModNetwork] Script result type:`, typeof result, result ? Object.keys(result) : 'null');

    if (result) {
      // The user script returns context.response or the full context
      // Handle both: { response: {...} } or { body, headers, statusCode }
      const newResponse = result.response || result;
      if (newResponse.body !== undefined) {
        modifiedResponse = { ...modifiedResponse, ...newResponse };
        wasModified = true;
        console.log(`[ModNetwork] ✅ Response body modified (${modifiedResponse.body.length} chars)`);
      }
    }
  }

  if (wasModified) {
    const fulfillParams = {
      requestId,
      responseCode: modifiedResponse.statusCode || statusCode,
      responseHeaders: headersObjectToArray(modifiedResponse.headers || headersObj),
      body: btoa(unescape(encodeURIComponent(modifiedResponse.body || '')))
    };

    await sendCommand(tabId, 'Fetch.fulfillRequest', fulfillParams);
    console.log(`[ModNetwork] 🎉 Response fulfilled: ${request.url}`);
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
