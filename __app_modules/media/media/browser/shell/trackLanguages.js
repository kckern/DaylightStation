// The languages this browser last chose for subtitles and for audio, most
// recent first (smart long lists, 2026-11-26): a file with dozens of subtitle
// streams shows the current one and the three in the languages used last,
// the rest under More. A small, per-browser convenience; losing it only
// changes the order.
import { browserPreference } from "../../../../../frontend/src/lib/browserPreference.js";

export const TRACK_LANGUAGES_KEY = 'media-app.track-languages';
const MAX_LANGUAGES = 6;
const KINDS = ['subtitle', 'audio'];

function decode(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return Object.fromEntries(KINDS.map((kind) => [kind,
      Array.isArray(parsed[kind]) ? parsed[kind].filter((lang) => typeof lang === 'string' && lang) : []]));
  } catch {
    return null;
  }
}

export function createTrackLanguages(getStorage = () => localStorage) {
  const pref = browserPreference(TRACK_LANGUAGES_KEY, null, decode, getStorage);
  const read = () => pref.read() ?? { subtitle: [], audio: [] };
  return {
    /** Most recent first. */
    recent(kind) { return read()[kind] ?? []; },
    /** A track in `language` was chosen on purpose. */
    record(kind, language) {
      if (!KINDS.includes(kind) || typeof language !== 'string' || !language) return false;
      const state = read();
      const next = [language, ...(state[kind] ?? []).filter((lang) => lang !== language)].slice(0, MAX_LANGUAGES);
      pref.write(JSON.stringify({ ...state, [kind]: next }));
      return true;
    },
  };
}

/** Comparator: tracks in recently used languages first (most recent first), else input order. */
export function trackLanguageRank(recent = [], tracks = []) {
  const place = new Map(recent.map((lang, index) => [lang, index]));
  const input = new Map(tracks.map((track, index) => [track.id, index]));
  const of = (track) => (track.language && place.has(track.language) ? place.get(track.language) : Infinity);
  return (a, b) => (of(a) - of(b)) || ((input.get(a.id) ?? 0) - (input.get(b.id) ?? 0));
}

let shared = null;
export function trackLanguages() {
  if (!shared) shared = createTrackLanguages();
  return shared;
}
