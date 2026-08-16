import { DaylightAPI } from '../../../lib/api.mjs';
import { playbackLog } from './playbackLogger.js';
import { getLogger } from '../../../lib/logging/Logger.js';

// Every answer this module gets back opens a Plex transcode session, and until
// now only the failures were recorded: on 2026-08-16 the player minted 495
// stream urls in four minutes and this file produced not one line, so the count
// had to be read out of Plex's own server log.
//
// The sequence is module-monotonic and shared by success and failure, so a run
// of either can be counted without lining two numberings up first. It survives
// remounts (the module does not reload) but resets on a page reload, which is
// the boundary that matters: a storm happens inside one page.
let _requestSeq = 0;
let _lastRequestStartedAt = null;

let _mintLogger = null;
const mintLogger = () => {
  if (!_mintLogger) _mintLogger = getLogger().child({ component: 'player-media-fetch' });
  return _mintLogger;
};

/**
 * Normalize a `stream:` contentId to a path-safe token.
 *
 * A stream: id may arrive as `stream:<raw url>` (from device load). The url's
 * slashes/colons break Express path routing, so encode it base64url here.
 * Already-encoded stream ids (no scheme) and non-stream ids pass through unchanged.
 *
 * @param {string} contentId
 * @returns {string}
 */
export function normalizeStreamContentId(contentId) {
  if (typeof contentId !== 'string' || !contentId.startsWith('stream:')) return contentId;
  const rest = contentId.slice('stream:'.length);
  if (!/^https?:\/\//i.test(rest)) return contentId; // already a token
  const b64 = btoa(unescape(encodeURIComponent(rest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `stream:${b64}`;
}

/**
 * Fetch media information from API
 * @param {Object} params - Parameters for fetching media
 * @param {string} params.contentId - Content identifier (compound ID, bare number, or bare name)
 * @param {string} params.plex - Legacy: Plex media key (normalized to contentId)
 * @param {string} params.media - Legacy: Media key (normalized to contentId)
 * @param {boolean} params.shuffle - Whether to shuffle
 * @param {string|number} params.maxVideoBitrate - Preferred maximum video bitrate param
 * @param {string|number} params.maxResolution - Preferred maximum resolution param
 * @param {string} params.session - Optional session identifier
 * @returns {Promise<Object>} Media information
 */
export async function fetchMediaInfo({ contentId, plex, media, shuffle, maxVideoBitrate, maxResolution, session, resume }) {
  // Normalize legacy params to contentId — backend handles all source resolution
  const rawContentId = contentId || (plex != null ? String(plex) : null) || media || null;
  if (!rawContentId) {
    // The third member of the family. Without it, no line at all could mean
    // "the player never asked" or "the player asked and we failed to record it",
    // and those call for opposite investigations.
    playbackLog('fetch-media-skipped', {
      reason: 'no-content-id',
      // Which of the three id spellings the caller tried, so a bad call site is
      // identifiable. No requestSeq: no request was made to number.
      gotContentId: contentId != null,
      gotPlex: plex != null,
      gotMedia: media != null,
      shuffle: !!shuffle
    }, { level: 'warn' });
    return null;
  }
  // stream: ids carry a raw url whose slashes/colons break the /play/<id> path —
  // encode to a path-safe base64url token before building any request URL.
  const effectiveContentId = normalizeStreamContentId(rawContentId);

  const buildUrl = (base, params = {}) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== false) searchParams.append(k, v);
    });
    const qs = searchParams.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const queryCommon = {};
  if (maxVideoBitrate !== undefined) queryCommon.maxVideoBitrate = maxVideoBitrate;
  if (maxResolution !== undefined) queryCommon.maxResolution = maxResolution;
  if (session !== undefined && session !== null) queryCommon.session = session;
  if (resume === false) queryCommon.resume = 'false';

  const requestSeq = ++_requestSeq;
  const startedAt = Date.now();
  // null means there was no previous request in this page's life — a different
  // fact from 0, which would mean the previous one was in the same millisecond.
  const msSinceLastRequest = _lastRequestStartedAt == null ? null : startedAt - _lastRequestStartedAt;
  _lastRequestStartedAt = startedAt;

  const requestFacts = {
    // The compound id as it goes on the wire. Its tail is the `ratingKey` the
    // backend records on `plex.stream.mint`, and `session` below is byte-for-byte
    // the value the backend reads off `?session=` — those two are what let a
    // frontend count and a backend count be joined.
    contentId: effectiveContentId,
    // null means the caller minted no client session at all. That is a finding
    // in its own right: the backend then generates a fresh random one per
    // request, which is how Plex came to log 495 distinct clients for one tablet.
    session: session ?? null,
    requestSeq,
    msSinceLastRequest,
    // A state, not a bare default: 'suppressed' is a deliberate resume=false on
    // the wire, 'server-default' is the caller leaving the decision to the backend.
    resume: resume === false ? 'suppressed' : 'server-default',
    shuffle: !!shuffle
  };

  // Budgeted at 20/min to match `plex.stream.mint`'s budget on the backend, so a
  // frontend count and a backend count drop at the same rate and can be compared
  // without correcting for two different ceilings. Its siblings below are not
  // budgeted because they are rare by nature; successes are what stormed.
  //
  // Note when reading the `.aggregated` roll-up: the framework SUMS numeric
  // fields, so `contentId`/`session` carry the useful per-value histogram while
  // the summed `requestSeq` and `msSinceLastRequest` mean nothing there.
  const logSuccess = (playResponse) => {
    mintLogger().sampled('playback.fetch-media-succeeded', {
      ...requestFacts,
      // A completed request that returned nothing still cost a backend call, so
      // it is counted here rather than dropped — flagged, not hidden.
      hasResponse: !!playResponse
    }, { maxPerMinute: 20, aggregate: true });
  };

  try {
    if (shuffle) {
      const url = buildUrl(`api/v1/play/${effectiveContentId}/shuffle`, queryCommon);
      const playResponse = await DaylightAPI(url);
      logSuccess(playResponse);
      if (playResponse) {
        return { ...playResponse, assetId: playResponse.assetId || playResponse.id };
      }
      return null;
    }

    const url = buildUrl(`api/v1/play/${effectiveContentId}`, queryCommon);
    const playResponse = await DaylightAPI(url);
    logSuccess(playResponse);
    // Map resume_position → seconds so VideoPlayer/AudioPlayer can seek on load
    if (playResponse.resume_position !== undefined && playResponse.seconds === undefined) {
      playResponse.seconds = playResponse.resume_position;
    }
    return { ...playResponse, assetId: playResponse.assetId || playResponse.id };
  } catch (error) {
    playbackLog('fetch-media-failed', {
      ...requestFacts,
      error: error?.message,
      httpStatus: error?.message?.match(/^HTTP (\d+)/)?.[1],
    }, { level: 'error' });
    throw error; // re-throw so caller still handles it
  }
}
