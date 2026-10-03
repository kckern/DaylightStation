// Player features (P2) — the contract for three screen/player capabilities
// that ride the existing `command: "session"` envelope and publish into
// `SessionSnapshot.controls` next to the P1 session controls:
//
//   - Subtitles and audio language (RQ-STEER-14, STEER.12a)   action `set-tracks`,   controls.tracks
//   - Show briefly (RQ-PLAY-11, PLAY.8a/8b)                    action `close-brief`,  controls.brief
//   - Music behind a slideshow (RQ-PLAY-12, PLAY.9a)           action `music-behind`, controls.musicBehind
//
// Pure functions only: shared by the backend router, the screen framework,
// the Player and the Media app. See docs/reference/media/media-app-technical.md
// §4.11 and §6.7. This module must not import shapes.mjs or sessionControls.mjs
// (sessionControls imports it).

export const PLAYER_FEATURE_ACTIONS = Object.freeze(['set-tracks', 'close-brief', 'music-behind']);
export const MUSIC_BEHIND_OPS = Object.freeze(['start', 'play', 'pause', 'next', 'prev', 'stop']);
export const MUSIC_BEHIND_STATES = Object.freeze(['loading', 'playing', 'paused']);
export const BRIEF_KINDS = Object.freeze(['camera', 'clip']);
/** "Off" as a subtitle choice. */
export const SUBTITLES_OFF = 'off';
/** How long Show briefly stays up when nobody says otherwise. */
export const BRIEF_DEFAULT_SECONDS = 30;
export const BRIEF_MAX_SECONDS = 600;
/** Plex stream types (Media.Part.Stream.streamType). */
const PLEX_AUDIO = 2;
const PLEX_SUBTITLE = 3;

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const result = (errors) => ({ valid: errors.length === 0, errors });

export const isPlayerFeatureAction = (v) => PLAYER_FEATURE_ACTIONS.includes(v);

// --- Session action params ---------------------------------------------------

/**
 * Validate the params of a player-feature `session` action. Returns null when
 * `action` is not a player-feature action (the caller validates it).
 * @returns {{ valid: boolean, errors: string[] } | null}
 */
export function validatePlayerFeatureParams(params) {
  const p = params ?? {};
  if (!isPlayerFeatureAction(p.action)) return null;
  const errors = [];
  if (p.action === 'set-tracks') {
    const hasAudio = p.audio !== undefined;
    const hasSubtitle = p.subtitle !== undefined;
    if (!hasAudio && !hasSubtitle) errors.push('set-tracks: audio and/or subtitle required');
    if (hasAudio && !isStr(p.audio)) errors.push('audio: track id string');
    if (hasSubtitle && !isStr(p.subtitle)) errors.push(`subtitle: track id string or "${SUBTITLES_OFF}"`);
  }
  if (p.action === 'music-behind') {
    if (!MUSIC_BEHIND_OPS.includes(p.op)) errors.push(`op: one of ${MUSIC_BEHIND_OPS.join('|')}`);
    if (p.op === 'start' && !isStr(p.contentId)) errors.push('contentId: required to start music');
    if (p.contentId !== undefined && !isStr(p.contentId)) errors.push('contentId: string');
    if (p.title !== undefined && p.title !== null && typeof p.title !== 'string') errors.push('title: string');
  }
  return result(errors);
}

// --- Tracks (STEER.12a) ------------------------------------------------------

function streamsOf(metadata) {
  const media = Array.isArray(metadata?.Media) ? metadata.Media[0] : null;
  const part = Array.isArray(media?.Part) ? media.Part[0] : null;
  return Array.isArray(part?.Stream) ? part.Stream : [];
}

function trackLabel(stream) {
  return stream.displayTitle || stream.extendedDisplayTitle || stream.title || stream.language || stream.languageCode || 'Unknown';
}

/**
 * The audio and subtitle tracks a Plex item actually has — read from the
 * item's own stream metadata (first media, first part: what Plex plays).
 * Returns null when the item carries no Plex streams.
 */
export function plexTracksFromMetadata(metadata) {
  const streams = streamsOf(metadata);
  if (streams.length === 0) return null;
  const audio = [];
  const subtitles = [];
  let selectedAudio = null;
  let selectedSubtitle = null;
  for (const s of streams) {
    if (s?.id == null) continue;
    const track = {
      id: String(s.id),
      language: s.languageCode ?? null,
      label: trackLabel(s),
      ...(s.title ? { title: s.title } : {}),
      ...(s.forced ? { forced: true } : {}),
    };
    if (s.streamType === PLEX_AUDIO) {
      audio.push(track);
      if (s.selected) selectedAudio = track.id;
    } else if (s.streamType === PLEX_SUBTITLE) {
      subtitles.push(track);
      if (s.selected) selectedSubtitle = track.id;
    }
  }
  if (audio.length === 0 && subtitles.length === 0) return null;
  return {
    source: 'plex',
    audio,
    subtitles,
    selected: { audio: selectedAudio ?? audio[0]?.id ?? null, subtitle: selectedSubtitle },
  };
}

