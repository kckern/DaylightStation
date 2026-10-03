// frontend/src/modules/Player/lib/playerTracks.js
//
// The Player's side of subtitles and audio language (RQ-STEER-14): what the
// current item offers, what to ask the stream mint for, and what a person's
// choice means for the next episode. Pure functions; the Player calls them
// only for an item whose owner opted in (trackPolicy.js).
import {
  plexTracksFromMetadata, trackPreferenceKey, selectionForPreference, preferenceFromSelection,
  plexStreamParams, withStreamParams, SUBTITLES_OFF,
} from '@shared-contracts/media/playerFeatures.mjs';

const PLEX_STREAM_URL = /\/api\/v1\/proxy\/plex\/stream\/\d+/;

const contentIdOf = (info) => info?.contentId ?? info?.id ?? info?.assetId ?? null;
const metadataOf = (info) => info?.metadata ?? null;

/** The show/item key a choice for this item is remembered under. */
export function preferenceKeyFor(info) {
  return trackPreferenceKey({ contentId: contentIdOf(info), metadata: metadataOf(info), type: info?.type });
}

/** Plex tracks for a resolved item, or null when it has none (or is not Plex). */
export function plexTracksFor(info) {
  if (!info || !PLEX_STREAM_URL.test(info.mediaUrl ?? '')) return null;
  return plexTracksFromMetadata(metadataOf(info));
}

/**
 * Apply a remembered choice to a resolved item before it renders. Returns the
 * item unchanged unless a choice exists AND differs from the file's own
 * default — so an item nobody chose for streams exactly as before.
 * @returns {{ info: Object, applied: Object|null }}
 */
export function applyRememberedTracks(info, getPreference) {
  const tracks = plexTracksFor(info);
  if (!tracks || typeof getPreference !== 'function') return { info, applied: null };
  const preference = getPreference(preferenceKeyFor(info));
  const selection = selectionForPreference(tracks, preference);
  const params = plexStreamParams(selection);
  if (!params) return { info, applied: null };
  return { info: { ...info, mediaUrl: withStreamParams(info.mediaUrl, params) }, applied: selection };
}

/**
 * The published track state for the current item: Plex metadata (with the
 * applied choice overriding the file's default), else the engine's own list.
 */
export function trackStateFor(info, { applied = null, engine = null } = {}) {
  const plex = plexTracksFor(info);
  let base = plex;
  if (!base && engine) {
    try { base = engine.list(); } catch { base = null; }
  }
  if (!base) return null;
  const selected = { ...base.selected };
  if (plex) {
    // A Plex subtitle shows only when this mint burned it in: Plex's own
    // "selected" flag on the file says nothing about what is on screen.
    selected.subtitle = applied?.subtitle && applied.subtitle !== SUBTITLES_OFF ? applied.subtitle : null;
    if (applied?.audio) selected.audio = applied.audio;
  }
  return {
    contentId: contentIdOf(info),
    source: base.source,
    audio: base.audio,
    subtitles: base.subtitles,
    selected,
  };
}

/** Is `selection` something this item can do? Returns an error code or null. */
export function checkSelection(state, selection = {}) {
  if (!state) return 'NO_TRACKS';
  if (selection.audio != null && !state.audio.some((t) => t.id === selection.audio)) return 'UNKNOWN_TRACK';
  if (selection.subtitle != null && selection.subtitle !== SUBTITLES_OFF
    && !state.subtitles.some((t) => t.id === selection.subtitle)) return 'UNKNOWN_TRACK';
  return null;
}

/** The preference to remember after a choice (merged with what was there). */
export function rememberSelection(info, state, selection, getPreference, setPreference) {
  const key = preferenceKeyFor(info);
  if (!key || typeof setPreference !== 'function') return null;
  const previous = typeof getPreference === 'function' ? getPreference(key) : null;
  const next = preferenceFromSelection(state, selection, previous);
  setPreference(key, next);
  return { key, preference: next };
}

export { SUBTITLES_OFF };
