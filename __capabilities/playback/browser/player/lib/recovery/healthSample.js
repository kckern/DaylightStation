/**
 * Provider-neutral observations. Times use the browser's monotonic clock.
 *
 * @typedef {Object} HealthSample
 * @property {number} atMs
 * @property {number|null} currentTime
 * @property {number|null} playbackRate
 * @property {'play'|'pause'|'stop'} intended
 * @property {'startup'|'playing'|'seeking'|'replacing'|'ended'} phase
 * @property {boolean} visible
 * @property {number|null} contiguousRunwayMs
 * @property {boolean|null} clockAdvancing
 * @property {boolean|null} presentationAdvancing Submitted frames, not decoded frames or physical display proof.
 * @property {number|null} droppedFrameRatio Delta dropped / delta total, or unknown.
 * @property {boolean} fresh
 * @property {boolean} sourceRefused
 * @property {boolean} autoplayBlocked
 * @property {Object} observation Raw counters and optional recovery target, retained for interval comparisons only.
 */

export const HEALTH_SAMPLE_INTERVAL_MS = 500;
export const HEALTH_SAMPLE_EXPIRY_MS = 2000;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const counter = (value) => finite(value) && value >= 0 ? value : null;

/** Wall-clock runway from only the buffered range containing currentTime. */
export function contiguousRunwayMs({ ranges, currentTime, playbackRate } = {}) {
  if (!Array.isArray(ranges) || !finite(currentTime) || currentTime < 0
    || !finite(playbackRate) || playbackRate <= 0) return null;
  if (ranges.some((range) => !Array.isArray(range) || range.length !== 2
    || !finite(range[0]) || !finite(range[1]) || range[0] < 0 || range[1] < range[0])) return null;
  const containing = ranges.find(([start, end]) => currentTime >= start && currentTime <= end);
  return containing ? (containing[1] - currentTime) * 1000 / playbackRate : 0;
}

const targetFields = ['ownerId', 'visitId', 'intentRevision', 'rendererGeneration'];
const completeTarget = (target) => target == null || targetFields.every((key) => target[key] != null);
const sameTarget = (a, b) => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return targetFields.every((key) => a[key] === b[key]);
};
const eligible = (sample) => sample?.intended === 'play'
  && (sample.phase === 'playing' || sample.phase === 'startup');

/**
 * Normalize one observation against its predecessor. input.atMs defaults to
 * nowMs. Input counters: presentedFrames from native video frame callbacks;
 * totalFrames/droppedFrames from playback-quality APIs are diagnostics only.
 * Missing evidence stays null. A delayed/hidden interval cannot supply either
 * positive health credit or negative failure evidence.
 * @returns {HealthSample}
 */
export function normalizeHealthSample(input = {}, previous = null, nowMs) {
  const atMs = input.atMs ?? nowMs;
  const visible = input.visible === true;
  const currentTime = finite(input.currentTime) && input.currentTime >= 0 ? input.currentTime : null;
  const playbackRate = finite(input.playbackRate) && input.playbackRate > 0 ? input.playbackRate : null;
  const observation = {
    target: input.target ? { ...input.target } : null,
    presentedFrames: counter(input.presentedFrames),
    totalFrames: counter(input.totalFrames),
    droppedFrames: counter(input.droppedFrames)
  };
  const age = nowMs - atMs;
  const interval = previous ? atMs - previous.atMs : null;
  const fresh = visible && currentTime !== null && playbackRate !== null && completeTarget(observation.target)
    && finite(atMs) && finite(nowMs) && age >= 0 && age < HEALTH_SAMPLE_EXPIRY_MS
    && (!previous || (previous.visible && finite(interval) && interval > 0
      && interval < HEALTH_SAMPLE_EXPIRY_MS && sameTarget(observation.target, previous.observation?.target)));
  const sample = {
    atMs, currentTime, playbackRate,
    intended: input.intended ?? 'stop',
    phase: input.phase ?? 'startup',
    visible,
    contiguousRunwayMs: contiguousRunwayMs({ ranges: input.ranges, currentTime, playbackRate }),
    clockAdvancing: null,
    presentationAdvancing: null,
    droppedFrameRatio: null,
    fresh,
    sourceRefused: input.sourceRefused === true,
    autoplayBlocked: input.autoplayBlocked === true,
    observation
  };
  if (!fresh || !previous || !eligible(sample) || !eligible(previous)) return sample;
  if (finite(previous.currentTime)) sample.clockAdvancing = currentTime - previous.currentTime > 0.05;
  const prior = previous.observation;
  if (observation.presentedFrames !== null && prior?.presentedFrames != null
    && observation.presentedFrames >= prior.presentedFrames) {
    sample.presentationAdvancing = observation.presentedFrames > prior.presentedFrames;
  }
  const totalDelta = observation.totalFrames !== null && prior?.totalFrames != null
    ? observation.totalFrames - prior.totalFrames : null;
  const droppedDelta = observation.droppedFrames !== null && prior?.droppedFrames != null
    ? observation.droppedFrames - prior.droppedFrames : null;
  if (totalDelta > 0 && droppedDelta !== null && droppedDelta >= 0 && droppedDelta <= totalDelta) {
    sample.droppedFrameRatio = droppedDelta / totalDelta;
  }
  return sample;
}
