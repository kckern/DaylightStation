// frontend/src/modules/Player/components/progressModel.js
/**
 * Pure model behind the Player progress bar: validates playback data, names
 * what changed between renders, and builds Web Animations keyframes that glide
 * from where the fill VISIBLY is rather than cutting to the new spot.
 */
export const SEEK_BACK_EPS = 0.25; // s: offset moving backward beyond this ⇒ a seek
export const SEEK_FWD_EPS = 1.5;   // s: offset jumping forward beyond this ⇒ a seek
export const GLIDE_MS = 250;       // ms: ease-out glide on a discontinuity
const DURATION_EPS = 0.5;          // s: duration change worth re-anchoring for
const GLIDE_MIN = 0.002;           // fraction: closer than this is not worth a glide

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const round = (v) => Math.round(v * 1e6) / 1e6;
const scale = (f) => `scaleX(${round(clamp01(f))})`;

export function normalizeProgress({ durationSeconds, offsetSeconds, percent } = {}) {
  if (Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(offsetSeconds)) {
    const offset = Math.min(durationSeconds, Math.max(0, offsetSeconds));
    return { mode: 'timed', duration: durationSeconds, offset, fraction: offset / durationSeconds };
  }
  const pct = Number(percent);
  if (percent !== null && percent !== undefined && percent !== '' && Number.isFinite(pct)) {
    return { mode: 'percent', duration: 0, offset: 0, fraction: clamp01(pct / 100) };
  }
  return { mode: 'none', duration: 0, offset: 0, fraction: 0 };
}

export function classifyChange(prev, next) {
  if (!prev || !(prev.duration > 0)) return 'initial';
  if (Math.abs(next.duration - prev.duration) > DURATION_EPS) return 'duration';
  if (next.rate !== prev.rate) return 'rate';
  if (next.running !== prev.running) return next.running ? 'resume' : 'pause';
  if (next.offset < prev.offset - SEEK_BACK_EPS || next.offset > prev.offset + SEEK_FWD_EPS) return 'seek';
  return null;
}

export function buildFillKeyframes({ fromFraction, fraction, duration, rate, glideMs, running }) {
  const r = rate > 0 ? rate : 1;
  const from = Number.isFinite(fromFraction) ? clamp01(fromFraction) : clamp01(fraction);
  const target = clamp01(fraction);
  const glide = glideMs > 0 && Math.abs(from - target) >= GLIDE_MIN ? glideMs : 0;

  if (!running) {
    return {
      kind: 'hold',
      keyframes: [{ transform: scale(from) }, { transform: scale(target) }],
      timing: { duration: glide, easing: 'ease-out', fill: 'forwards' },
    };
  }
  if (!glide) {
    return {
      kind: 'run',
      keyframes: [{ transform: scale(target) }, { transform: 'scaleX(1)' }],
      timing: { duration: ((duration * (1 - target)) / r) * 1000, easing: 'linear', fill: 'forwards' },
    };
  }
  // Playback keeps moving during the glide, so land where it will be.
  const landing = clamp01(target + (glide / 1000) * r / duration);
  const total = glide + ((duration * (1 - landing)) / r) * 1000;
  return {
    kind: 'run',
    keyframes: [
      { transform: scale(from), offset: 0, easing: 'ease-out' },
      { transform: scale(landing), offset: glide / total, easing: 'linear' },
      { transform: 'scaleX(1)', offset: 1 },
    ],
    timing: { duration: total, fill: 'forwards' },
  };
}

export function parseScaleX(transform) {
  if (typeof transform !== 'string' || !transform || transform === 'none') return null;
  const m = transform.match(/^scaleX\(([-\d.e]+)\)$/) || transform.match(/^matrix\(([-\d.e]+),/);
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
}

/**
 * The fraction a running `run` animation is showing right now, from its
 * currentTime alone (no style read). Valid through the glide too: the landing
 * keyframe is placed where linear playback from the anchor would be.
 */
export function predictRunFraction({ anchorFraction, currentTimeMs, rate, duration }) {
  if (!Number.isFinite(currentTimeMs) || !(duration > 0)) return null;
  return clamp01(anchorFraction + (currentTimeMs / 1000) * (rate > 0 ? rate : 1) / duration);
}
