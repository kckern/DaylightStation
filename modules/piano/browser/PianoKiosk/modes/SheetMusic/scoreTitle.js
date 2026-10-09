/**
 * Prettify a filename-derived title: "fur-elise-super-easy" → "Fur Elise Super Easy".
 *
 * The title-casing pass runs ONLY on slug-shaped input (separators, no spaces).
 * A name that already contains spaces is a real title and keeps its own case,
 * because `\b\w` treats an accented letter as a non-word character: it read
 * "Burgmüller" as "Burgm" + "ller" and capitalised the second half
 * ("BurgmüLler"), which also mangled "Progrès" → "ProgrèS" and "Réunion" →
 * "RéUnion", and broke the per-composer ink lookup on the score plates.
 */
export function prettyTitle(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Score';
  const base = s
    .replace(/\.[a-z0-9]+$/i, '')       // drop any lingering extension
    .replace(/[_-]+/g, ' ')             // dashes/underscores → spaces
    .replace(/\s+/g, ' ')
    .trim();
  // Slug-shaped means: no spaces, AND either separator-joined ("fur-elise") or
  // entirely lowercase ("gymnopedie"). Anything with its own capitalisation is
  // a real title — "Progrès" is one word and must keep its final lowercase s.
  const stripped = s.replace(/\.[a-z0-9]+$/i, '');
  const wasSlug = !/\s/.test(stripped)
    && (/[_-]/.test(stripped) || stripped === stripped.toLowerCase());
  return wasSlug ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : base;
}

/** Title from a content id's basename: "files:a/b/super-mario-theme.mxl" → "Super Mario Theme". */
export function titleFromScoreId(id) {
  const base = String(id || '').split('/').pop() || '';
  return prettyTitle(base.replace(/^[a-z]+:/i, ''));
}
