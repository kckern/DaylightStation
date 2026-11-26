// What this browser has learned about the person using it, so a choice made
// once is not asked for again (__docs/reference/media/media-app.md, "Looking
// and watching"). Two memories, both kept in this browser only:
//
//   picks   — which result was chosen for which words. Typing "sonic" again
//             puts the film picked last time above the album, the track and
//             the show that outrank it on text alone.
//   screens — which screen deliberate plays of each kind of thing go to,
//             counted and fading like picks, so one "Play here" does not undo
//             a habit. The strongest names the one-tap ▶ ("▶ Office Screen")
//             when nothing is aimed.
//
// Only deliberate acts are recorded: a pick when a row is opened or played,
// a screen when something is played on purpose. Typing, scrolling and looking
// never write here. Plain module (no React) so tests and hooks share one copy.
import { browserPreference, subscribeToStorageKey } from "../../../../../frontend/src/lib/browserPreference.js";

export const HABITS_KEY = 'media-app.habits';
const SCHEMA_VERSION = 1;
const MAX_QUERIES = 200;
const MAX_PICKS_PER_QUERY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
// A pick fades by half every 30 days: last week's Sonic beats a show picked
// once in the spring, and nothing learned is permanent.
const HALF_LIFE_MS = 30 * DAY_MS;
const MAX_SCREEN_CHOICES = 6;

const VIDEO_TYPES = new Set(['movie', 'episode', 'show', 'season', 'series', 'clip', 'video', 'trailer', 'film', 'channel']);
const AUDIO_TYPES = new Set(['track', 'album', 'artist', 'song', 'audiobook', 'book', 'podcast', 'audio', 'music']);

/** 'video' | 'audio' | null — what kind of thing an item is, for screens. */
export function itemKind(item) {
  if (!item) return null;
  // `format` is the queue input's name for the same fact (resultToQueueInput).
  const mediaType = String(item.mediaType ?? item.format ?? item.metadata?.mediaType ?? '').toLowerCase();
  // Player formats name the transport too: hls_video, dash_video.
  if (mediaType === 'video' || mediaType.endsWith('_video')) return 'video';
  if (mediaType === 'audio' || mediaType.endsWith('_audio')) return 'audio';
  const type = String(item.type ?? item.metadata?.type ?? '').toLowerCase();
  if (VIDEO_TYPES.has(type)) return 'video';
  if (AUDIO_TYPES.has(type)) return 'audio';
  return null;
}

/** The words of a search, as one key: case, spacing and punctuation dropped. */
export function normalizeQuery(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function emptyState() {
  return { v: SCHEMA_VERSION, picks: {}, places: {} };
}

function decode(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== SCHEMA_VERSION) return null;
    return {
      v: SCHEMA_VERSION,
      picks: parsed.picks && typeof parsed.picks === 'object' ? parsed.picks : {},
      // `places`, not the first release's `screens`: those counted a default
      // play "here" as a choice, so a first ▶ taught "films → here". Only
      // choices are recorded now; the old field is dropped unread.
      places: parsed.places && typeof parsed.places === 'object' ? parsed.places : {},
    };
  } catch {
    return null;
  }
}

function weight(entry, now) {
  const age = Math.max(0, now - (entry.at ?? 0));
  return (entry.count ?? 1) * Math.pow(0.5, age / HALF_LIFE_MS);
}

/**
 * The habits store. `storage` and `now` are injectable so tests run without
 * a real localStorage or clock.
 */
