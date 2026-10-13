/**
 * Should the in-workout music be paused because of the video?
 *
 * `videoPlayerPaused` mirrors the video element's paused flag (plus governance
 * locks, emergencies and module pause requests). It also reads true while the
 * video is loading, recovering, or waiting on a file the server refuses to read
 * — states nobody chose. `videoLoading` marks those, and the music plays
 * through them: on 2026-09-28 every video failure silenced the music too.
 */
export function musicShouldPause({ videoPlayerPaused, videoLoading, voiceMemoOpen, emergencyHold = false }) {
  if (voiceMemoOpen || emergencyHold) return true;
  return Boolean(videoPlayerPaused) && !videoLoading;
}
