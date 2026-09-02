// videoFpsSample.js — pure fps/drop arithmetic for the fitness profiler.
//
// Frames are divided by MEDIA time that elapsed (video.currentTime delta), not
// wall-clock, so a video that starts mid-window is not reported as slow.
//
// 2026-09-01: the profiler samples every 30s; a video that began 18.2s into the
// window reported 436 frames / 30s = 14.5 fps and tripped a false
// fitness.video_fps_degraded. 436 / 18.2s of media = 24.0 fps — the true rate.
//
// Media time is the right denominator for a window the video did not fill:
// paused, stalled, started late, or seeking backwards. It is the WRONG
// denominator for a forward seek, where media time jumps without frames being
// decoded to match — so that case is detected against wall clock and reported
// as no measurement rather than a fabricated low rate.

// Media time cannot outrun `wall clock × playbackRate` during real playback, so
// anything beyond it is a seek. The slack absorbs timer jitter and the fact that
// the two clocks are sampled a few instructions apart. It is deliberately larger
// than any seek that could matter: distorting a 30s window enough to cross the
// fps < 20 warning gate takes a jump of >6s, well clear of this.
export const SEEK_SLACK_SECONDS = 1;

/**
 * @param {{totalFrames:number, droppedFrames:number, currentTime:number, timestamp:number, playbackRate?:number}|null} prev
 * @param {{totalFrames:number, droppedFrames:number, currentTime:number, timestamp:number, playbackRate?:number}} now
 * @returns {{fps:number|null, dropRate:number|null, reset:boolean, seeked:boolean}}
 */
export function computeVideoFpsSample(prev, now) {
  if (!prev) return { fps: null, dropRate: null, reset: false, seeked: false };

  const framesDelta = now.totalFrames - prev.totalFrames;
  // Frame counter went backwards: the element was reloaded/reset. No sample.
  if (framesDelta < 0) return { fps: null, dropRate: null, reset: true, seeked: false };

  const playedSeconds = now.currentTime - prev.currentTime;
  const droppedDelta = now.droppedFrames - prev.droppedFrames;
  // Drops over THIS window, as a percentage — not a cumulative lifetime ratio.
  const dropRate = framesDelta > 0 ? Math.round((droppedDelta / framesDelta) * 1000) / 10 : 0;

  // Forward seek: `useSeekState.js` writes media.currentTime directly, so media
  // time can jump far past what wall clock allows. Dividing by it would invent a
  // low fps (720 frames across a 60s skip reads 12) and trip the warning gate.
  const wallSeconds = (now.timestamp - prev.timestamp) / 1000;
  const rate = Math.max(Number(now.playbackRate) || 1, Number(prev.playbackRate) || 1);
  if (playedSeconds > wallSeconds * rate + SEEK_SLACK_SECONDS) {
    return { fps: null, dropRate, reset: false, seeked: true };
  }

  // Under a second of media played (paused, stalled, seeking backwards): the
  // ratio is too noisy to be a rate. Report the drop count, not a fake fps.
  if (!(playedSeconds >= 1)) return { fps: null, dropRate, reset: false, seeked: false };

  return {
    fps: Math.round((framesDelta / playedSeconds) * 10) / 10,
    dropRate,
    reset: false,
    seeked: false
  };
}