export function createHabitsStore({ getStorage = () => localStorage, now = () => Date.now() } = {}) {
  const pref = browserPreference(HABITS_KEY, null, decode, getStorage);
  const readRaw = () => { try { return getStorage().getItem(HABITS_KEY); } catch { return null; } };
  let raw = readRaw();
  let state = pref.read() ?? emptyState();
  // Storage is the truth: if the key changed underneath (cleared, another
  // tab, a test), reread it rather than serve a stale copy.
  const current = () => {
    const now = readRaw();
    if (now !== raw) {
      raw = now;
      state = pref.read() ?? emptyState();
    }
    return state;
  };
  const listeners = new Set();
  const notify = () => { for (const listener of listeners) listener(); };
  const save = (next) => {
    state = next;
    raw = JSON.stringify(state);
    pref.write(raw);
    notify();
  };

  return {
    getSnapshot: () => current(),
    subscribe(listener) {
      listeners.add(listener);
      // Another tab of this browser learning something is this browser learning it.
      const off = typeof window === 'undefined' ? () => {} : subscribeToStorageKey(HABITS_KEY, () => {
        current();
        notify();
      }, getStorage);
      return () => { listeners.delete(listener); off(); };
    },

    /** The person chose `item` after searching `text` (opened it or played it). */
    recordPick(text, item) {
      const query = normalizeQuery(text);
      const id = item?.id ?? item?.contentId;
      if (query.length < 2 || !id) return false;
      const at = now();
      current();
      const existing = state.picks[query]?.items ?? [];
      const found = existing.find(entry => entry.id === id);
      const remembered = {
        id,
        title: item.title ?? found?.title ?? null,
        // Enough to draw the row before the search answers (rankByHabits).
        item: snapshotOf(item, id) ?? found?.item ?? null,
        count: (found?.count ?? 0) + 1,
        at,
      };
      const items = [remembered, ...existing.filter(entry => entry.id !== id)]
        .sort((a, b) => weight(b, at) - weight(a, at))
        .slice(0, MAX_PICKS_PER_QUERY);
      const picks = { ...state.picks, [query]: { at, items } };
      const keys = Object.keys(picks);
      if (keys.length > MAX_QUERIES) {
        keys.sort((a, b) => (picks[a].at ?? 0) - (picks[b].at ?? 0));
        for (const key of keys.slice(0, keys.length - MAX_QUERIES)) delete picks[key];
      }
      save({ ...state, picks });
      return true;
    },

    /**
     * How strongly each item is wanted for `text`: Map(id → score). Words
     * already searched in full count most; a search the typed words begin
     * ("son" → "sonic") or extend ("sonic the" → "sonic") counts less, so the
     * film rises while the person is still typing.
     */
    scoresFor(text) {
      const query = normalizeQuery(text);
      const scores = new Map();
      if (query.length < 2) return scores;
      const at = now();
      for (const [stored, entry] of Object.entries(current().picks)) {
        let factor = 0;
        if (stored === query) factor = 1;
        else if (stored.startsWith(query) && query.length >= 3) factor = 0.6;
        else if (query.startsWith(stored) && stored.length >= 3) factor = 0.5;
        if (!factor) continue;
        for (const item of entry.items ?? []) {
          scores.set(item.id, (scores.get(item.id) ?? 0) + factor * weight(item, at));
        }
      }
      return scores;
    },

    /** Words → the remembered items picked for them (for drawing rows early). */
    rememberedFor(text) {
      const query = normalizeQuery(text);
      const found = new Map();
      if (query.length < 2) return found;
      for (const [stored, entry] of Object.entries(current().picks)) {
        if (!(stored === query || (stored.startsWith(query) && query.length >= 3) || (query.startsWith(stored) && stored.length >= 3))) continue;
        for (const item of entry.items ?? []) if (item.item && !found.has(item.id)) found.set(item.id, item.item);
      }
      return found;
    },

    /** A deliberate play of a `kind` item went to `targetIds` ([] = this device). */
    recordScreen(kind, targetIds) {
      if (kind !== 'video' && kind !== 'audio') return false;
      current();
      const ids = Array.isArray(targetIds) ? [...new Set(targetIds.filter(id => typeof id === 'string' && id))].sort() : [];
      const key = ids.join(',');
      const at = now();
      const choices = screenChoices(state.places[kind]);
      const found = choices.find(choice => choice.targetIds.join(',') === key);
      const next = [
        { targetIds: ids, count: (found?.count ?? 0) + 1, at },
        ...choices.filter(choice => choice !== found),
      ].sort((a, b) => weight(b, at) - weight(a, at)).slice(0, MAX_SCREEN_CHOICES);
      save({ ...state, places: { ...state.places, [kind]: { choices: next } } });
      return true;
    },

    /** Where deliberate plays of a `kind` item usually go, or null if never. */
    screenFor(kind) {
      const choices = screenChoices(current().places?.[kind]);
      if (choices.length === 0) return null;
      const at = now();
      return [...choices].sort((a, b) => weight(b, at) - weight(a, at))[0].targetIds;
    },

    /**
     * Every remembered choice for a `kind`, strongest first, with its faded
     * weight: [{ targetIds, weight }]. `screenFor` is the first of these; long
     * screen lists rank by the whole of it (screenWeights).
     */
    screensFor(kind) {
      const choices = screenChoices(current().places?.[kind]);
      const at = now();
      return choices
        .map(choice => ({ targetIds: [...choice.targetIds], weight: weight(choice, at) }))
        .sort((a, b) => b.weight - a.weight);
    },

    /** For tests and the debug surface only. */
    reset() { save(emptyState()); },
  };
}

