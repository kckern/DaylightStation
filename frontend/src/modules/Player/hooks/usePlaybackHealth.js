import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { playbackLog } from '../lib/playbackLogger.js';
import { describeWaitKey } from '../lib/waitKeyLabel.js';
import { getLogger } from '../../../lib/logging/Logger.js';

// Module-level lazy child logger (the hooks convention in CLAUDE.md): building
// it at import time races the logger's own configuration.
let _elementLogger;
const elementLogger = () => {
  if (!_elementLogger) _elementLogger = getLogger().child({ component: 'playback-health' });
  return _elementLogger;
};

/**
 * Which object `getMediaEl()` actually handed back.
 *
 * `useCommonMediaController.getMediaEl` returns the inner <video> when the
 * container has a shadow root, and otherwise returns the container itself —
 * which for dash playback is the <dash-video> wrapper, whose `readyState` is
 * not a number. Both cases used to print an identical `r=n/a`, and nothing
 * recorded which object had been read. Derived here from the node rather than
 * from the resolver, so `getMediaEl`'s signature is untouched.
 */
export const describeElementSource = (el) => {
  if (!el) return 'none';
  try {
    const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
    if (root && root !== el && root.host) return 'shadow';
  } catch (_) {
    // A detached or cross-realm node: fall through to 'container'.
  }
  return 'container';
};

/** Lowercased tagName, or null when there is no element to name. */
export const readElementTag = (el) => (el?.tagName ? String(el.tagName).toLowerCase() : null);

const DEFAULT_SIGNALS = Object.freeze({
  waiting: false,
  stalled: false,
  playing: false,
  paused: false,
  ended: false,
  buffering: false,
  readyState: null,
  networkState: null
});

const NO_FRAME_INFO = Object.freeze({
  supported: false,
  advancing: false,
  total: null,
  dropped: null,
  corrupted: null,
  lastSampleAt: null
});

const DEFAULT_PROGRESS_STATE = Object.freeze({
  progressToken: 0,
  lastProgressSource: null,
  lastProgressAt: null,
  lastProgressSeconds: null,
  details: null
});

const coerceMediaType = (value) => {
  if (!value) return 'unknown';
  const normalized = String(value).toLowerCase();
  if (normalized.includes('video')) return 'video';
  if (normalized.includes('audio')) return 'audio';
  return normalized;
};

const coercePlayerFlavor = (value, mediaType) => {
  if (!value && (mediaType === 'video' || mediaType === 'dash_video')) return 'html5-video';
  if (!value && mediaType === 'audio') return 'html5-audio';
  return value || 'generic';
};

const readFrameMetrics = (mediaEl) => {
  if (!mediaEl || typeof mediaEl !== 'object') {
    return { supported: false };
  }

  if (typeof mediaEl.getVideoPlaybackQuality === 'function') {
    try {
      const quality = mediaEl.getVideoPlaybackQuality();
      if (quality && Number.isFinite(quality.totalVideoFrames)) {
        return {
          supported: true,
          total: Number(quality.totalVideoFrames) || 0,
          dropped: Number(quality.droppedVideoFrames) || 0,
          corrupted: Number(quality.corruptedVideoFrames) || 0
        };
      }
    } catch (_) {
      // ignore read errors
    }
  }

  const vendorDecoded = mediaEl.webkitDecodedFrameCount ?? mediaEl.mozDecodedFrames ?? mediaEl.decodedFrameCount;
  if (Number.isFinite(vendorDecoded)) {
    const vendorDropped = mediaEl.webkitDroppedFrameCount ?? mediaEl.mozDroppedFrames ?? mediaEl.droppedFrameCount;
    return {
      supported: true,
      total: Number(vendorDecoded) || 0,
      dropped: Number(vendorDropped) || 0,
      corrupted: null
    };
  }

  return { supported: false };
};

