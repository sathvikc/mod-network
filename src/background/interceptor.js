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
 * Per CDP docs, the presence of responseStatusCode or responseErrorReason
 * indicates the response stage.
 */
function isResponseStage(params) {
  return params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;
}

/**
 * Convert CDP header array to a plain object.
 * @param {Array<{name: string, value: string}>} headerArray
 * @returns {Object} Header object
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
 * @param {Object} headerObj
 * @returns {Array<{name: string, value: string}>}
 */
function headersObjectToArray(headerObj) {
  return Object.entries(headerObj).map(([name, value]) => ({ name, value: String(value) }));
}

/**
 * Handle a Fetch.requestPaused event.
 * This is the main interception logic.
 * 
 * @param {Object} source — { tabId } from chrome.debugger.onEvent
 * @param {Object} params — CDP Fetch.requestPaused parameters
 */
async function handleRequestPaused(source, params) {
  const { tabId } = source;
  const { requestId, request, responseStatusCode, responseHeaders, responseErrorReason } = params;
  const stage = isResponseStage(params) ? 'Response' : 'Request';

  try {
    // Find matching rules for this request/response
    const resourceType = params.resourceType || 'Other';
    const matchingRules = await findMatchingRules(request.url, resourceType, stage);

    if (matchingRules.length === 0) {
      // No rules match — continue normally
      await continueUnmodified(tabId, requestId, stage);
      return;
    }

    if (stage === 'Request') {
      await handleRequestStage(tabId, requestId, request, matchingRules);
    } else {
      await handleResponseStage(tabId, requestId, request, responseStatusCode, responseHeaders, matchingRules);
    }
  } catch (error) {
    console.error(`[ModNetwork] Error handling ${stage} for ${request.url}:`, error);
    // On error, always continue the request to avoid hanging the page
    await continueUnmodified(tabId, requestId, stage);
  }
}

/**
 * Handle interception at the Request stage.
 * Runs user's onBeforeRequest scripts and applies modifications.
 */
async function handleRequestStage(tabId, requestId, request, rules) {
  let modifiedRequest = {
    url: request.url,
    method: request.method,
    headers: request.headers,
    postData: request.postData
  };

  let wasModified = false;

  // Run each matching rule's request script sequentially  
  for (const rule of rules) {
    if (!rule.scripts.onBeforeRequest) continue;

    const result = await executeRequestScript(
      rule.scripts.onBeforeRequest,
      modifiedRequest,
      tabId
    );

    if (result && result.request) {
      modifiedRequest = { ...modifiedRequest, ...result.request };
      wasModified = true;
    }
  }

  if (wasModified) {
    // Build continueRequest params with modifications
    const continueParams = { requestId };

    if (modifiedRequest.url !== request.url) {
      continueParams.url = modifiedRequest.url;
    }
    if (modifiedRequest.method !== request.method) {
      continueParams.method = modifiedRequest.method;
    }
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
    console.log(`[ModNetwork] Request modified: ${request.url}`);
  } else {
    await sendCommand(tabId, 'Fetch.continueRequest', { requestId });
  }
}

/**
 * Handle interception at the Response stage.
 * Gets the response body, runs user's onResponse scripts, and fulfills.
 */
async function handleResponseStage(tabId, requestId, request, statusCode, responseHeaders, rules) {
  // Get the original response body
  let bodyResult;
  try {
    bodyResult = await sendCommand(tabId, 'Fetch.getResponseBody', { requestId });
  } catch (error) {
    // Can't get body (e.g., redirect) — continue as-is
    console.warn(`[ModNetwork] Can't get response body for ${request.url}:`, error.message);
    await sendCommand(tabId, 'Fetch.continueRequest', { requestId });
    return;
  }

  const originalBody = bodyResult.base64Encoded
    ? atob(bodyResult.body)
    : bodyResult.body;

  const headersObj = headersArrayToObject(responseHeaders);

  let modifiedResponse = {
    body: originalBody,
    headers: headersObj,
    statusCode: statusCode
  };

  let wasModified = false;

  // Run each matching rule's response script sequentially
  for (const rule of rules) {
    if (!rule.scripts.onResponse) continue;

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

    if (result && result.response) {
      modifiedResponse = { ...modifiedResponse, ...result.response };
      wasModified = true;
    }
  }

  if (wasModified) {
    // Fulfill with modified response
    const fulfillParams = {
      requestId,
      responseCode: modifiedResponse.statusCode || statusCode,
      responseHeaders: headersObjectToArray(modifiedResponse.headers || headersObj),
      body: btoa(unescape(encodeURIComponent(modifiedResponse.body || '')))
    };

    await sendCommand(tabId, 'Fetch.fulfillRequest', fulfillParams);
    console.log(`[ModNetwork] Response modified: ${request.url}`);
  } else {
    // No modifications — continue with original response
    await sendCommand(tabId, 'Fetch.continueRequest', { requestId });
  }
}

/**
 * Continue a request/response without modifications.
 */
async function continueUnmodified(tabId, requestId, stage) {
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
