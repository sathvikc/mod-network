/**
 * RuleEngine — Matches incoming requests against user-defined Profiles and Mods.
 */

import { getProfiles, getGlobalEnabled } from '../storage/storage-manager.js';

function patternToRegex(pattern) {
  if (pattern === '<all_urls>' || pattern === '*') return /^https?:\/\/.*/;
  let regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + regex + '$', 'i');
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

  const profiles = await getProfiles();
  const matchingMods = [];

  for (const profile of profiles) {
    if (!profile.enabled) continue;

    for (const mod of profile.mods) {
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
 * Check if ANY active rule (Header, Redirect, JS) applies to this URL.
 */
async function isAnyRuleActiveForUrl(url) {
  const globalEnabled = await getGlobalEnabled();
  if (!globalEnabled) return false;

  const profiles = await getProfiles();
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    
    for (const mod of profile.mods) {
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

  const profiles = await getProfiles();
  const patterns = [];

  for (const profile of profiles) {
    if (!profile.enabled) continue;
    
    for (const mod of profile.mods) {
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

      for (const mod of profile.mods) {
        if (!mod.enabled || mod.type === 'AdvancedJS') continue;

        const matchObj = mod.match || { type: 'wildcard', urlPattern: '*://*/*', resourceTypes: [] };
        const condition = {};
        
        let pattern = matchObj.urlPattern || '*://*/*';
        
        if (matchObj.type === 'regex') {
          if (pattern === '*://*/*' || pattern === '<all_urls>') {
            // If they switched to regex but left the default wildcard string, convert it to a valid regex catch-all
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
          if (pattern !== '*://*/*' && pattern !== '<all_urls>') {
            condition.urlFilter = pattern;
          }
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
            addRules.push({ id: dnrId++, priority: 1, action, condition });
          }
        } else if (mod.type === 'Redirect' && mod.redirectUrl) {
          addRules.push({ id: dnrId++, priority: 2, action: { type: 'redirect', redirect: { url: mod.redirectUrl } }, condition });
        }
      }
    }
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  console.log(`[ModNetwork] DNR Engine Synced: Removed ${removeRuleIds.length}, Added ${addRules.length} rules`);
  if (addRules.length > 0) {
    console.log(`[ModNetwork] Active DNR Compilation: `, addRules);
  }
}

export {
  patternToRegex,
  matchesUrl,
  matchesResourceType,
  findMatchingRules,
  isAnyRuleActiveForUrl,
  generateFetchPatterns,
  syncDNRRules
};