export function usePlaybackHealth({
  seconds,
  getMediaEl,
  waitKey,
  // Content identity for the element-generation log. The key is logged raw
  // alongside its hash (see waitKeyLabel.js), but it names the PLAYER's wait
  // state, not the item — `mediaKey` is what maps a generation event back to
  // what was playing.
  mediaKey = null,
  mediaType: mediaTypeHint,
  playerFlavor: playerFlavorHint,
  epsilonSeconds = 0.25
}) {
  const mediaType = coerceMediaType(mediaTypeHint);
  const playerFlavor = coercePlayerFlavor(playerFlavorHint, mediaType);

  const [elementSignals, setElementSignals] = useState(DEFAULT_SIGNALS);
  const [frameInfo, setFrameInfo] = useState(NO_FRAME_INFO);
  const [progressSignal, setProgressSignal] = useState(DEFAULT_PROGRESS_STATE);
  const [bufferRunwayMs, setBufferRunwayMs] = useState(null);
  // Bumped whenever the underlying <video>/<audio> element is swapped out from
  // under us (softReinit bumps React's key → a brand-new element). The event
  // listeners and frame poll below capture the element at setup time, so they
  // MUST re-attach when this changes or they stay bound to the dead element —
  // the exact failure where the spinner sticks after a mid-playback recovery.
  const [elementGeneration, setElementGeneration] = useState(0);
  // Live "the clock is actually moving" signal, sampled directly off the media
  // element rather than the metrics bridge (which goes quiet during a stall).
  const [advancing, setAdvancing] = useState(false);

  const getMediaElRef = useRef(getMediaEl);
  useEffect(() => {
    getMediaElRef.current = getMediaEl;
  }, [getMediaEl]);

  const deltaThreshold = useMemo(
    () => Math.max(0.01, Math.min(0.05, epsilonSeconds / 2)),
    [epsilonSeconds]
  );

  const currentSecondsRef = useRef(seconds);
  useEffect(() => {
    currentSecondsRef.current = seconds;
  }, [seconds]);

  const lastSecondsRef = useRef(Number.isFinite(seconds) ? seconds : null);
  // Raw key AND its hash, as two distinct fields: the raw one carries the `:N`
  // nonce ordinal and can be grepped back to an item, the hash joins these lines
  // to everything logged before 2026-08-16.
  const waitKeyFields = useMemo(() => describeWaitKey(waitKey), [waitKey]);
  const logContextRef = useRef({
    ...waitKeyFields,
    mediaType,
    playerFlavor
  });

  useEffect(() => {
    logContextRef.current = {
      ...waitKeyFields,
      mediaType,
      playerFlavor
    };
  }, [waitKeyFields, mediaType, playerFlavor]);

  // Read by the 400ms poll below, which runs outside the render that knows the
  // current mediaKey.
  const mediaKeyRef = useRef(mediaKey);
  mediaKeyRef.current = mediaKey;

  // Distinguishes THIS hook instance from its replacement, and is the field that
  // makes a video remount greppable alongside AudioPlayer's `mounted`/`unmounted`
  // pair (which carries the same `instanceId`, minted the same way).
  const instanceIdRef = useRef(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = Math.random().toString(36).slice(2, 10);
  }

  useEffect(() => {
    setElementSignals(DEFAULT_SIGNALS);
    setFrameInfo(NO_FRAME_INFO);
    setProgressSignal(DEFAULT_PROGRESS_STATE);
    setBufferRunwayMs(null);
    lastSecondsRef.current = Number.isFinite(seconds) ? seconds : null;
  }, [waitKey]);

  const logHealthEvent = useCallback((event, details = {}, options = {}) => {
    const ctx = logContextRef.current;
    const currentSeconds = Number.isFinite(lastSecondsRef.current) ? lastSecondsRef.current : null;
    const { level: detailLevel, tags: detailTags, ...restDetails } = details || {};
    const resolvedOptions = typeof options === 'object' && options !== null ? options : {};
    const resolvedLevel = resolvedOptions.level || detailLevel || 'debug';

    playbackLog('playback-health', {
      event,
      ...ctx,
      seconds: currentSeconds,
      ...restDetails
    }, {
      ...resolvedOptions,
      level: resolvedLevel,
      tags: detailTags || resolvedOptions.tags,
      context: {
        ...ctx,
        ...(resolvedOptions.context || {})
      }
    });
  }, []);

  const recordProgress = useCallback((source, payload = {}) => {
    const currentSeconds = currentSecondsRef.current;
    setProgressSignal((prev) => ({
      progressToken: prev.progressToken + 1,
      lastProgressSource: source,
      lastProgressAt: Date.now(),
      lastProgressSeconds: Number.isFinite(payload.seconds)
        ? payload.seconds
        : (Number.isFinite(currentSeconds) ? currentSeconds : prev.lastProgressSeconds),
      details: payload.details || null
    }));
  }, []);

  const updateElementSignals = useCallback((patch) => {
    setElementSignals((prev) => {
      const next = {
        ...prev,
        ...patch
      };
      const changed = Object.keys(next).some((key) => next[key] !== prev[key]);
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (!Number.isFinite(seconds)) {
      return;
    }
    if (!Number.isFinite(lastSecondsRef.current)) {
      lastSecondsRef.current = seconds;
      return;
    }
    if (Math.abs(seconds - lastSecondsRef.current) >= deltaThreshold) {
      lastSecondsRef.current = seconds;
      recordProgress('clock', { seconds });
    }
  }, [seconds, deltaThreshold, recordProgress]);

  // Element-swap watcher + real-time advancement poll. This is intentionally
  // self-contained (reads getMediaEl() / currentTime directly) so it keeps
  // working when the metrics bridge stops emitting — which is precisely what
  // happens during a stall, the moment we most need to know the truth.
  // - When the live element identity changes, bump `elementGeneration` so the
  //   listener + frame-poll effects re-bind to the new element.
  // - `advancing` reflects whether currentTime actually moved forward between
  //   samples while not paused/ended; it is the authority for "is it really
  //   playing", overriding stuck `waiting`/`buffering` flags downstream.
  const attachedElRef = useRef(null);
  const advanceSampleRef = useRef(null);

  // The element-generation ledger deliberately lives OUTSIDE the effect below,
  // which clears `attachedElRef` every time `waitKey` changes. A new waitKey over
  // the same live element is not a new element, and counting it as one would
  // inflate the very number this event exists to measure.
  const elementLedgerRef = useRef({ el: null, generation: 0, atMs: null });
  const logElementGeneration = useCallback((el) => {
    const ledger = elementLedgerRef.current;
    const now = Date.now();
    const generation = ledger.generation + 1;
    elementLedgerRef.current = { el, generation, atMs: now };
    // Rate-limited because a remount storm is exactly the condition this event
    // reports, and 300 lines of it would drown the aggregate that IS the
    // diagnosis. `aggregate: true` keeps the skipped count and the per-tag
    // tallies, so the storm still shows its size (2026-08-16).
    elementLogger().sampled('media-element.generation', {
      instanceId: instanceIdRef.current,
      generation,
      mediaKey: mediaKeyRef.current,
      waitKey: logContextRef.current.waitKey,
      waitKeyHash: logContextRef.current.waitKeyHash,
      elTag: readElementTag(el),
      elSource: describeElementSource(el),
      msSincePreviousSwap: ledger.atMs == null ? null : now - ledger.atMs
    }, { maxPerMinute: 30, aggregate: true });
  }, []);

  useEffect(() => {
    attachedElRef.current = null;
    advanceSampleRef.current = null;
    const ADVANCE_POLL_MS = 400;
    const ADVANCE_EPSILON = 0.05;
    const poll = () => {
      const el = typeof getMediaElRef.current === 'function' ? getMediaElRef.current() : null;
      if (el !== attachedElRef.current) {
        attachedElRef.current = el;
        advanceSampleRef.current = null;
        setElementGeneration((gen) => gen + 1);
        if (el !== elementLedgerRef.current.el) {
          logElementGeneration(el);
        }
      }
      if (!el || !Number.isFinite(el.currentTime)) {
        advanceSampleRef.current = null;
        setAdvancing((cur) => (cur ? false : cur));
        return;
      }
      const t = Number(el.currentTime);
      const prev = advanceSampleRef.current;
      let isAdv = false;
      if (Number.isFinite(prev) && !el.paused && !el.ended) {
        isAdv = (t - prev) > ADVANCE_EPSILON;
      }
      advanceSampleRef.current = t;
      setAdvancing((cur) => (cur === isAdv ? cur : isAdv));
    };
    poll();
    const intervalId = setInterval(poll, ADVANCE_POLL_MS);
    return () => clearInterval(intervalId);
  }, [waitKey, logElementGeneration]);

  useEffect(() => {
    const mediaEl = typeof getMediaElRef.current === 'function' ? getMediaElRef.current() : null;
    if (!mediaEl) {
      setElementSignals(DEFAULT_SIGNALS);
      setBufferRunwayMs(null);
      return () => {};
    }

    let destroyed = false;
    const safeUpdate = (patch) => {
      if (!destroyed) {
        updateElementSignals(patch);
      }
    };

    const sampleCurrentTime = () => {
      if (!mediaEl || !Number.isFinite(mediaEl.currentTime)) {
        return null;
      }
      return Number(mediaEl.currentTime);
    };

    const safeSetBufferRunway = (value) => {
      if (!destroyed) {
        setBufferRunwayMs((prev) => (prev === value ? prev : value));
      }
    };

    const readReadyNetworkState = () => ({
      readyState: typeof mediaEl?.readyState === 'number' ? mediaEl.readyState : null,
      networkState: typeof mediaEl?.networkState === 'number' ? mediaEl.networkState : null
    });

    const readBufferRunwayMs = () => {
      if (!mediaEl || !mediaEl.buffered) return null;
      const current = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : null;
      if (!Number.isFinite(current)) return null;
      try {
        const ranges = mediaEl.buffered;
        const count = Number(ranges?.length) || 0;
        if (count === 0) return 0;
        for (let i = 0; i < count; i += 1) {
          const start = ranges.start(i);
          const end = ranges.end(i);
          if (Number.isFinite(start) && Number.isFinite(end) && current >= start && current <= end) {
            return Math.max(0, (end - current) * 1000);
          }
        }
        const lastEnd = Number.isFinite(ranges.end(count - 1)) ? ranges.end(count - 1) : null;
        if (Number.isFinite(lastEnd) && lastEnd > current) {
          return Math.max(0, (lastEnd - current) * 1000);
        }
      } catch (_) {
        return null;
      }
      return 0;
    };

    const updateBufferRunway = () => {
      safeSetBufferRunway(readBufferRunwayMs());
      safeUpdate(readReadyNetworkState());
    };

    const handleWaiting = () => safeUpdate({ waiting: true, buffering: true });
    const handlePlaying = () => {
      const sampledSeconds = sampleCurrentTime();
      safeUpdate({ playing: true, waiting: false, stalled: false, buffering: false, paused: false });
      recordProgress('event', { details: 'playing', seconds: sampledSeconds });
      logHealthEvent('media-playing', { currentTime: sampledSeconds }, { level: 'debug' });
      updateBufferRunway();
    };
    const handleStalled = () => safeUpdate({ stalled: true, waiting: false });
    const handlePause = () => safeUpdate({ paused: true, playing: false });
    const handleEnded = () => safeUpdate({ ended: true, playing: false, waiting: false });

    const handleStalledWithLog = () => {
      handleStalled();
      logHealthEvent('media-stalled', { currentTime: sampleCurrentTime() }, { level: 'warn' });
    };

    const bufferEvents = ['timeupdate', 'progress', 'waiting', 'playing'];

    mediaEl.addEventListener('waiting', handleWaiting);
    mediaEl.addEventListener('playing', handlePlaying);
    mediaEl.addEventListener('pause', handlePause);
    mediaEl.addEventListener('stalled', handleStalledWithLog);
    mediaEl.addEventListener('ended', handleEnded);
    bufferEvents.forEach((eventName) => mediaEl.addEventListener(eventName, updateBufferRunway));

    const haveFutureData = typeof HTMLMediaElement !== 'undefined'
      ? HTMLMediaElement.HAVE_FUTURE_DATA
      : 3;
    const initialWaiting = typeof mediaEl.readyState === 'number'
      ? mediaEl.readyState < haveFutureData
      : false;

    safeUpdate({
      paused: mediaEl.paused,
      playing: !mediaEl.paused && !mediaEl.ended,
      waiting: initialWaiting,
      stalled: false,
      ...readReadyNetworkState()
    });
    updateBufferRunway();

    return () => {
      destroyed = true;
      mediaEl.removeEventListener('waiting', handleWaiting);
      mediaEl.removeEventListener('playing', handlePlaying);
      mediaEl.removeEventListener('pause', handlePause);
      mediaEl.removeEventListener('stalled', handleStalledWithLog);
      mediaEl.removeEventListener('ended', handleEnded);
      bufferEvents.forEach((eventName) => mediaEl.removeEventListener(eventName, updateBufferRunway));
    };
  }, [waitKey, elementGeneration, recordProgress, updateElementSignals, logHealthEvent]);

  useEffect(() => {
    if (mediaType !== 'video' && mediaType !== 'dash_video') {
      setFrameInfo(NO_FRAME_INFO);
      return () => {};
    }

    const mediaEl = typeof getMediaElRef.current === 'function' ? getMediaElRef.current() : null;
    if (!mediaEl) {
      setFrameInfo(NO_FRAME_INFO);
      return () => {};
    }

    let lastTotal = null;
    let intervalId = null;
    const sampleInterval = playerFlavor === 'shaka' ? 350 : 500;

    const pollFrames = () => {
      const metrics = readFrameMetrics(mediaEl);
      if (!metrics.supported) {
        setFrameInfo(NO_FRAME_INFO);
        return;
      }
      const progressed = Number.isFinite(lastTotal) && Number(metrics.total) > lastTotal;
      setFrameInfo((prev) => {
        const next = {
          supported: true,
          advancing: progressed,
          total: metrics.total,
          dropped: metrics.dropped,
          corrupted: metrics.corrupted,
          lastSampleAt: Date.now()
        };
        const changed = prev.supported !== next.supported
          || prev.advancing !== next.advancing
          || prev.total !== next.total
          || prev.dropped !== next.dropped
          || prev.corrupted !== next.corrupted;
        return changed ? next : prev;
      });
      if (progressed) {
        recordProgress('frame', { details: metrics });
      }
      if (Number.isFinite(metrics.total)) {
        lastTotal = metrics.total;
      }
    };

    pollFrames();
    intervalId = setInterval(pollFrames, sampleInterval);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [mediaType, playerFlavor, waitKey, elementGeneration, recordProgress]);

  return useMemo(() => ({
    progressToken: progressSignal.progressToken,
    lastProgressSource: progressSignal.lastProgressSource,
    lastProgressAt: progressSignal.lastProgressAt,
    lastProgressSeconds: progressSignal.lastProgressSeconds,
    progressDetails: progressSignal.details,
    elementSignals,
    frameInfo,
    bufferRunwayMs,
    isWaiting: Boolean(elementSignals.waiting || elementSignals.buffering),
    isStalledEvent: Boolean(elementSignals.stalled),
    isFrameAdvancing: frameInfo.supported ? frameInfo.advancing : null,
    // True when the media clock is genuinely moving forward right now. The
    // authority for "it's playing" — downstream resilience uses it to suppress
    // a spinner that lingers on stale waiting/buffering flags.
    isAdvancing: advancing
  }), [elementSignals, frameInfo, progressSignal, bufferRunwayMs, advancing]);
}
