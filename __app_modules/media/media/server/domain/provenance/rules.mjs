/**
 * Provenance rules — which service a title is shown as coming from, decided by
 * the household's config (the household's provenance.yml), not by code.
 *
 * Three stages, each read top to bottom, first match wins:
 *
 *   overrides  - beat whatever the availability service says (VidAngel when the
 *                content filter is on, Living Scriptures by collection, a
 *                studio's own service). A match spends no lookup.
 *   priority   - groups of providers, in order, applied to the availability
 *                service's offers. `providers: any` takes any offer with a logo.
 *   fallbacks  - nothing usable from the offers: rules by year, length,
 *                library; the last one usually `when: always`.
 *
 * A `when` is a set of facts, all of which must hold; a list value matches if
 * any item does (case-insensitive; `studio` matches whole words inside the
 * name, so `MGM` matches "Metro-Goldwyn-Mayer (MGM)" but `AMC` does not match
 * "DreamCrew"). `always` (or no `when`) matches anything.
 *
 *   kind: [movie, show]          library: [Movies]          studio: [CuriosityStream]
 *   collection: [LDS]            label: [Missionary]        content_filter: active
 *   year_before: 1950            shorter_than_min: 40       longer_than_min: 200
 *
 * A rule's `provider` may be a list: one of them is picked per title (stable,
 * from the title's key), so a title always lands on the same one.
 *
 * Pure: facts come in, a choice comes out.
 *
 * Reference: __docs/reference/media/provenance.md
 */

const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).trim()).filter(Boolean);
const lower = (v) => list(v).map((x) => x.toLowerCase());

/** The `when` keys a rule may use. */
export const WHEN_KEYS = Object.freeze([
  'kind', 'library', 'studio', 'collection', 'label', 'content_filter',
  'year_before', 'shorter_than_min', 'longer_than_min',
]);

function parseWhen(raw) {
  if (raw == null || raw === 'always' || raw === true) return { always: true };
  if (typeof raw !== 'object') return { never: true };
  const when = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!WHEN_KEYS.includes(key)) return { never: true, unknown: key }; // a typo must not match everything
    if (key === 'year_before' || key === 'shorter_than_min' || key === 'longer_than_min') {
      const n = Number(value);
      if (!Number.isFinite(n)) return { never: true, unknown: key };
      when[key] = n;
    } else if (key === 'content_filter') {
      when[key] = String(value).toLowerCase() === 'active';
    } else {
      when[key] = lower(value);
    }
  }
  return when;
}

function parseRule(raw, stage) {
  if (!raw || typeof raw !== 'object') return null;
  const providers = list(raw.provider);
  if (!providers.length) return null;
  return Object.freeze({ stage, providers, when: Object.freeze(parseWhen(raw.when)), name: raw.name ? String(raw.name) : null });
}

/**
 * Normalise the config's rule sections. Older files (`providers: {free,
 * subscribed}`) become priority groups free > subscribed > any, as before.
 */
export function parseRules(cfg = {}) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  let priority = Array.isArray(c.priority)
    ? c.priority.map((g, k) => {
      if (!g || typeof g !== 'object') return null;
      const any = g.providers === 'any';
      return Object.freeze({ name: String(g.name || `group-${k + 1}`), any, providers: any ? [] : list(g.providers) });
    }).filter(Boolean)
    : null;
  if (!priority) {
    const legacy = c.providers && typeof c.providers === 'object' ? c.providers : {};
    priority = [
      { name: 'free', any: false, providers: list(legacy.free) },
      { name: 'subscribed', any: false, providers: list(legacy.subscribed) },
      { name: 'other', any: true, providers: [] },
    ];
  }
  return Object.freeze({
    overrides: Object.freeze((Array.isArray(c.overrides) ? c.overrides : []).map((r) => parseRule(r, 'override')).filter(Boolean)),
    priority: Object.freeze(priority),
    fallbacks: Object.freeze((Array.isArray(c.fallbacks) ? c.fallbacks : []).map((r) => parseRule(r, 'fallback')).filter(Boolean)),
  });
}

/** Whether `words` appears in `text` as whole words (both lower case). */
function containsWords(text, words) {
  const escaped = words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

/** Whether a rule's `when` holds for a title's facts. */
export function matchesWhen(when, facts = {}) {
  if (!when || when.never) return false;
  if (when.always) return true;
  const has = (key, values) => {
    const mine = lower(facts[key]);
    return values.some((v) => mine.includes(v));
  };
  for (const [key, value] of Object.entries(when)) {
    if (key === 'studio') {
      // Studios are spelled many ways ("Metro-Goldwyn-Mayer (MGM)", "20th Century Fox"):
      // match whole words inside the name, so "AMC" is not found in "DreamCrew".
      const studio = String(facts.studio ?? '').toLowerCase();
      if (!studio || !value.some((v) => containsWords(studio, v))) return false;
    } else if (key === 'kind' || key === 'library' || key === 'collection' || key === 'label') {
      const factKey = { kind: 'kind', library: 'library', collection: 'collections', label: 'labels' }[key];
      if (!has(factKey, value)) return false;
    } else if (key === 'content_filter') {
      if (!!facts.contentFilterActive !== value) return false;
    } else if (key === 'year_before') {
      if (!(Number.isFinite(facts.year) && facts.year < value)) return false;
    } else if (key === 'shorter_than_min') {
      if (!(Number.isFinite(facts.durationMs) && facts.durationMs > 0 && facts.durationMs < value * 60000)) return false;
    } else if (key === 'longer_than_min') {
      if (!(Number.isFinite(facts.durationMs) && facts.durationMs > value * 60000)) return false;
    }
  }
  return true;
}

/** Whether any rule in the set asks about the content filter (so the caller need only look it up then). */
export function needsContentFilter(rules) {
  return [...(rules?.overrides || []), ...(rules?.fallbacks || [])].some((r) => 'content_filter' in (r.when || {}));
}

/** A stable index in [0, n) from a string (FNV-1a). */
export function stableIndex(key, n) {
  if (n <= 1) return 0;
  let h = 0x811c9dc5;
  for (const ch of String(key ?? '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % n;
}

/** The first of a rule's providers that can be shown, picked stably per title when there are several. */
function pickProvider(rule, key, canShow) {
  const usable = rule.providers.filter((p) => canShow(p));
  if (!usable.length) return null;
  return usable[stableIndex(key, usable.length)];
}

/** The first rule in a stage that matches and has a showable provider. */
export function firstRule(rules, facts, canShow = () => true) {
  for (const rule of rules || []) {
    if (!matchesWhen(rule.when, facts)) continue;
    const provider = pickProvider(rule, facts.key, canShow);
    if (provider) return { rule, provider };
  }
  return null;
}

/**
 * The best of the availability offers by the priority groups, or null.
 * `offers`: [{ provider, name, type }] already narrowed to streaming offers.
 */
export function rankOffers(offers, priority, canShow = () => true) {
  const usable = (Array.isArray(offers) ? offers : []).filter((o) => o?.provider && canShow(o.provider));
  for (const group of priority || []) {
    if (group.any) {
      if (usable.length) return { group, offer: usable[0] };
      continue;
    }
    for (const p of group.providers) {
      const offer = usable.find((o) => o.provider === p);
      if (offer) return { group, offer };
    }
  }
  return null;
}
