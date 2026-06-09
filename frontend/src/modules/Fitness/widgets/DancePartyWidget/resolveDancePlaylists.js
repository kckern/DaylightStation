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
  const rawVideo = dp.video_playlist_id;
  const videoPlaylistId = Number.isFinite(rawVideo) && rawVideo > 0 ? rawVideo : null;
  return {
    audioPlaylistId,
    videoPlaylistId,
    shuffle: dp.shuffle !== false,
    hasVideo: videoPlaylistId != null
  };
}

export default resolveDancePlaylists;
