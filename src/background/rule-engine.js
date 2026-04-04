/**
 * RuleEngine — Matches incoming requests against user-defined Profiles and Mods.
 */

import { getProfiles, getGlobalEnabled } from '../storage/storage-manager.js';

function patternToRegex(pattern) {
  if (pattern === '<all_urls>' || pattern === '*') return /^https?:\/\/.*/;
  let regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + regex + '$', 'i');
}

function matchesUrl(url, pattern) {
  try { return patternToRegex(pattern).test(url); }
  catch (e) { return false; }
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

  const profiles = await getProfiles();
  const matchingMods = [];

  for (const profile of profiles) {
    if (!profile.enabled) continue;

    // A profile matches if ANY of its filters match the request
    const filterMatch = profile.filters.some(f => 
      matchesUrl(url, f.urlPattern) && matchesResourceType(resourceType, f.resourceTypes)
    );

    if (filterMatch) {
      for (const mod of profile.mods) {
        if (!mod.enabled || mod.type !== 'AdvancedJS') continue;
        if (stage === 'Request' && !mod.scripts?.onBeforeRequest) continue;
        if (stage === 'Response' && !mod.scripts?.onResponse) continue;
        
        matchingMods.push(mod);
      }
    }
  }

  return matchingMods;
}

/**
 * Check if any AdvancedJS rules could potentially match a URL (quick check).
 */
async function hasAnyMatchingRules(url) {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return false;

  const profiles = await getProfiles();
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const hasJsMods = profile.mods.some(m => m.enabled && m.type === 'AdvancedJS');
    if (!hasJsMods) continue;

    const filterMatch = profile.filters.some(f => matchesUrl(url, f.urlPattern));
    if (filterMatch) return true;
  }
  return false;
}

/**
 * Generate CDP Fetch.RequestPattern array for the Debugger API based on Profile filters.
 */
async function generateFetchPatterns() {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return [];

  const profiles = await getProfiles();
  const patterns = [];

  for (const profile of profiles) {
    if (!profile.enabled) continue;
    const activeJsMods = profile.mods.filter(m => m.enabled && m.type === 'AdvancedJS');
    if (activeJsMods.length === 0) continue;

    let wantsRequest = activeJsMods.some(m => m.scripts?.onBeforeRequest);
    let wantsResponse = activeJsMods.some(m => m.scripts?.onResponse);

    for (const filter of profile.filters) {
      const urlPattern = filter.urlPattern || '*://*/*';
      const resourceTypes = filter.resourceTypes || [];
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

  return patterns;
}

/**
 * Compile active Friendly Rules (ModifyHeader, Redirect) from Profiles to Chrome DNR.
 */
async function syncDNRRules() {
  const globalEnabled = await getGlobalEnabled();
  const profiles = await getProfiles();
  
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map(r => r.id);

  const addRules = [];
  let dnrId = 1;

  const mapResourceType = (cdpType) => {
    const map = { 'Document': 'main_frame', 'Stylesheet': 'stylesheet', 'Script': 'script', 'Image': 'image', 'Font': 'font', 'XHR': 'xmlhttprequest', 'Fetch': 'xmlhttprequest', 'Ping': 'ping', 'Media': 'media', 'WebSocket': 'websocket', 'Other': 'other' };
    return map[cdpType] || 'other';
  };

  if (globalEnabled) {
    for (const profile of profiles) {
      if (!profile.enabled) continue;

      // Group condition logic: a DNR rule can only have ONE urlFilter condition. 
      // If a Profile has multiple filters, we must duplicate the DNR action for each filter!
      const profileFilters = profile.filters && profile.filters.length > 0 ? profile.filters : [{ urlPattern: '*://*/*', resourceTypes: [] }];

      for (const mod of profile.mods) {
        if (!mod.enabled || mod.type === 'AdvancedJS') continue;

        for (const filter of profileFilters) {
          const condition = {};
          if (filter.urlPattern && filter.urlPattern !== '*://*/*' && filter.urlPattern !== '<all_urls>') {
            condition.urlFilter = filter.urlPattern;
          }
          
          if (filter.resourceTypes && filter.resourceTypes.length > 0) {
            condition.resourceTypes = [...new Set(filter.resourceTypes.map(mapResourceType))];
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
              addRules.push({ id: dnrId++, priority: 1, action, condition });
            }
          } else if (mod.type === 'Redirect' && mod.redirectUrl) {
            addRules.push({ id: dnrId++, priority: 2, action: { type: 'redirect', redirect: { url: mod.redirectUrl } }, condition });
          }
        }
      }
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  console.log(`[ModNetwork] DNR Synced: Removed ${removeRuleIds.length}, Added ${addRules.length}`);
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
