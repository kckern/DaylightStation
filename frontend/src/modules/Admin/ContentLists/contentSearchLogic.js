// Content-id-like text (`plex:456724`, `hymn: 147`, `canvas:a/b.jpg`) is an
// intentional commit; exploratory search text is not. Space after the colon
// is tolerated because list YAML historically stores `hymn: 147`.
// Single source of truth — the combobox machine/hooks and ListsItemRow
// must import this, not re-declare it.
export const CONTENT_ID_LIKE = /^[\w-]+:\s?\S+/;

export function isContentIdLike(text) {
  return typeof text === 'string' && CONTENT_ID_LIKE.test(text);
}

// EmptyItemRow auto-add gate: only auto-persist values that came from a
// dropdown selection or a pasted content id. Freeform text must be added
// explicitly (Enter on the row). Root cause of the 2026-03-01 tvapp.yml
// junk-entries bug: blur-commit → setInput → auto-add POST of raw text.
export function shouldAutoAdd(input) {
  return isContentIdLike(input);
}

// Parse a `source:term` query. Mirrors the backend ContentQueryService prefix
// grammar (source may contain hyphens; term must be non-empty). Returns null
// when there is no prefixed, non-empty term.
export function parseSourcePrefix(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/^([\w-]+):(.+)$/);
  return m ? { source: m[1].toLowerCase(), term: m[2] } : null;
}

// Is a `source:term` query a DIRECT content-id entry rather than a keyword
// search WITHIN that source? Typing `plex:455704` is obviously entering an id,
// not "searching within plex" — so the source-scope chip must not appear.
// Signals (any one): a numeric term (plex/hymn rating keys), a path term
// (files:clips/x.mp4, app:foo/param, canvas:a/b.jpg), or the backend already
// returned a result whose id exactly equals the whole query (an app/registry or
// id-lookup hit). Keyword searches (plex:bluey) satisfy none → still scope+chip.
export function isDirectSourceIdQuery(text, results = []) {
  const parsed = parseSourcePrefix(text);
  if (!parsed) return false;
  const term = parsed.term.trim();
  if (/^\d+$/.test(term)) return true;
  if (term.includes('/')) return true;
  return Array.isArray(results) && results.some((r) => r?.id === text);
}
