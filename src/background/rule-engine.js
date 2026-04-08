/**
 * RuleEngine — Matches incoming requests against user-defined Profiles and Mods.
 */

import { getProfiles, getGlobalEnabled, getActiveProfileId } from '../storage/storage-manager.js';

/**
 * A profile's rules are active if it is explicitly enabled AND it is either
 * the currently selected profile or a pinned (always-on) profile.
 * @param {Object} profile
 * @param {string|null} activeProfileId — null means no selection yet; first profile acts as default
 * @param {boolean} isFirst — true if this is the first profile in the list (fallback default)
 */
function isProfileActive(profile, activeProfileId, isFirst = false) {
  if (!profile.enabled) return false;
  if (profile.pinned) return true;
  if (activeProfileId) return profile.id === activeProfileId;
  return isFirst; // no selection yet — treat first profile as active
}

function escapeRegex(str) {
  return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function parseSmartUrlPattern(input, tabDomains = []) {
  let str = (input || '').trim();
  if (!str || str === '*' || str === '*://*/*' || str === '<all_urls>') return '^https?:\\/\\/.*$';

  if (str.startsWith('/')) {
    if (tabDomains.length > 0) {
      const domainGroup = tabDomains.length === 1 ? escapeRegex(tabDomains[0]) : '(' + tabDomains.map(escapeRegex).join('|') + ')';
      let endRegex = escapeRegex(str);
      if (!str.endsWith('*')) endRegex += '.*';
      else endRegex = endRegex.replace(/\\\*$/, '.*');
      return '^https?:\\/\\/' + domainGroup + endRegex + '$';
    } else {
      str = '*://*' + str;
    }
  } else if (!str.includes('://') && !str.startsWith('*')) {
    str = '*://*' + str;
  }

  // Rule: Missing trailing wildcard if it looks like a path or domain
  if (!str.endsWith('*')) {
    str = str + '*';
  }

  let regexStr = str.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return '^' + regexStr + '$';
}

function patternToRegex(pattern, tabDomains = []) {
  return new RegExp(parseSmartUrlPattern(pattern, tabDomains), 'i');
}

function matchesUrl(url, matchObj, tabDomains = []) {
  let pattern = matchObj?.urlPattern || '*://*/*';
  if (matchObj?.type === 'regex') {
    try {
      return new RegExp(pattern, 'i').test(url);
    } catch (e) {
      console.error(`[RuleEngine] Invalid Regex for rule: ${pattern}`, e);
      return false;
    }
  }

  try { return patternToRegex(pattern, tabDomains).test(url); }
  catch (e) {
    console.error(`[RuleEngine] Invalid Wildcard for rule: ${pattern}`, e);
    return false;
  }
}

function matchesResourceType(resourceType, allowedTypes) {
  if (!allowedTypes || allowedTypes.length === 0) return true;
  return allowedTypes.some(type => type.toLowerCase() === resourceType?.toLowerCase());
}

/**
 * Find all enabled AdvancedJS Mods from enabled Profiles that match the request.
 */
async function findMatchingRules(url, resourceType, stage, tabDomains = []) {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return [];

  const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  const matchingMods = [];

  for (const [i, profile] of profiles.entries()) {
    if (!isProfileActive(profile, activeProfileId, i === 0)) continue;

    for (const mod of profile.rules) {
      if (!mod.enabled || mod.type !== 'AdvancedJS') continue;
      if (stage === 'Request' && !mod.scripts?.onBeforeRequest) continue;
      if (stage === 'Response' && !mod.scripts?.onResponse) continue;

      const matchObj = mod.match || { type: 'wildcard', urlPattern: '*://*/*', resourceTypes: [] };

      if (matchesUrl(url, matchObj, tabDomains) && matchesResourceType(resourceType, matchObj.resourceTypes)) {
        console.log(`[RuleEngine] Match identified: Profile [${profile.name}] -> Mod [${mod.name || 'Script'}] for URL ${url}`);
        matchingMods.push(mod);
      }
    }
  }

  return matchingMods;
}

/**
 * Check if any active AdvancedJS Mod matches this URL.
 * Used to determine whether the Debugger API should be auto-attached to a tab.
 */
async function hasAdvancedJSRuleForUrl(url) {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return false;

  let tabDomains = [];
  if (url && url.startsWith('http')) {
    try { tabDomains = [new URL(url).host]; } catch (e) { }
  }

  const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  for (const [i, profile] of profiles.entries()) {
    if (!isProfileActive(profile, activeProfileId, i === 0)) continue;
    for (const mod of profile.rules) {
      if (!mod.enabled || mod.type !== 'AdvancedJS') continue;
      // Don't attach if no scripts are actually defined — nothing to intercept
      if (!mod.scripts?.onBeforeRequest && !mod.scripts?.onResponse) continue;
      const matchObj = mod.match || { type: 'wildcard', urlPattern: '*://*/*' };
      if (matchesUrl(url, matchObj, tabDomains)) return true;
    }
  }
  return false;
}

/**
 * Check if ANY active rule (Header, Redirect, JS) applies to this URL.
 */
async function isAnyRuleActiveForUrl(url) {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return false;

  let tabDomains = [];
  if (url && url.startsWith('http')) {
    try { tabDomains = [new URL(url).host]; } catch (e) { }
  }

  const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  for (const [i, profile] of profiles.entries()) {
    if (!isProfileActive(profile, activeProfileId, i === 0)) continue;

    for (const mod of profile.rules) {
      if (!mod.enabled) continue;
      const matchObj = mod.match || { type: 'wildcard', urlPattern: '*://*/*' };
      if (matchesUrl(url, matchObj, tabDomains)) return true;
    }
  }
  return false;
}

/**
 * Generate a valid Chrome Declarative URL Match Pattern or CDP URL wildcard pattern
 * for a given user input, locked to a specific tab's host domain.
 *
 * Unlike parseSmartUrlPattern (which returns a Regex string), this function returns
 * a valid Chrome URL pattern string for use in CDP Fetch.enable and declarativeNetRequest.
 * Path-only inputs are prefixed with the tabHost domain (or wildcard if null).
 * Returns a valid Chrome URL match pattern string, not a regex.
 * 
 * Examples:
 *   parseChromeMatchPattern('/api/users/', 'localhost:8765')  outputs  '*://localhost:8765/api/users/*'
 *   parseChromeMatchPattern('*:\/*\/*', 'localhost:8765')      outputs  '*://*\/*'  -- wildcard is universal, host param is ignored
 *   parseChromeMatchPattern('example.com/api/', null)  
 */
function parseChromeMatchPattern(input, tabHost = null) {
  let str = (input || '').trim();
  if (!str || str === '*' || str === '*://*/*' || str === '<all_urls>') return '*://*/*';

  // Path-only input — prefix with tab host or wildcard domain
  if (str.startsWith('/')) {
    const host = tabHost || '*';
    if (!str.endsWith('*')) str += '*';
    return `*://${host}${str}`;
  }

  // No protocol means it's a host+path input — prefix with scheme wildcard
  if (!str.includes('://') && !str.startsWith('*')) {
    if (!str.endsWith('*')) str += '*';
    return `*://${str}`;
  }

  // Already a full pattern — just ensure trailing wildcard
  if (!str.endsWith('*')) str += '*';
  return str;
}

/**
 * Generate CDP Fetch.RequestPattern array for the Debugger API based on Profile rules.
 * tabId is passed so we can construct domain-locked patterns for path-only inputs.
 */
async function generateFetchPatterns(tabId = null) {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return [];

  // Resolve tab host for domain-locking path-only patterns
  let tabHost = null;
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.url && tab.url.startsWith('http')) {
        tabHost = new URL(tab.url).host;
      }
    } catch (e) { }
  }

  const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  const patterns = [];

  for (const [i, profile] of profiles.entries()) {
    if (!isProfileActive(profile, activeProfileId, i === 0)) continue;

    for (const mod of profile.rules) {
      if (!mod.enabled || mod.type !== 'AdvancedJS') continue;

      let wantsRequest = !!mod.scripts?.onBeforeRequest;
      let wantsResponse = !!mod.scripts?.onResponse;
      if (!wantsRequest && !wantsResponse) continue;

      const matchObj = mod.match || { urlPattern: '*://*/*', resourceTypes: [] };
      // Use surgical domain-locked pattern for CDP — prevents over-interception
      const urlPattern = parseChromeMatchPattern(matchObj.urlPattern, tabHost);
      const resourceTypes = matchObj.resourceTypes || [];
      const typesToIterate = resourceTypes.length > 0 ? resourceTypes : [undefined];

      for (const resType of typesToIterate) {
        if (wantsRequest) {
          patterns.push({ urlPattern, requestStage: 'Request', ...(resType ? { resourceType: resType } : {}) });
        }
        if (wantsResponse) {
          patterns.push({ urlPattern, requestStage: 'Response', ...(resType ? { resourceType: resType } : {}) });
        }
      }
    }
  }

  console.log(`[RuleEngine] Generated ${patterns.length} Fetch patterns for Debugger SDK (tab host: ${tabHost})`);
  return patterns;
}

