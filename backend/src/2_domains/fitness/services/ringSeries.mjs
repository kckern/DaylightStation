/**
 * Reading the ring series out of a stored session, old shape or new.
 *
 * Rings were called "coins" until 2026-08-26, and the on-disk series keys said
 * so: `<slug>:coins`, `user:<slug>:coins_total`. Every session written before
 * the rename still carries those keys, and the migration that rewrites them
 * (docs/superpowers/specs/2026-08-26-rings-and-weekly-measures-design.md §8)
 * runs AFTER this code ships — deliberately, so there is no flag day where the
 * app and the archive disagree.
 *
 * So every read goes through here: new key first, legacy key as fallback.
 *
 * THIS FILE IS MEANT TO BE DELETED. Once the migration reports zero `coins*`
 * keys outside `_deleteme`, the fallback is dead weight and step 4 of that spec
 * removes it. Until then, a direct `series[`${slug}:rings`]` read anywhere is a
 * bug that silently returns nothing for every pre-rename session — which is
 * exactly how it would escape review, since an empty series looks like "that
 * participant had no rings" rather than like a failure.
 */

/** The flat per-participant key: `<slug>:rings`, formerly `<slug>:coins`. */
export function readRingSeries(series, slug) {
  if (!series || !slug) return [];
  const next = series[`${slug}:rings`];
  if (Array.isArray(next)) return next;
  const legacy = series[`${slug}:coins`];
  return Array.isArray(legacy) ? legacy : [];
}

/**
 * The namespaced cumulative key: `user:<slug>:rings_total`, formerly
 * `user:<slug>:coins_total`. Kept separate from `readRingSeries` rather than
 * folded into it with a flag — the two key shapes belong to different
 * serializer generations and a caller should have to say which one it means.
 */
export function readRingTotalSeries(series, slug) {
  if (!series || !slug) return [];
  const next = series[`user:${slug}:rings_total`];
  if (Array.isArray(next)) return next;
  const legacy = series[`user:${slug}:coins_total`];
  return Array.isArray(legacy) ? legacy : [];
}

/**
 * Does this session predate the rename? Used by the migration's verification
 * pass and by nothing else — application code must never branch on it, only
 * read through the accessors above.
 */
export function hasLegacyRingKeys(series) {
  if (!series) return false;
  return Object.keys(series).some((k) => k.endsWith(':coins') || k.endsWith(':coins_total'));
}

export default readRingSeries;
