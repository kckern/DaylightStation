import { DaylightAPI } from '../../../lib/api.mjs';

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
export async function fetchMediaInfo({ contentId, plex, media, shuffle, maxVideoBitrate, maxResolution, session }) {
  // Normalize legacy params to contentId — backend handles all source resolution
  const effectiveContentId = contentId || (plex != null ? String(plex) : null) || media || null;
  if (!effectiveContentId) return null;

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
}
