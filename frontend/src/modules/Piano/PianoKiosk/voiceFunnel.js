/**
 * Extract voice bundle key (pc:bank) for deduplication.
 * @param {Object} bundle - Voice entry with voice.pc and voice.bank
 * @returns {string} - "pc:bank" key
 */
export function bundleKey(bundle) {
  if (!bundle || !bundle.voice) return '';
  const { pc, bank } = bundle.voice;
  return `${pc}:${bank}`;
}

/**
 * Build voice funnel: favorites + deduped shortlist + groups.
 * Shortlist is filtered to remove any entries that appear in favorites (by pc:bank).
 * @param {Object} params
 * @param {Array} params.favorites - Favorite voice bundles
 * @param {Array} params.shortlistVoices - Candidate shortlist voices (pc, bank, name, etc.)
 * @param {Array} params.allGroups - Voice groups to pass through
 * @returns {Object} - { favorites, shortlist, groups }
 */
export function buildFunnel({ favorites = [], shortlistVoices = [], allGroups = [] }) {
  // Build a Set of pc:bank keys from favorites for fast dedup
  const favKeys = new Set();
  for (const fav of favorites) {
    const key = bundleKey(fav);
    if (key) {
      favKeys.add(key);
    }
  }

  // Filter shortlist: exclude any entries that match a favorite's pc:bank
  const shortlist = shortlistVoices.filter((voice) => {
    // For shortlist entries, pc and bank are at the top level, not nested
    const key = `${voice.pc}:${voice.bank}`;
    return !favKeys.has(key);
  });

  return {
    favorites,
    shortlist,
    groups: allGroups,
  };
}
