/**
 * RuleEngine — Matches incoming requests against user-defined Profiles and Mods.
 */

import { getProfiles, getGlobalEnabled, getActiveProfileId, getAttachedTabs } from '../storage/storage-manager.js';

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

function parseSmartUrlPattern(input) {
  let str = (input || '').trim();
  if (!str || str === '*' || str === '*://*/*' || str === '<all_urls>') return '^https?:\\/\\/.*$';
  
  // Rule: Missing protocol but has domain-like structure
  if (!str.includes('://') && !str.startsWith('*') && !str.startsWith('/')) {
    str = '*://*' + str;
  }
  
  // Rule: Path only
  if (str.startsWith('/')) {
    str = '*://*' + str;
  }
  
  // Rule: Missing trailing wildcard if it looks like a path or domain
  if (!str.endsWith('*')) {
    str = str + '*';
  }
  
  let regexStr = str.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return '^' + regexStr + '$';
}

function patternToRegex(pattern) {
  return new RegExp(parseSmartUrlPattern(pattern), 'i');
}

function matchesUrl(url, matchObj) {
  let pattern = matchObj?.urlPattern || '*://*/*';
  if (matchObj?.type === 'regex') {
    try {
      return new RegExp(pattern, 'i').test(url);
    } catch (e) {
      console.error(`[RuleEngine] Invalid Regex for rule: ${pattern}`, e);
      return false;
    }
  }
  
  try { return patternToRegex(pattern).test(url); }
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
async function findMatchingRules(url, resourceType, stage) {
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
      
      if (matchesUrl(url, matchObj) && matchesResourceType(resourceType, matchObj.resourceTypes)) {
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

  const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  for (const [i, profile] of profiles.entries()) {
    if (!isProfileActive(profile, activeProfileId, i === 0)) continue;
    for (const mod of profile.rules) {
      if (!mod.enabled || mod.type !== 'AdvancedJS') continue;
      // Don't attach if no scripts are actually defined — nothing to intercept
      if (!mod.scripts?.onBeforeRequest && !mod.scripts?.onResponse) continue;
      const matchObj = mod.match || { type: 'wildcard', urlPattern: '*://*/*' };
      if (matchesUrl(url, matchObj)) return true;
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

  const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  for (const [i, profile] of profiles.entries()) {
    if (!isProfileActive(profile, activeProfileId, i === 0)) continue;

    for (const mod of profile.rules) {
      if (!mod.enabled) continue;
      const matchObj = mod.match || { type: 'wildcard', urlPattern: '*://*/*' };
      if (matchesUrl(url, matchObj)) return true;
    }
  }
  return false;
}

/**
 * Generate CDP Fetch.RequestPattern array for the Debugger API based on Profile rules.
 */
async function generateFetchPatterns() {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return [];

  const [profiles, activeProfileId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  const patterns = [];

  for (const [i, profile] of profiles.entries()) {
    if (!isProfileActive(profile, activeProfileId, i === 0)) continue;
    
    for (const mod of profile.rules) {
      if (!mod.enabled || mod.type !== 'AdvancedJS') continue;
      
      let wantsRequest = !!mod.scripts?.onBeforeRequest;
      let wantsResponse = !!mod.scripts?.onResponse;
      
      const matchObj = mod.match || { urlPattern: '*://*/*', resourceTypes: [] };
      const urlPattern = matchObj.urlPattern;
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

  console.log(`[RuleEngine] Generated ${patterns.length} Fetch patterns for Debugger SDK`);
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
  const [globalEnabled, profiles, activeProfileId, attachedTabs] = await Promise.all([
    getGlobalEnabled(), getProfiles(), getActiveProfileId(), getAttachedTabs()
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

  // Only deploy DNR rules if Engine is ON and there are attached tabs! (Tab Restrict)
  if (globalEnabled && attachedTabs.length > 0) {
    for (const [i, profile] of profiles.entries()) {
      if (!isProfileActive(profile, activeProfileId, i === 0)) continue;

      for (const mod of profile.rules) {
        if (!mod.enabled || mod.type === 'AdvancedJS') continue;

        const matchObj = mod.match || { type: 'wildcard', urlPattern: '*://*/*', resourceTypes: [] };
        const condition = {};
        
        // Tab Session Filtering Context!
        condition.tabIds = attachedTabs;
        
        let pattern = matchObj.urlPattern || '*://*/*';
        
        if (matchObj.type === 'regex') {
          if (pattern === '*://*/*' || pattern === '<all_urls>') {
            condition.regexFilter = '.*';
          } else {
            try {
              new RegExp(pattern);
              condition.regexFilter = pattern;
            } catch(e) {
              console.error(`[RuleEngine] Invalid regex filter: ${pattern}. Skipping DNR rule to prevent engine crash.`);
              continue;
            }
          }
        } else {
          condition.regexFilter = parseSmartUrlPattern(pattern);
        }
        
        if (matchObj.resourceTypes && matchObj.resourceTypes.length > 0) {
          condition.resourceTypes = [...new Set(matchObj.resourceTypes.map(mapResourceType))];
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
  console.log(`[ModNetwork] DNR Engine Synced (Session): Removed ${removeRuleIds.length}, Added ${addRules.length} rules. Attached Tabs: ${attachedTabs.join(', ')}`);
  if (addRules.length > 0) {
    console.log(`[ModNetwork] Active DNR Compilation: `, addRules);
  }
}

export {
  patternToRegex,
  matchesUrl,
  matchesResourceType,
  findMatchingRules,
  hasAdvancedJSRuleForUrl,
  isAnyRuleActiveForUrl,
  generateFetchPatterns,
  syncDNRRules
};
