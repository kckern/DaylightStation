/** Prettify a filename-derived title: "fur-elise-super-easy" → "Fur Elise Super Easy". */
export function prettyTitle(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Score';
  return s
    .replace(/\.[a-z0-9]+$/i, '')       // drop any lingering extension
    .replace(/[_-]+/g, ' ')             // dashes/underscores → spaces
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Title from a content id's basename: "files:a/b/super-mario-theme.mxl" → "Super Mario Theme". */
export function titleFromScoreId(id) {
  const base = String(id || '').split('/').pop() || '';
  return prettyTitle(base.replace(/^[a-z]+:/i, ''));
}
