import { DaylightAPI } from '../../../lib/api.mjs';
import { playbackLog } from './playbackLogger.js';

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
  if (!rawContentId) return null;
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

  try {
    if (shuffle) {
      const url = buildUrl(`api/v1/play/${effectiveContentId}/shuffle`, queryCommon);
      const playResponse = await DaylightAPI(url);
      if (playResponse) {
        return { ...playResponse, assetId: playResponse.assetId || playResponse.id };
      }
      return null;
    }

    const url = buildUrl(`api/v1/play/${effectiveContentId}`, queryCommon);
    const playResponse = await DaylightAPI(url);
    // Map resume_position → seconds so VideoPlayer/AudioPlayer can seek on load
    if (playResponse.resume_position !== undefined && playResponse.seconds === undefined) {
      playResponse.seconds = playResponse.resume_position;
    }
    return { ...playResponse, assetId: playResponse.assetId || playResponse.id };
  } catch (error) {
    playbackLog('fetch-media-failed', {
      contentId: effectiveContentId,
      shuffle: !!shuffle,
      error: error?.message,
      httpStatus: error?.message?.match(/^HTTP (\d+)/)?.[1],
    }, { level: 'error' });
    throw error; // re-throw so caller still handles it
  }
}
