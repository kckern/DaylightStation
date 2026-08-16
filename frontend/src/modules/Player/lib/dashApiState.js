/**
 * Read a dash.js MediaPlayer's state at the moment we subscribe to its events.
 *
 * Why this exists: VideoPlayer polls for `el.api` and then attaches listeners.
 * Anything dash.js emitted before that poll won the race is gone, so the absence
 * of `dash.manifest-loaded` has never distinguished "the manifest never loaded"
 * from "it loaded before we were listening". On 2026-08-16 that ambiguity sent
 * the investigation the wrong way: our logs showed no manifest event, and Plex's
 * server log later proved segments had been served the whole time. Reading the
 * player's current state at subscribe time closes the gap, because a player that
 * already has an active stream and a duration says so regardless of which events
 * we missed.
 *
 * Every accessor here is a dash.js internal. The version is whatever
 * `dash-video-element` bundles, it changes under us, and a getter can be absent
 * on one build and throw on another when called before initialisation. So each
 * read is probed independently and a failure narrows to one field rather than
 * costing us the whole snapshot.
 *
 * The `unreadable` map is the point of the shape. A field is only ever null in
 * the returned state, and `unreadable` says which kind of absence produced it —
 * so `duration: null` with an empty map means we asked and dash.js genuinely had
 * no duration, while `duration: null, unreadable: { duration: 'threw' }` means we
 * never measured it. A null that cannot say which of those it is was the class of
 * defect this whole sweep exists to remove.
 */

/** The accessor is not a function on this dash.js build. */
const ABSENT = 'absent';
/** The accessor exists but raised when called. */
const THREW = 'threw';
/** The accessor returned undefined, which is not a measurement. */
const UNDEFINED = 'undefined';
/** A numeric accessor returned NaN or Infinity, which JSON transport flattens to null. */
const NOT_FINITE = 'not-finite';
/** `getActiveStream()` returned nothing — dash.js has not selected a stream yet. */
const NO_ACTIVE_STREAM = 'no-active-stream';

/** Sources can be long signed Plex urls; a prefix is enough to identify one. */
const MAX_SOURCE_CHARS = 150;

/**
 * Snapshot a dash.js MediaPlayer.
 *
 * @param {object|null|undefined} api - the `el.api` MediaPlayer handle
 * @returns {{ state: object, unreadable: Record<string, string> }}
 */
export function readDashApiState(api) {
  const unreadable = {};

  // Calls `api[method]()` and reports the reason on any path that fails to
  // produce a value, so the caller never has to guess what a null meant.
  const probe = (field, method, normalize) => {
    if (!api || typeof api[method] !== 'function') {
      unreadable[field] = ABSENT;
      return null;
    }
    let raw;
    try {
      raw = api[method]();
    } catch {
      unreadable[field] = THREW;
      return null;
    }
    if (raw === undefined) {
      unreadable[field] = UNDEFINED;
      return null;
    }
    return normalize ? normalize(raw, field) : raw;
  };

  const asFiniteNumber = (raw, field) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      unreadable[field] = NOT_FINITE;
      return null;
    }
    return value;
  };

  const state = {
    // Whether dash.js considers itself initialised. The single most useful bit:
    // true here with no manifest event means we simply subscribed late.
    isReady: probe('isReady', 'isReady', (raw) => !!raw),

    // A stream id can only exist once a manifest has been parsed and a period
    // selected, so a non-null id is independent proof the manifest loaded.
    activeStreamId: probe('activeStreamId', 'getActiveStream', (raw, field) => {
      if (!raw) {
        unreadable[field] = NO_ACTIVE_STREAM;
        return null;
      }
      if (typeof raw.getId !== 'function') {
        unreadable[field] = ABSENT;
        return null;
      }
      try {
        const id = raw.getId();
        if (id === undefined) {
          unreadable[field] = UNDEFINED;
          return null;
        }
        return id === null ? null : String(id);
      } catch {
        unreadable[field] = THREW;
        return null;
      }
    }),

    // Playhead and timeline. Both are NaN on an uninitialised player, which is a
    // different statement from "the stream has no duration".
    time: probe('time', 'time', asFiniteNumber),
    duration: probe('duration', 'duration', asFiniteNumber),

    // dash.js returns either the url string or the object it was handed.
    source: probe('source', 'getSource', (raw, field) => {
      if (raw === null) return null;
      if (typeof raw === 'string') return raw.substring(0, MAX_SOURCE_CHARS);
      try {
        return JSON.stringify(raw).substring(0, MAX_SOURCE_CHARS);
      } catch {
        unreadable[field] = THREW;
        return null;
      }
    })
  };

  return { state, unreadable };
}

export default readDashApiState;
