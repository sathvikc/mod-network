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
    if (!rule.enabled) continue;

    const urlPattern = rule.match.urlPattern || '*://*/*';
    const resourceTypes = rule.match.resourceTypes || [];

    // CDP only allows a single resourceType per pattern object.
    // If no types are selected, we don't intercept anything for this rule.
    // If we want to intercept all, we'd omit resourceType, but our UI explicitly checks types.
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

export {
  patternToRegex,
  matchesUrl,
  matchesResourceType,
  findMatchingRules,
  hasAnyMatchingRules,
  generateFetchPatterns
};
