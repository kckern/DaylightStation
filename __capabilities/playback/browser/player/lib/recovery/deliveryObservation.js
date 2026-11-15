import { sameRecoveryTarget } from './recoveryIdentity.js';

const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const positive = value => nonnegative(value) > 0 ? value : null;
const difference = (end, start) => end !== null && start !== null && end >= start ? end - start : null;
const validTarget = target => target?.ownerId != null && target?.visitId != null
  && nonnegative(target.intentRevision) !== null && nonnegative(target.rendererGeneration) !== null;

function fragment(engine, event) {
  if (engine === 'dash') {
    const request = event?.request;
    return request?.type === 'MediaSegment' && ['video', 'audio'].includes(request.mediaType)
      ? { key: request, segment: request, kind: request.mediaType } : null;
  }
  if (engine === 'hls') {
    const frag = event?.frag;
    if (!frag || !Number.isFinite(frag.sn) || !['main', 'audio'].includes(frag.type)) return null;
    const segment = event.part || frag;
    // A new LoaderStats object is allocated per HLS load/part attempt. Unlike
    // frag.sn (or the mutable Fragment), it distinguishes retries of one segment.
    return { key: event.stats || segment.stats, segment, kind: frag.type === 'audio' ? 'audio' : 'video' };
  }
  return null;
}

function outcomeFor(engine, event) {
  if (engine === 'dash') {
    if (event.type === 'fragmentLoadingAbandoned') return 'aborted';
    if (event.type === 'fragmentLoadingCompleted') return event.error ? 'failed' : 'complete';
  }
  if (engine === 'hls') {
    if (event.type === 'hlsFragLoaded') return 'complete';
    if (event.type === 'hlsFragLoadEmergencyAborted') return 'aborted';
    if (event.type === 'hlsError') {
      if (event.details === 'aborted') return 'aborted';
      if (['fragLoadError', 'fragLoadTimeOut'].includes(event.details)) return 'failed';
    }
  }
  return null;
}

/**
 * Actual fragment terminal evidence only; clocks are browser-monotonic ms.
 * context = { target: RecoveryTarget, requestId, sequence,
 *   clock: { wallMs, monotonicMs } }. DASH dates are translated using this
 * fixed mapping; HLS stats already use performance.now(). No URL is copied.
 *
 * DeliveryObservation extends the shared shape with requestId,
 * firstByteDurationMs, transferDurationMs, requestDurationMs. Missing values
 * are null. A complete transport does not establish healthy playback.
 */
export function normalizeDeliveryObservation(engine, event, context = {}) {
  const info = fragment(engine, event);
  const outcome = event && outcomeFor(engine, event);
  if (!info || !outcome || !validTarget(context.target) || context.requestId == null) return null;
  const { segment, kind } = info;
  let requestStartMs = null;
  let firstByteMs = null;
  let endMs = null;
  let bytes = null;
  let retries = null;
  let status = null;
  if (engine === 'dash') {
    const dateToMs = date => {
      if (!(date instanceof Date) || !Number.isFinite(date.getTime())
        || !Number.isFinite(context.clock?.wallMs) || !Number.isFinite(context.clock?.monotonicMs)) return null;
      return nonnegative(date.getTime() - context.clock.wallMs + context.clock.monotonicMs);
    };
    requestStartMs = dateToMs(segment.startDate);
    // Installed dash.js HTTPLoader fabricates firstByteDate=startDate when no
    // progress event provided it. That is unknown latency, not measured zero.
    const first = dateToMs(segment.firstByteDate);
    firstByteMs = first !== null && requestStartMs !== null && first > requestStartMs ? first : null;
    // The installed runtime uses endDate, despite older type declarations.
    endMs = dateToMs(segment.endDate);
    bytes = nonnegative(event.response?.byteLength) ?? nonnegative(segment.bytesLoaded);
    retries = nonnegative(segment.retryAttempts);
    // FragmentLoadingCompleted supplies no HTTP status. Do not infer 200.
  } else {
    const stats = event.stats || segment.stats;
    requestStartMs = positive(stats?.loading?.start);
    firstByteMs = positive(stats?.loading?.first);
    endMs = positive(stats?.loading?.end);
    bytes = nonnegative(event.payload?.byteLength) ?? nonnegative(stats?.loaded);
    retries = nonnegative(stats?.retry);
    const code = event.networkDetails?.status ?? event.response?.code;
    status = Number.isInteger(code) && code >= 100 && code <= 599 ? code : null;
  }
  if (firstByteMs !== null && requestStartMs !== null && firstByteMs < requestStartMs) firstByteMs = null;
  if (endMs !== null && ((requestStartMs !== null && endMs < requestStartMs)
    || (firstByteMs !== null && endMs < firstByteMs))) endMs = null;
  return {
    target: Object.freeze({ ...context.target }), requestId: context.requestId, sequence: context.sequence,
    kind, mediaStartSeconds: nonnegative(engine === 'dash' ? segment.startTime : segment.start),
    mediaDurationSeconds: nonnegative(segment.duration), requestStartMs, firstByteMs, endMs,
    firstByteDurationMs: difference(firstByteMs, requestStartMs),
    transferDurationMs: difference(endMs, firstByteMs), requestDurationMs: difference(endMs, requestStartMs),
    bytes, status, outcome, retries,
  };
}