// Screen choices, read from either shape (the first release stored only the
// last choice: { targetIds, at }).
function screenChoices(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.choices)) return entry.choices.filter(choice => Array.isArray(choice?.targetIds));
  if (Array.isArray(entry.targetIds)) return [{ targetIds: entry.targetIds, count: 1, at: entry.at ?? 0 }];
  return [];
}

// What a remembered pick keeps of its row: enough to draw it (title, art,
// kind) before the search answers — never the whole result.
function snapshotOf(item, id) {
  if (!item) return null;
  const type = item.type ?? item.metadata?.type ?? null;
  return {
    id,
    title: item.title ?? null,
    thumbnail: item.thumbnail ?? null,
    source: item.source ?? String(id).split(':')[0],
    type,
    mediaType: item.mediaType ?? null,
    itemType: item.itemType ?? null,
    metadata: type ? { type } : {},
  };
}

/**
 * Results in the order this person wants them: items they picked for these
 * words first (strongest first), everything else in the order it came.
 *
 * `remembered` (Map id → stored row) lets a picked item hold row 1 from the
 * first keystroke, drawn from what was kept of it, and be swapped for the
 * real row in place when the search answers — so the list never shifts under
 * a pointer or a highlighted index while sources stream in. Without it, only
 * rows that arrived are lifted. Returns the input array itself when nothing
 * applies, so callers can tell.
 */
export function rankByHabits(results, scores, remembered = null) {
  if (!Array.isArray(results) || !scores || scores.size === 0) return results;
  const arrived = new Map();
  const rest = [];
  for (const item of results) {
    if (scores.has(item?.id)) arrived.set(item.id, item);
    else rest.push(item);
  }
  const ids = [...scores.keys()].filter(id => arrived.has(id) || remembered?.has(id));
  if (ids.length === 0) return results;
  ids.sort((a, b) => scores.get(b) - scores.get(a));
  return [...ids.map(id => arrived.get(id) ?? { ...remembered.get(id), remembered: true }), ...rest];
}

/**
 * Per-screen habit weight from `screensFor`: a screen in several remembered
 * choices (alone, and with another) sums them. Map(id → weight).
 */
export function screenWeights(choices) {
  const weights = new Map();
  for (const choice of choices ?? []) {
    for (const id of choice?.targetIds ?? []) weights.set(id, (weights.get(id) ?? 0) + (choice.weight ?? 0));
  }
  return weights;
}

let shared = null;
/** The one store this tab uses. */
export function habitsStore() {
  if (!shared) shared = createHabitsStore();
  return shared;
}

/** Tests only: drop the shared store so the next call rereads storage. */
export function resetHabitsStoreForTests() {
  shared = null;
}
