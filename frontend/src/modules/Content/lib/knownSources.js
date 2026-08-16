/**
 * Known content-source prefixes, for validating a hand-typed content id.
 *
 * The combobox accepts any `word:rest` string as a literal so that a raw id
 * copied from Plex can be pasted in. That same leniency let an invented prefix
 * (`img:art/fhe/esther.jpg`) be saved into a live list, where the only feedback
 * was a background 404 on the metadata fetch and a red browse error — the row
 * looked committed. Knowing the valid prefixes lets the warning say which of
 * those two things just happened.
 *
 * The set is the union of registered adapter sources, their categories and
 * providers, and the query aliases (`hymn:`, `scripture:`, …) — anything the
 * backend will resolve. Fetched once per page load; a failure leaves the set
 * unknown, and callers treat unknown as "cannot judge" rather than "invalid",
 * so a fetch problem never produces a false alarm.
 */

let knownSources = null;
let inflight = null;

/**
 * Fetch and cache the valid prefixes. Safe to call repeatedly.
 * @returns {Promise<Set<string>|null>} null when the lookup failed
 */
export function loadKnownSources() {
  if (knownSources) return Promise.resolve(knownSources);
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [sourcesRes, aliasesRes] = await Promise.all([
        fetch('/api/v1/content/sources'),
        fetch('/api/v1/content/aliases')
      ]);
      if (!sourcesRes.ok) return null;

      const sources = await sourcesRes.json();
      // Aliases are optional — the endpoint 501s when no resolver is wired.
      const aliases = aliasesRes.ok ? await aliasesRes.json() : {};

      const all = [
        ...(sources.sources || []),
        ...(sources.categories || []),
        ...(sources.providers || []),
        ...(aliases.builtIn || []),
        ...(aliases.userDefined || []),
        // Not adapter sources, but valid list inputs the UI writes itself.
        'app',
        'menu'
      ];
      knownSources = new Set(all.map(s => String(s).toLowerCase()));
      return knownSources;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Whether a source prefix is one the backend can resolve.
 * @param {string} source
 * @returns {boolean|null} null when the valid set is not loaded yet
 */
export function isKnownSource(source) {
  if (!knownSources) return null;
  if (!source) return false;
  return knownSources.has(String(source).toLowerCase());
}

/** Test seam: forget the cached set. */
export function resetKnownSources() {
  knownSources = null;
  inflight = null;
}