let nextBinding = 0;

/**
 * One actual engine/source binding. Call observe for start and terminal events;
 * dispose on engine/source teardown. Starts snapshot full owner identity. A
 * completion without that start (including events missed during DASH attach)
 * is unknown and discarded. No timers, probes, or policy side effects.
 *
 * newlyDeliveredMediaSeconds is the successful positive-byte interval union
 * delta per kind/target. Zero bytes and failed/aborted requests credit zero;
 * missing size/interval or exhausted coverage capacity credits null. It is
 * delivered media interval evidence, not decoded/presented/healthy media.
 */
export function createDeliveryObserver({ engine, identity, clock } = {}) {
  const bindingId = ++nextBinding;
  const bindingTarget = identity?.getTarget?.();
  let disposed = false;
  let sequence = 0;
  let pending = new WeakMap();
  let coverageTarget = null;
  let coverage = { video: [], audio: [] };
  const credit = observation => {
    if (observation.outcome !== 'complete' || observation.bytes === 0) return 0;
    if (observation.bytes === null || observation.mediaStartSeconds === null || observation.mediaDurationSeconds === null) return null;
    if (!sameRecoveryTarget(coverageTarget, observation.target)) {
      coverageTarget = observation.target;
      coverage = { video: [], audio: [] };
    }
    const intervals = coverage[observation.kind];
    if (intervals === null) return null;
    let start = observation.mediaStartSeconds;
    let end = start + observation.mediaDurationSeconds;
    let added = observation.mediaDurationSeconds;
    const merged = [];
    for (const [a, b] of intervals) {
      added -= Math.max(0, Math.min(end, b) - Math.max(start, a));
    }
    for (const [a, b] of intervals) {
      if (b < start || a > end) merged.push([a, b]);
      else { start = Math.min(start, a); end = Math.max(end, b); }
    }
    merged.push([start, end]);
    merged.sort((a, b) => a[0] - b[0]);
    // Normally sequential fragments form one interval. Bound pathological
    // seek histories without forgetting coverage and then double-crediting it.
    coverage[observation.kind] = merged.length <= 512 ? merged : null;
    return merged.length <= 512 ? Math.max(0, added) : null;
  };
  return {
    observe(event) {
      if (disposed || !event || !validTarget(bindingTarget)) return null;
      const info = fragment(engine, event);
      if (!info?.key || typeof info.key !== 'object') return null;
      const currentTarget = identity.getTarget();
      const starting = (engine === 'dash' && event.type === 'fragmentLoadingStarted')
        || (engine === 'hls' && event.type === 'hlsFragLoading');
      if (starting) {
        // Intent changes increment both tokens on a retained native node. A
        // renderer-only increment or new visit retires the outgoing source,
        // even in the window before React replaces its element.
        if (currentTarget.ownerId !== bindingTarget.ownerId || currentTarget.visitId !== bindingTarget.visitId
          || currentTarget.rendererGeneration - bindingTarget.rendererGeneration
            !== currentTarget.intentRevision - bindingTarget.intentRevision) return null;
        const requestSequence = ++sequence;
        pending.set(info.key, { target: Object.freeze({ ...currentTarget }), sequence: requestSequence,
          requestId: `delivery-${bindingId}-${requestSequence}`, clock });
        return null;
      }
      if (!outcomeFor(engine, event)) return null;
      const requestContext = pending.get(info.key);
      pending.delete(info.key);
      if (!requestContext || !sameRecoveryTarget(requestContext.target, currentTarget)) return null;
      const observation = normalizeDeliveryObservation(engine, event, requestContext);
      return observation ? { ...observation, newlyDeliveredMediaSeconds: credit(observation) } : null;
    },
    dispose() { disposed = true; pending = new WeakMap(); coverage = { video: [], audio: [] }; },
  };
}

// Stable bounded log keys keep full RecoveryTarget tokens inside the observer.
const logKey = value => {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16);
};
export function deliveryObservationSummary(observation) {
  return { owner: logKey(observation.target.ownerId), visit: logKey(observation.target.visitId),
    intentRevision: observation.target.intentRevision, rendererGeneration: observation.target.rendererGeneration,
    sequence: observation.sequence, kind: observation.kind, outcome: observation.outcome,
    requestDurationMs: observation.requestDurationMs, firstByteDurationMs: observation.firstByteDurationMs,
    transferDurationMs: observation.transferDurationMs, bytes: observation.bytes, status: observation.status,
    retries: observation.retries, newlyDeliveredMediaSeconds: observation.newlyDeliveredMediaSeconds };
}
