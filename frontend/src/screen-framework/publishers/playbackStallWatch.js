import {
  STALL_THRESHOLD_MS,
  STALL_MIN_SAMPLES,
  isProgressExpected,
  positionAdvanced,
} from '@shared-contracts/media/playbackProgress.mjs';

/**
 * createPlaybackStallWatch — the kiosk's own opinion about whether it is stuck.
 *
 * The backend PlaybackStallDetector reads the same heartbeat and alerts a human.
 * This one exists because the backend cannot see what the browser saw: the
 * 300-event ring in Logger.js, which on 2026-08-16 was the only complete record
 * of the incident that survived. When this fires, the kiosk files a feedback
 * report carrying that ring, so the evidence is captured at the moment it exists
 * rather than reconstructed afterwards from a log Docker had already truncated.
 *
 * Both detectors import their rules from
 * `shared/contracts/media/playbackProgress.mjs`, so "stuck" means one thing.
 *
 * This is a pure state machine over successive snapshots — no timers, no DOM, no
 * network. It is fed from the session-state publisher, which already computes a
 * snapshot every 5 seconds, so it costs one comparison per heartbeat.
 *
 * @param {object} opts
 * @param {(detail: object) => void} opts.onStall - called ONCE per episode
 * @param {() => number} [opts.now] - clock seam; defaults to Date.now
 * @param {number} [opts.thresholdMs=STALL_THRESHOLD_MS]
 * @param {number} [opts.minSamples=STALL_MIN_SAMPLES]
 * @returns {{ observe: (snapshot: object|null) => void, reset: () => void }}
 */
export function createPlaybackStallWatch({
  onStall,
  now = () => Date.now(),
  thresholdMs = STALL_THRESHOLD_MS,
  minSamples = STALL_MIN_SAMPLES,
} = {}) {
  let window = null;

  const reset = () => { window = null; };

  const observe = (snapshot) => {
    // Anything but a playing, seekable, not-yet-finished item closes the window:
    // a paused or buffering player has every right to a motionless playhead.
    if (!isProgressExpected(snapshot)) {
      reset();
      return;
    }

    const at = now();
    const position = Number(snapshot.position);
    const contentKey = String(snapshot.currentItem?.contentId ?? snapshot.currentItem?.title ?? 'unknown');

    // A new item, or a clock that moved backwards, has no window to extend.
    if (!window || window.contentKey !== contentKey || at < window.lastAt) {
      window = { contentKey, position, sinceAt: at, lastAt: at, samples: 1, reported: false };
      return;
    }

    window.lastAt = at;
    window.samples += 1;

    if (positionAdvanced(window.position, position)) {
      window.position = position;
      window.sinceAt = at;
      window.reported = false;
      return;
    }

    const stalledForMs = at - window.sinceAt;
    if (window.reported || stalledForMs < thresholdMs || window.samples < minSamples) return;

    window.reported = true;
    try {
      onStall?.({
        contentId: snapshot.currentItem?.contentId ?? null,
        title: snapshot.currentItem?.title ?? null,
        position,
        duration: snapshot.currentItem?.duration ?? null,
        stalledForMs,
        samples: window.samples,
        state: snapshot.state,
      });
    } catch {
      // A failed report must never break the heartbeat that noticed the problem.
    }
  };

  return { observe, reset };
}

export default createPlaybackStallWatch;