/**
 * Key under which a track choice is remembered: the show for an episode, so
 * the choice carries on to the next episode; otherwise the item itself.
 */
export function trackPreferenceKey(item) {
  const meta = item?.metadata ?? item ?? {};
  const show = meta.grandparentId ?? item?.grandparentId ?? null;
  const isEpisode = meta.type === 'episode' || item?.type === 'episode' || meta.grandparentType === 'show';
  if (show != null && isEpisode) return `show:${show}`;
  const id = item?.contentId ?? item?.id ?? item?.assetId ?? null;
  return id ? `item:${id}` : null;
}

/** What to remember about a chosen track so it can be found again on another file. */
export function trackChoiceFrom(track) {
  if (!track) return null;
  return {
    language: track.language ?? null,
    label: track.label ?? null,
    ...(track.forced ? { forced: true } : {}),
  };
}

/**
 * Find the track matching a remembered choice: same language and label, then
 * same language (not forced unless the choice was), then same label.
 */
export function matchTrack(tracks, choice) {
  if (!Array.isArray(tracks) || !choice) return null;
  const sameLang = (t) => choice.language && t.language === choice.language;
  return tracks.find((t) => sameLang(t) && t.label === choice.label)
    ?? tracks.find((t) => sameLang(t) && !!t.forced === !!choice.forced)
    ?? tracks.find((t) => sameLang(t))
    ?? (choice.label ? tracks.find((t) => t.label === choice.label) : null)
    ?? null;
}

/**
 * Apply a remembered preference to an item's tracks. Returns the selection to
 * request (`{ audio, subtitle }` track ids, subtitle may be "off") — only the
 * parts that differ from what the item would play anyway — or null.
 * preference: { audio?: TrackChoice, subtitle?: TrackChoice | "off" }
 */
export function selectionForPreference(tracks, preference) {
  if (!tracks || !isObj(preference)) return null;
  const selection = {};
  if (preference.audio && tracks.audio.length > 1) {
    const match = matchTrack(tracks.audio, preference.audio);
    if (match && match.id !== tracks.selected.audio) selection.audio = match.id;
  }
  if (preference.subtitle === SUBTITLES_OFF) {
    if (tracks.selected.subtitle) selection.subtitle = SUBTITLES_OFF;
  } else if (preference.subtitle && tracks.subtitles.length > 0) {
    const match = matchTrack(tracks.subtitles, preference.subtitle);
    // A Plex subtitle is only shown when it is burned in, so a match is
    // always requested, even when Plex already lists it as selected.
    if (match) selection.subtitle = match.id;
  }
  return Object.keys(selection).length > 0 ? selection : null;
}

/** The preference to remember after a person chose `selection` from `tracks`. */
export function preferenceFromSelection(tracks, selection, previous = null) {
  const next = isObj(previous) ? { ...previous } : {};
  if (selection?.audio) {
    const track = tracks?.audio?.find((t) => t.id === selection.audio);
    if (track) next.audio = trackChoiceFrom(track);
  }
  if (selection?.subtitle === SUBTITLES_OFF) next.subtitle = SUBTITLES_OFF;
  else if (selection?.subtitle) {
    const track = tracks?.subtitles?.find((t) => t.id === selection.subtitle);
    if (track) next.subtitle = trackChoiceFrom(track);
  }
  return next;
}

/**
 * Stream-mint query params for a Plex selection (tech doc §4.11):
 * `audioStreamID`, `subtitleStreamID` (0 = off). The backend selects the
 * streams on the part and burns a chosen subtitle into the picture.
 */
export function plexStreamParams(selection) {
  if (!isObj(selection)) return null;
  const params = {};
  if (isStr(selection.audio)) params.audioStreamID = selection.audio;
  if (selection.subtitle === SUBTITLES_OFF) params.subtitleStreamID = '0';
  else if (isStr(selection.subtitle)) params.subtitleStreamID = selection.subtitle;
  return Object.keys(params).length > 0 ? params : null;
}

/** Add stream-selection params to a stream URL (relative or absolute). */
export function withStreamParams(url, params) {
  if (!isStr(url) || !params) return url;
  const [base, hash = ''] = url.split('#');
  const [path, query = ''] = base.split('?');
  const search = new URLSearchParams(query);
  for (const [k, v] of Object.entries(params)) search.set(k, String(v));
  const qs = search.toString();
  return `${path}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`;
}