/**
 * Compile active Friendly Rules (ModifyHeader, Redirect) from Profiles to Chrome DNR.
 */
let _syncInProgress = false;
let _syncPending = false;

async function syncDNRRules() {
  if (_syncInProgress) {
    _syncPending = true;
    return;
  }
  _syncInProgress = true;
  try {
    await _doSyncDNRRules();
  } finally {
    _syncInProgress = false;
    if (_syncPending) {
      _syncPending = false;
      await syncDNRRules();
    }
  }
}

async function _doSyncDNRRules() {
  const [globalEnabled, profiles, activeProfileId] = await Promise.all([
    getGlobalEnabled(), getProfiles(), getActiveProfileId()
  ]);

  // Clean up any stray dynamic rules from older versions
  const existingDynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
  if (existingDynamicRules.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingDynamicRules.map(r => r.id) });
  }

  const existingSessionRules = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existingSessionRules.map(r => r.id);

  const addRules = [];
  let dnrId = 1;

  const mapResourceType = (cdpType) => {
    const map = { 'Document': 'main_frame', 'Stylesheet': 'stylesheet', 'Script': 'script', 'Image': 'image', 'Font': 'font', 'XHR': 'xmlhttprequest', 'Fetch': 'xmlhttprequest', 'Ping': 'ping', 'Media': 'media', 'WebSocket': 'websocket', 'Other': 'other' };
    return map[cdpType] || 'other';
  };

  if (globalEnabled) {
    for (const [i, profile] of profiles.entries()) {
      if (!isProfileActive(profile, activeProfileId, i === 0)) continue;

      for (const mod of profile.rules) {
        if (!mod.enabled || mod.type === 'AdvancedJS') continue;

        const matchObj = mod.match || { type: 'wildcard', urlPattern: '*://*/*', resourceTypes: [] };
        const condition = {};

        let pattern = matchObj.urlPattern || '*://*/*';

        if (matchObj.type === 'regex') {
          if (pattern === '*://*/*' || pattern === '<all_urls>') {
            condition.regexFilter = '.*';
          } else {
            try {
              new RegExp(pattern);
              condition.regexFilter = pattern;
            } catch (e) {
              console.error(`[RuleEngine] Invalid regex filter: ${pattern}. Skipping DNR rule to prevent engine crash.`);
              continue;
            }
          }
        } else {
          // Wildcard → use urlFilter (simpler, more reliable than regexFilter for DNR)
          condition.urlFilter = parseChromeMatchPattern(pattern);
        }

        if (matchObj.resourceTypes && matchObj.resourceTypes.length > 0) {
          condition.resourceTypes = [...new Set(matchObj.resourceTypes.map(mapResourceType))];
        } else {
          // Chrome DNR excludes main_frame by default when resourceTypes is omitted.
          // Explicitly include all types so rules apply to all requests including page loads.
          condition.resourceTypes = [
            'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
            'font', 'object', 'xmlhttprequest', 'ping', 'csp_report',
            'media', 'websocket', 'webtransport', 'webbundle', 'other'
          ];
        }

        if (mod.type === 'ModifyHeader' && mod.headers && mod.headers.length > 0) {
          const requestHeaders = [];
          const responseHeaders = [];

          mod.headers.forEach(h => {
            const headerRule = { header: h.name, operation: h.operation };
            if (h.operation !== 'remove') headerRule.value = h.value;
            if (h.stage === 'Request') requestHeaders.push(headerRule);
            else responseHeaders.push(headerRule);
          });

          if (requestHeaders.length > 0 || responseHeaders.length > 0) {
            const action = { type: 'modifyHeaders' };
            if (requestHeaders.length > 0) action.requestHeaders = requestHeaders;
            if (responseHeaders.length > 0) action.responseHeaders = responseHeaders;
            addRules.push({ id: dnrId++, priority: 2, action, condition });
          }
        } else if (mod.type === 'Redirect' && mod.redirectUrl) {
          addRules.push({ id: dnrId++, priority: 3, action: { type: 'redirect', redirect: { url: mod.redirectUrl } }, condition });
        } else if (mod.type === 'BlockRequest') {
          addRules.push({ id: dnrId++, priority: 4, action: { type: 'block' }, condition });
        }
      }
    }
  }

  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
  console.log(`[ModNetwork] DNR Engine Synced: Removed ${removeRuleIds.length}, Added ${addRules.length} rules (global scope)`);
  if (addRules.length > 0) {
    console.log(`[ModNetwork] Active DNR Compilation: `, addRules);
  }
}

