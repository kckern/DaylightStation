/**
 * Resolve the dance_party audio/video playlists from the dance_party config
 * block — the single source of truth (FitnessContext.dancePartyConfig).
 *
 * No silent fallbacks: a missing/empty block or missing ids resolve to null
 * and `configured: false`, so the widget can fail loudly instead of quietly
 * playing the wrong content.
 *
 * @param {object|null} dancePartyConfig - the `dance_party` block from fitness config
 */
export function resolveDancePlaylists(dancePartyConfig) {
  const dp = dancePartyConfig || null;
  // Coerce: YAML may author ids as strings (e.g. "99"). Number.isFinite on a
  // raw string is false, which would silently disable playback. Convert first.
  const toId = (raw) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const audioPlaylistId = toId(dp?.audio_playlist_id);
  const videoPlaylistId = toId(dp?.video_playlist_id);
  return {
    configured: dp != null,
    audioPlaylistId,
    videoPlaylistId,
    shuffle: dp?.shuffle !== false,
    hasVideo: videoPlaylistId != null,
    // Player shader for the video layer ('minimal' aliases to 'focused' in
    // Player.jsx). Default keeps the party video chrome-free.
    videoShader: typeof dp?.video_shader === 'string' && dp.video_shader ? dp.video_shader : 'focused'
  };
}

export default resolveDancePlaylists;
