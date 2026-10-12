import React, { useEffect, useLayoutEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';
import {
  GLIDE_MS, SEEK_FWD_EPS, normalizeProgress, classifyChange, buildFillKeyframes, parseScaleX,
} from './progressModel.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'progress-bar' });
  return _logger;
}

const prefersReducedMotion = () => {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * Media progress bar. With timing data and the Web Animations API, one
 * persistent fill element runs one Animation: linear to the end on the
 * compositor clock, paused/played in place on pause and stalls, and rebuilt
 * only on a real discontinuity (seek, rate, duration) — gliding from where the
 * fill VISIBLY is, so it never jump-cuts. Otherwise it falls back to a
 * CSS-transitioned scaleX. See progressModel.js.
 */
export function ProgressBar({ percent, onClick, durationSeconds = 0, offsetSeconds = null, paused = false, playbackRate = 1 }) {
  const model = normalizeProgress({ durationSeconds, offsetSeconds, percent });
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  const fillRef = useRef(null);
  const animRef = useRef(null);   // { animation, kind: 'run'|'hold' }
  const stateRef = useRef(null);  // last anchored { offset, running, rate, duration }
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const animated = canAnimate && model.mode === 'timed';

  useLayoutEffect(() => {
    const el = fillRef.current;
    if (!el || !animated) {
      animRef.current?.animation.cancel();
      animRef.current = null;
      stateRef.current = null;
      return;
    }
    const next = { offset: model.offset, running: !paused, rate, duration: model.duration };
    const reason = classifyChange(stateRef.current, next);
    if (!reason) { stateRef.current.offset = next.offset; return; }

    const current = animRef.current;
    const visible = parseScaleX(window.getComputedStyle(el).transform);
    if (current && reason === 'pause') {
      current.animation.pause();
      stateRef.current = next;
      return;
    }
    if (current && reason === 'resume' && current.kind === 'run'
      && visible !== null && Math.abs(visible - model.fraction) * model.duration <= SEEK_FWD_EPS) {
      current.animation.play();
      stateRef.current = next;
      return;
    }

    const glideMs = reason === 'initial' || prefersReducedMotion() ? 0 : GLIDE_MS;
    const { keyframes, timing, kind } = buildFillKeyframes({
      fromFraction: visible ?? model.fraction, fraction: model.fraction, duration: model.duration,
      rate, glideMs, running: next.running,
    });
    current?.animation.cancel();
    animRef.current = { animation: el.animate(keyframes, timing), kind };
    stateRef.current = next;
    logger().sampled('progress.reanchor', {
      reason, from: visible, to: Math.round(model.fraction * 1000) / 1000, kind, glide: glideMs > 0,
    }, { maxPerMinute: 20, aggregate: true });
  }, [animated, model.offset, model.duration, model.fraction, paused, rate]);

  useEffect(() => () => { animRef.current?.animation.cancel(); }, []);

  // Before the first animation frame (and in the fallback) the inline
  // transform is what shows; once an Animation runs it overrides it.
  const style = { transform: `scaleX(${model.fraction})` };
  return (
    <div className="progress-bar" onClick={onClick} style={onClick ? { cursor: 'pointer' } : {}}>
      <div ref={fillRef} className={animated ? 'progress' : 'progress progress--stepped'} style={style} />
    </div>
  );
}

ProgressBar.propTypes = {
  /** Fallback fill (0–100) when duration/offset are not usable. */
  percent: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  onClick: PropTypes.func,
  /** Total media duration (s). With a finite offset, enables the animated fill. */
  durationSeconds: PropTypes.number,
  /** Current playhead (s); clamped to [0, durationSeconds]. */
  offsetSeconds: PropTypes.number,
  /** Paused or stalled — freezes the fill in place. */
  paused: PropTypes.bool,
  /** Playback rate; the fill tracks fast/slow play. */
  playbackRate: PropTypes.number,
};
