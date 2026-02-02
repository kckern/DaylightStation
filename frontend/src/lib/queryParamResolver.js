import { DaylightAPI } from './api.mjs';

let legacyPrefixMap = null;

/**
 * Load legacy prefix mapping from backend config
 */
async function loadPrefixMap() {
  if (legacyPrefixMap) return legacyPrefixMap;

  try {
    const config = await DaylightAPI('api/v1/config/content-prefixes');
    legacyPrefixMap = config?.legacy || {};
  } catch {
    // Fallback to hardcoded if config unavailable
    legacyPrefixMap = {
      hymn: 'singing:hymn',
      primary: 'singing:primary',
      scripture: 'narrated:scripture',
      talk: 'narrated:talks',
      poem: 'narrated:poetry'
    };
  }
  return legacyPrefixMap;
}

/**
 * Resolve legacy query params to canonical contentId
 * @param {Object} params - URL query params
 * @returns {Promise<{contentId: string, queue?: boolean} | null>}
 */
export async function resolvePlayParams(params) {
  const prefixMap = await loadPrefixMap();

  // Check legacy params
  for (const [legacyKey, canonicalPrefix] of Object.entries(prefixMap)) {
    if (params[legacyKey]) {
      return {
        contentId: `${canonicalPrefix}/${params[legacyKey]}`
      };
    }
  }

  // New canonical format
  if (params.play) {
    return { contentId: params.play };
  }
  if (params.queue) {
    return { contentId: params.queue, queue: true };
  }

  return null;
}

/**
 * Get category from contentId
 * @param {string} contentId
 * @returns {string|null}
 */
export function getCategoryFromId(contentId) {
  if (!contentId) return null;
  const match = contentId.match(/^(singing|narrated):/);
  return match ? match[1] : null;
}

export default { resolvePlayParams, getCategoryFromId };