/** Parse stream-selection params from a mint request query. Invalid → null fields. */
export function parseStreamParams(query = {}) {
  const pick = (v) => (typeof v === 'string' && /^\d{1,12}$/.test(v) ? v : null);
  const audio = pick(query.audioStreamID);
  const subtitle = pick(query.subtitleStreamID);
  if (audio == null && subtitle == null) return null;
  return {
    ...(audio != null ? { audioStreamId: audio } : {}),
    ...(subtitle != null ? { subtitleStreamId: subtitle } : {}),
  };
}

function validateTrackList(list, prefix, errors) {
  if (!Array.isArray(list)) { errors.push(`${prefix}: array`); return; }
  list.forEach((t, i) => {
    if (!isObj(t) || !isStr(t.id) || !isStr(t.label)) errors.push(`${prefix}[${i}]: { id, label }`);
  });
}

// --- Show briefly (PLAY.8a/8b) -----------------------------------------------

function parseFlag(value) {
  if (value === undefined || value === null || value === '') return undefined;
  // `1` is the flag, not "one second".
  if (value === true || value === 1 || value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  if (value === false || value === '0' || value === 'false' || value === 'no' || value === 'off' || value === 0) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 1 ? n : undefined;
}

/**
 * Decide whether a start is "show briefly, then return" and for how long.
 *   brief=1 / brief=<seconds> → brief; brief=0 → not brief.
 *   Unstated: a camera started by a routine is brief (PLAY.8b/AC2); anything
 *   else is not.
 * @returns {{ brief: boolean, seconds: number|null }}
 */
export function resolveBriefMode({ brief, briefSeconds, origin = null, kind } = {}) {
  const flag = parseFlag(brief);
  const explicitSeconds = Number(briefSeconds);
  const seconds = Number.isFinite(explicitSeconds) && explicitSeconds > 0
    ? Math.min(BRIEF_MAX_SECONDS, explicitSeconds)
    : typeof flag === 'number' ? Math.min(BRIEF_MAX_SECONDS, flag) : null;
  if (flag === false) return { brief: false, seconds: null };
  if (flag !== undefined) return { brief: true, seconds: seconds ?? (kind === 'clip' ? null : BRIEF_DEFAULT_SECONDS) };
  if (kind === 'camera' && origin?.kind === 'routine') return { brief: true, seconds: seconds ?? BRIEF_DEFAULT_SECONDS };
  return { brief: false, seconds: null };
}

/** "Front door camera · from Doorbell" — what interrupted and where it came from. */
export function briefLabel({ title, originName }) {
  const what = isStr(title) ? title : 'Shown briefly';
  return isStr(originName) ? `${what} · from ${originName}` : what;
}

// --- Published state -----------------------------------------------------------

/**
 * Validate the optional player-feature blocks of `SessionSnapshot.controls`.
 * Each is null or absent when the feature is idle.
 */
export function validatePlayerFeatureControls(controls) {
  const errors = [];
  if (!isObj(controls)) return result(['controls: required object']);
  const { tracks, brief, musicBehind } = controls;
  if (tracks !== undefined && tracks !== null) {
    if (!isObj(tracks)) errors.push('controls.tracks: object or null');
    else {
      validateTrackList(tracks.audio, 'controls.tracks.audio', errors);
      validateTrackList(tracks.subtitles, 'controls.tracks.subtitles', errors);
      if (!isObj(tracks.selected)) errors.push('controls.tracks.selected: object');
      if (tracks.contentId != null && !isStr(tracks.contentId)) errors.push('controls.tracks.contentId: string');
    }
  }
  if (brief !== undefined && brief !== null) {
    if (!isObj(brief)) errors.push('controls.brief: object or null');
    else {
      if (!BRIEF_KINDS.includes(brief.kind)) errors.push(`controls.brief.kind: ${BRIEF_KINDS.join('|')}`);
      if (!isStr(brief.label)) errors.push('controls.brief.label: required');
      if (brief.endsAt !== null && !isStr(brief.endsAt)) errors.push('controls.brief.endsAt: ISO string or null');
      if (brief.remainingSeconds !== null && brief.remainingSeconds !== undefined
        && !(isNum(brief.remainingSeconds) && brief.remainingSeconds >= 0)) errors.push('controls.brief.remainingSeconds: non-negative number');
    }
  }
  if (musicBehind !== undefined && musicBehind !== null) {
    if (!isObj(musicBehind)) errors.push('controls.musicBehind: object or null');
    else {
      if (!isStr(musicBehind.contentId)) errors.push('controls.musicBehind.contentId: required');
      if (!MUSIC_BEHIND_STATES.includes(musicBehind.state)) errors.push(`controls.musicBehind.state: ${MUSIC_BEHIND_STATES.join('|')}`);
    }
  }
  return result(errors);
}

/** A photo slideshow is a queue whose current item is an image. */
export function isSlideshowItem(item) {
  const format = item?.format ?? item?.mediaType ?? null;
  return format === 'image';
}
