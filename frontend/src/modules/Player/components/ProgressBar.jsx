import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

/**
 * Progress bar component for displaying media playback progress.
 *
 * Smoothness: rather than repaint the fill width on every JS tick (which steps
 * at the update cadence and freezes when a tick runs late), the fill runs a
 * linear `scaleX` keyframe (`playerProgressFill`) over the media duration on the
 * compositor clock — buttery at display refresh with zero per-frame JS. JS only
 * re-anchors the animation on discontinuities (a seek jump, a pause/stall, or a
 * rate change), never on the steady progress ticks. When the duration is unknown
 * (live/immeasurable), it falls back to the classic width fill.
 *
 * Anchoring is self-contained here so callers just pass live playback state.
 */
const SEEK_BACK_EPS = 0.25;   // s: offset moving backward beyond this ⇒ a seek
const SEEK_FWD_EPS = 1.5;     // s: offset jumping forward beyond this ⇒ a seek

export function ProgressBar({ percent, onClick, durationSeconds = 0, offsetSeconds = null, paused = false, playbackRate = 1 }) {
  const useAnim = Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(offsetSeconds);
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;

  // anchorRef tracks the last committed seed plus the last observed offset (for
  // jump detection) without forcing re-renders on steady ticks.
  const anchorRef = useRef({ offset: 0, running: false, rate: 1, nonce: 0, lastOffset: 0 });
  const [seed, setSeed] = useState({ offset: 0, running: false, rate: 1, nonce: 0 });

  useEffect(() => {
    if (!useAnim) return;
    const prev = anchorRef.current;
    const running = !paused;
    const jumped = offsetSeconds < prev.lastOffset - SEEK_BACK_EPS
      || offsetSeconds > prev.lastOffset + SEEK_FWD_EPS;
    const changed = prev.nonce === 0 || jumped || running !== prev.running || rate !== prev.rate;
    if (changed) {
      const next = { offset: offsetSeconds, running, rate, nonce: prev.nonce + 1, lastOffset: offsetSeconds };
      anchorRef.current = next;
      setSeed({ offset: next.offset, running: next.running, rate: next.rate, nonce: next.nonce });
    } else {
      // Steady tick: keep tracking the offset for jump detection, no re-render.
      prev.lastOffset = offsetSeconds;
    }
  }, [useAnim, offsetSeconds, paused, rate]);

  const progressStyle = useAnim
    ? {
        animationName: 'playerProgressFill',
        animationTimingFunction: 'linear',
        animationDuration: `${durationSeconds / seed.rate}s`,
        animationDelay: `-${seed.offset / seed.rate}s`,
        animationPlayState: seed.running ? 'running' : 'paused',
        animationFillMode: 'both',
      }
    : { width: `${percent}%` };

  return (
    <div
      className="progress-bar"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : {}}
    >
      {/* key on the seed nonce so each anchor cleanly (re)starts the keyframe */}
      <div className="progress" key={useAnim ? seed.nonce : 'w'} style={progressStyle} />
    </div>
  );
}

ProgressBar.propTypes = {
  percent: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  onClick: PropTypes.func,
  /** Total media duration (s). When >0 and finite, enables the smooth keyframe fill. */
  durationSeconds: PropTypes.number,
  /** Current playhead (s). Used to anchor the keyframe on seeks. */
  offsetSeconds: PropTypes.number,
  /** Whether playback is halted (paused or stalled) — freezes the fill. */
  paused: PropTypes.bool,
  /** Playback rate; scales the keyframe duration so the fill tracks fast/slow play. */
  playbackRate: PropTypes.number
};