/**
 * Find all active ModifyHeader response-stage headers that match this URL.
 * Used by the interceptor to manually apply response header rules when
 * Fetch.fulfillRequest would otherwise bypass DNR response header processing.
 *
 * Returns a flat array of { name, value, operation } header modifications.
 */
async function findMatchingResponseHeaderRules(url, resourceType, tabDomains = []) {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return [];

  const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  const headers = [];

  for (const [i, profile] of profiles.entries()) {
    if (!isProfileActive(profile, activeProfileId, i === 0)) continue;

    for (const mod of profile.rules) {
      if (!mod.enabled || mod.type !== 'ModifyHeader') continue;
      if (!mod.headers || mod.headers.length === 0) continue;

      const matchObj = mod.match || { type: 'wildcard', urlPattern: '*://*/*', resourceTypes: [] };
      if (!matchesUrl(url, matchObj, tabDomains) || !matchesResourceType(resourceType, matchObj.resourceTypes)) continue;

      for (const h of mod.headers) {
        if (h.stage === 'Response') {
          headers.push({ name: h.name, value: h.value, operation: h.operation });
        }
      }
    }
  }

  return headers;
}

export {
  patternToRegex,
  matchesUrl,
  matchesResourceType,
  findMatchingRules,
  findMatchingResponseHeaderRules,
  hasAdvancedJSRuleForUrl,
  isAnyRuleActiveForUrl,
  generateFetchPatterns,
  syncDNRRules
};
