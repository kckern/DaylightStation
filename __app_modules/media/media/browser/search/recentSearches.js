// Recent searches (owner ruling 2026-11-27): the words a person searched AND
// acted on (opened or played a result), each kept with the scope it ran in,
// so picking one reruns it the same way. Per browser, in localStorage
// `media-app.recent-searches`: newest first, at most 20, one entry per words
// (case-insensitive; the newest scope wins). The empty search box shows 5.
//
// One small external store so the dock and the phone sheet read the same list
// and a × or Clear in one shows in the other (useSyncExternalStore).

export const RECENT_SEARCHES_KEY = 'media-app.recent-searches';
export const RECENT_SEARCHES_CAP = 20;
export const RECENT_SEARCHES_SHOWN = 5;

const listeners = new Set();
let cache = null;

function storage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

function normalize(entry) {
  const text = String(entry?.text ?? '').trim();
  if (text.length < 2) return null;
  return {
    text,
    scopeKey: entry?.scopeKey ?? null,
    scopeLabel: entry?.scopeLabel ?? null,
    at: Number.isFinite(entry?.at) ? entry.at : 0,
  };
}

function read() {
  if (cache) return cache;
  let parsed = [];
  try {
    const raw = storage()?.getItem(RECENT_SEARCHES_KEY);
    parsed = raw ? JSON.parse(raw) : [];
  } catch { parsed = []; }
  cache = (Array.isArray(parsed) ? parsed : []).map(normalize).filter(Boolean).slice(0, RECENT_SEARCHES_CAP);
  return cache;
}

function write(list) {
  cache = list;
  try { storage()?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list)); } catch { /* private mode: kept for this page only */ }
  for (const listener of listeners) listener();
}

const sameWords = (a, b) => a.toLowerCase() === b.toLowerCase();

export function recentSearches() {
  return read();
}

/** Remember words the person acted on, with their scope. Returns the new list. */
export function rememberSearch({ text, scopeKey = null, scopeLabel = null }, now = Date.now()) {
  const entry = normalize({ text, scopeKey, scopeLabel, at: now });
  if (!entry) return read();
  const rest = read().filter((e) => !sameWords(e.text, entry.text));
  const next = [entry, ...rest].slice(0, RECENT_SEARCHES_CAP);
  write(next);
  return next;
}

/** The × on one row. */
export function forgetSearch(text) {
  const next = read().filter((e) => !sameWords(e.text, String(text ?? '')));
  write(next);
  return next;
}

/** "Clear". */
export function clearSearches() {
  write([]);
  return [];
}

export function subscribeRecentSearches(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tests: forget the in-memory copy so the next read comes from storage. */
export function resetRecentSearchesCache() {
  cache = null;
}
