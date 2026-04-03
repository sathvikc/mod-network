/**
 * RuleEngine — Matches incoming requests against user-defined rules.
 * 
 * Determines which rules apply to a given request based on URL pattern
 * and resource type matching.
 */

import { getRules, getGlobalEnabled } from '../storage/storage-manager.js';

/**
 * Convert a URL pattern (with wildcards) to a RegExp.
 * Supports:
 *   *  → matches any characters (zero or more)
 *   ?  → matches exactly one character
 *   Standard URL pattern formats like *://*.example.com/*
 * 
 * @param {string} pattern — URL pattern string
 * @returns {RegExp} Compiled regular expression
 */
function patternToRegex(pattern) {
  // Handle the special <all_urls> pattern
  if (pattern === '<all_urls>' || pattern === '*') {
    return /^https?:\/\/.*/;
  }

  // Escape regex special chars, then convert wildcards
  let regex = pattern
    // Escape regex special characters (except * and ?)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // Convert * to regex wildcard
    .replace(/\*/g, '.*')
    // Convert ? to single char wildcard
    .replace(/\?/g, '.');

  return new RegExp('^' + regex + '$', 'i');
}

/**
 * Check if a URL matches a pattern.
 * @param {string} url — Request URL
 * @param {string} pattern — URL pattern with wildcards
 * @returns {boolean}
 */
function matchesUrl(url, pattern) {
  try {
    const regex = patternToRegex(pattern);
    return regex.test(url);
  } catch (error) {
    console.warn(`[ModNetwork] Invalid URL pattern "${pattern}":`, error.message);
    return false;
  }
}

/**
 * Check if a resource type matches the rule's allowed types.
 * @param {string} resourceType — CDP resource type (Document, Stylesheet, Script, XHR, Fetch, etc.)
 * @param {Array<string>} allowedTypes — Rule's allowed resource types
 * @returns {boolean}
 */
function matchesResourceType(resourceType, allowedTypes) {
  if (!allowedTypes || allowedTypes.length === 0) {
    return true; // No filter = match all
  }
  return allowedTypes.some(type => 
    type.toLowerCase() === resourceType?.toLowerCase()
  );
}

/**
 * Find all enabled rules that match a given request.
 * @param {string} url — Request URL
 * @param {string} resourceType — CDP resource type
 * @param {string} stage — 'Request' or 'Response'
 * @returns {Promise<Array>} Array of matching rules
 */
async function findMatchingRules(url, resourceType, stage) {
  // Check global enabled state
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return [];

  const rules = await getRules();

  return rules.filter(rule => {
    // Rule must be enabled
    if (!rule.enabled) return false;

    // URL must match
    if (!matchesUrl(url, rule.match.urlPattern)) return false;

    // Resource type must match
    if (!matchesResourceType(resourceType, rule.match.resourceTypes)) return false;

    // Must have a script for the current stage
    if (stage === 'Request' && !rule.scripts.onBeforeRequest) return false;
    if (stage === 'Response' && !rule.scripts.onResponse) return false;

    return true;
  });
}

/**
 * Check if any rules could potentially match a URL (quick check).
 * Useful for deciding whether to intercept at all.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function hasAnyMatchingRules(url) {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return false;

  const rules = await getRules();
  return rules.some(rule => rule.enabled && matchesUrl(url, rule.match.urlPattern));
}

/**
 * Generate CDP Fetch.RequestPattern array from all enabled rules.
 * @returns {Promise<Array>} Array of RequestPattern objects
 */
async function generateFetchPatterns() {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return [];

  const rules = await getRules();
  const patterns = [];

  for (const rule of rules) {
    // Only AdvancedJS rules need the debugger
    if (!rule.enabled || rule.type !== 'AdvancedJS') continue;

    const urlPattern = rule.match.urlPattern || '*://*/*';
    const resourceTypes = rule.match.resourceTypes || [];

    const typesToIterate = resourceTypes.length > 0 ? resourceTypes : [undefined];

    for (const resType of typesToIterate) {
      if (rule.scripts?.onBeforeRequest) {
        patterns.push({
          urlPattern,
          requestStage: 'Request',
          ...(resType ? { resourceType: resType } : {})
        });
      }
      if (rule.scripts?.onResponse) {
        patterns.push({
          urlPattern,
          requestStage: 'Response',
          ...(resType ? { resourceType: resType } : {})
        });
      }
    }
  }

  return patterns;
}

/**
 * Sync active Friendly Rules (ModifyHeader, Redirect) to Chrome's declarativeNetRequest engine.
 */
async function syncDNRRules() {
  const globalEnabled = await getGlobalEnabled();
  const rules = await getRules();
  
  // 1. Get current dynamic rules to remove them all cleanly
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map(r => r.id);

  // 2. Build new rules
  const addRules = [];
  let dnrId = 1; // DNR IDs must be integers starting at 1

  // Map CDP resource types to DNR resource types
  const mapResourceType = (cdpType) => {
    const map = {
      'Document': 'main_frame',
      'Stylesheet': 'stylesheet',
      'Script': 'script',
      'Image': 'image',
      'Font': 'font',
      'XHR': 'xmlhttprequest',
      'Fetch': 'xmlhttprequest',
      'Ping': 'ping',
      'Media': 'media',
      'WebSocket': 'websocket',
      'Other': 'other'
    };
    return map[cdpType] || 'other';
  };

  if (globalEnabled) {
    for (const rule of rules) {
      // Ignored by DNR: disabled rules, or AdvancedJS rules (handled by debugger)
      if (!rule.enabled || rule.type === 'AdvancedJS') continue;
      
      const condition = {};
      if (rule.match.urlPattern && rule.match.urlPattern !== '*://*/*' && rule.match.urlPattern !== '<all_urls>') {
        condition.urlFilter = rule.match.urlPattern;
      }
      
      if (rule.match.resourceTypes && rule.match.resourceTypes.length > 0) {
        // Convert to DNR types and deduplicate
        const dnrTypes = rule.match.resourceTypes.map(mapResourceType);
        condition.resourceTypes = [...new Set(dnrTypes)];
      }

      if (rule.type === 'ModifyHeader' && rule.headers && rule.headers.length > 0) {
        const requestHeaders = [];
        const responseHeaders = [];
        
        rule.headers.forEach(h => {
          const headerRule = { header: h.name, operation: h.operation };
          if (h.operation !== 'remove') headerRule.value = h.value;
          
          if (h.stage === 'Request') requestHeaders.push(headerRule);
          else responseHeaders.push(headerRule);
        });
        
        if (requestHeaders.length > 0 || responseHeaders.length > 0) {
          const action = { type: 'modifyHeaders' };
          if (requestHeaders.length > 0) action.requestHeaders = requestHeaders;
          if (responseHeaders.length > 0) action.responseHeaders = responseHeaders;
          
          addRules.push({
            id: dnrId++,
            priority: 1,
            action,
            condition
          });
        }
      } else if (rule.type === 'Redirect' && rule.redirectUrl) {
        addRules.push({
          id: dnrId++,
          priority: 2,
          action: { type: 'redirect', redirect: { url: rule.redirectUrl } },
          condition
        });
      }
    }
  }

  // 3. Update DNR
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });
  console.log(`[ModNetwork] DNR Rules Synced: Removed ${removeRuleIds.length}, Added ${addRules.length}`);
}

export {
  patternToRegex,
  matchesUrl,
  matchesResourceType,
  findMatchingRules,
  hasAnyMatchingRules,
  generateFetchPatterns,
  syncDNRRules
};
