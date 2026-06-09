/**
 * Resolve the dance_party audio/video playlists with fallbacks.
 * - audio: configured id, else first music_playlists entry, else null.
 * - video: configured id, else null (caller renders a CSS disco backdrop).
 * @param {object} fitnessConfig
 * @param {Array<{name:string,id:number}>} musicPlaylists
 */
export function resolveDancePlaylists(fitnessConfig, musicPlaylists = []) {
  const dp = fitnessConfig?.dance_party || {};
  const audioPlaylistId = dp.audio_playlist_id
    ?? (Array.isArray(musicPlaylists) && musicPlaylists[0]?.id) ?? null;
  // Coerce: YAML may author the id as a string (e.g. "99"). Number.isFinite on a
  // raw string is false, which would silently disable video. Convert first.
  const v = Number(dp.video_playlist_id);
  const videoPlaylistId = Number.isFinite(v) && v > 0 ? v : null;
  return {
    audioPlaylistId,
    videoPlaylistId,
    shuffle: dp.shuffle !== false,
    hasVideo: videoPlaylistId != null
  };
}

export default resolveDancePlaylists;
