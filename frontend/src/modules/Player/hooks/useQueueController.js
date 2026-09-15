import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

import { guid } from '../lib/helpers.js';
import { playbackLog } from '../lib/playbackLogger.js';
import { shouldEmitTrackChanged } from '../lib/shouldEmitTrackChanged.js';

// Module-level signature cache — survives React remounts for the same content.
// Prevents re-fetching queue when the player remounts during resilience recovery.
// Same remount-survival pattern as the recovery ledger (lib/recoveryLedger.js).
const _signatureCache = new Map();

const classes = ['default', 'focused', 'night', 'blackout'];

function withTimeout(promise, timeoutMs, kind, ctx) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`TIMEOUT ${kind} after ${timeoutMs}ms`);
      err.isTimeout = true;
      err.kind = kind;
      err.timeoutMs = timeoutMs;
      err.ctx = ctx;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function prewarmTransportFormat(url, fallbackFormat) {
  try {
    const pathname = new URL(url, globalThis.location?.origin ?? 'http://localhost').pathname.toLowerCase();
    if (pathname.endsWith('.m3u8')) return 'hls_video';
    if (pathname.endsWith('.mpd')) return 'dash_video';
  } catch {
    // A malformed redemption must retain its resolved descriptor, never guess DASH.
  }
  return ['video', 'hls_video', 'dash_video'].includes(fallbackFormat) ? fallbackFormat : null;
}

/**
 * Queue controller hook for managing playlist/queue playback
 * Handles queue initialization, advancement, and shader management
 */
export function useQueueController({ play, queue, clear, shuffle, onError, contentRef: contentRefArg, queueFetchTimeoutMs = null, onOwnerRevision = null }) {
  // Legacy aliases: multiple old names can map to the same canonical shader
  const shaderAliases = {
    dark: 'blackout',
    minimal: 'focused',
    regular: 'default',
    screensaver: 'focused' // screensaver removed, map to focused
  };
  const rawShader = play?.shader || queue?.shader || 'default';
  const resolvedShader = shaderAliases[rawShader] ?? rawShader;
  const [shader, setShaderState] = useState(classes.includes(resolvedShader) ? resolvedShader : 'default');
  const [volume, setVolume] = useState(play?.volume || queue?.volume || 1);
  // Trigger end-behavior queues must not loop — the marker would re-fire each cycle.
  const hasEndBehavior = !!(play?.endBehavior || queue?.endBehavior);
  const [isContinuous, setIsContinuous] = useState(
    !hasEndBehavior && (!!queue?.continuous || !!play?.continuous || false)
  );
  const [repeatMode, setRepeatMode] = useState(
    !hasEndBehavior && (!!queue?.continuous || !!play?.continuous) ? 'all' : 'off'
  );
  const [playbackRate, setPlaybackRate] = useState(
    play?.playbackRate || play?.playbackrate || queue?.playbackRate || queue?.playbackrate || 1
  );
  const [playQueue, setQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);
  const [isShuffle, setIsShuffle] = useState(!!play?.shuffle || !!queue?.shuffle || !!shuffle || false);
  const [shaderUserCycled, setShaderUserCycled] = useState(false);
  const [queueAudio, setQueueAudio] = useState(null);
  const [onDeck, setOnDeckState] = useState(null);
  const [onDeckFlashKey, setOnDeckFlashKey] = useState(0);
  const adoptedInputsRef = useRef(null);
  const queueInitEpochRef = useRef(0);

  // The Player is the owner of these actions.  Issue counters before React
  // queues its state update so a completed action burst remains visible even
  // when no bridge poll observes its intermediate renders.
  const issueOwnerRevision = useCallback((change) => {
    try { onOwnerRevision?.(change); } catch { /* owner provenance is advisory */ }
  }, [onOwnerRevision]);

  const pushOnDeck = useCallback((item, opts = {}) => {
    // This is an insertion boundary: caller guids are untrusted provenance and
    // must never alias an entry already owned by this queue.
    const ownedItem = { ...item, guid: guid() };
    issueOwnerRevision({ queue: true });
    setOnDeckState((prev) => {
      if (prev && opts.displaceToQueue) {
        // Prepend the displaced item to the queue head
        setQueue((q) => [prev, ...q]);
        setOriginalQueue((q) => [prev, ...q]);
      }
      return ownedItem;
    });
  }, [issueOwnerRevision]);

  const clearOnDeck = useCallback(() => {
    issueOwnerRevision({ queue: true });
    setOnDeckState(null);
  }, [issueOwnerRevision]);

  const flashOnDeck = useCallback(() => {
    setOnDeckFlashKey((k) => k + 1);
  }, []);

  // In-place head replacement for op: 'play-now' from an active Player.
  // Replaces currently playing; queue tail and on-deck are untouched.
  const playNow = useCallback((item) => {
    const ownedItem = { ...item, guid: guid() };
    issueOwnerRevision({ playback: true, queue: true });
    setQueue((prev) => prev.length > 0 ? [ownedItem, ...prev.slice(1)] : [ownedItem]);
    setOriginalQueue((prev) => prev.length > 0 ? [ownedItem, ...prev.slice(1)] : [ownedItem]);
  }, [issueOwnerRevision]);

  const adoptQueueSnapshot = useCallback((snapshot) => {
    // Revoke an already-running source resolve synchronously. Its effect may
    // not clean up when the caller's play/queue references stay unchanged.
    queueInitEpochRef.current += 1;
    adoptedInputsRef.current = { play, queue };
    const detachedItems = snapshot.queue.items.map((item) => ({
      ...item,
      guid: item.queueItemId,
    }));
    const byId = new Map(detachedItems.map((item) => [item.guid, item]));
    const order = snapshot.queue.executionOrder ?? [];
    const orderedVisits = order.map((id) => byId.get(id)).filter(Boolean);
    const onDeckIndex = orderedVisits[1]?.priority === 'upNext' ? 1 : -1;
    const nextOnDeck = onDeckIndex >= 0 ? orderedVisits[onDeckIndex] : null;
    const nextPlayQueue = onDeckIndex >= 0
      ? orderedVisits.filter((_item, index) => index !== onDeckIndex)
      : orderedVisits;
    issueOwnerRevision({ playback: true, queue: true });
    setOriginalQueue(detachedItems);
    setQueue(nextPlayQueue);
    setOnDeckState(nextOnDeck);
    setIsShuffle(snapshot.config.shuffle);
    setIsContinuous(snapshot.config.repeat === 'all');
    setRepeatMode(snapshot.config.repeat);
    setVolume(snapshot.config.volume / 100);
    setPlaybackRate(snapshot.config.playbackRate);
    setShaderUserCycled(true);
    setShaderState(snapshot.config.shader ?? 'default');
    return true;
  }, [issueOwnerRevision, play, queue]);

  // Single-item input (e.g. play: { contentId: 'watchlist:...' }) can resolve to a
  // multi-item playlist via the /api/v1/queue fetch. Reflect that here so consumers
  // dispatch queue-advance instead of clear() at end-of-item.
  const inputIsQueue = !!queue || (play && (play.playlist || play.queue)) || Array.isArray(play);
  const isQueue = inputIsQueue || playQueue.length > 1;
  const contentRef = contentRefArg
                  || play?.contentId || queue?.contentId
                  || play?.plex || queue?.plex
                  || play?.playlist || play?.queue
                  || queue?.playlist || queue?.queue || queue?.media
                  || null;

  const sourceSignatureRef = useRef(_signatureCache.get(contentRef) ?? null);

  // Latest playQueue length, mirrored into a ref so the init effect can read it
  // without taking playQueue as a dependency (which would re-fire the effect —
  // and re-fetch — whenever the queue drains to empty at end-of-playlist).
  const playQueueLengthRef = useRef(0);
  playQueueLengthRef.current = playQueue.length;

  const cycleThroughClasses = useCallback((upOrDownInt) => {
    upOrDownInt = parseInt(upOrDownInt) || 1;
    issueOwnerRevision({ queue: true });
    setShaderUserCycled(true);
    setShaderState((prevClass) => {
      const currentIndex = classes.indexOf(prevClass);
      const newIndex = (currentIndex + upOrDownInt + classes.length) % classes.length;
      const nextClass = classes[newIndex];
      playbackLog('shader-changed', { from: prevClass, to: nextClass });
      return nextClass;
    });
  }, [issueOwnerRevision]);

  const setShader = useCallback((nextShader) => {
    issueOwnerRevision({ queue: true });
    setShaderState(nextShader);
  }, [issueOwnerRevision]);

  useEffect(() => {
    if (adoptedInputsRef.current?.play === play && adoptedInputsRef.current?.queue === queue) {
      return undefined;
    }
    adoptedInputsRef.current = null;
    const signatureParts = [];

    if (contentRef) signatureParts.push(`ref:${contentRef}`);
    signatureParts.push(`shuffle:${isShuffle ? '1' : '0'}`);

    if (Array.isArray(play)) {
      const playArraySignature = play
        .map((item) => item?.guid || item?.media || item?.assetId || item?.id || item?.contentId || '')
        .join('|');
      signatureParts.push(`play:${play.length}:${playArraySignature}`);
    } else if (Array.isArray(queue)) {
      const queueArraySignature = queue
        .map((item) => item?.guid || item?.media || item?.assetId || item?.id || item?.contentId || '')
        .join('|');
      signatureParts.push(`queue:${queue.length}:${queueArraySignature}`);
    }

    const nextSignature = signatureParts.join(';');
    const previousSignature = sourceSignatureRef.current;

    // Skip the fetch only when the signature is unchanged AND this instance
    // still holds the resolved queue. The module-level _signatureCache survives
    // remounts (to break the resilience re-dispatch loop — see queueSignature
    // cache), but a genuine unmount/remount (e.g. navigating away from and back
    // to the music sidebar) resets playQueue to [] while the cached signature
    // still matches. Without the length guard the effect would early-return and
    // leave playQueue empty forever, stranding the player at "Music unavailable"
    // with no recovery. An empty queue has nothing to protect, so re-fetch.
    if (previousSignature === nextSignature && playQueueLengthRef.current > 0) {
      return;
    }

    let isCancelled = false;
    let isCompleted = false;
    const initEpoch = ++queueInitEpochRef.current;
    const isAuthorized = () => !isCancelled && queueInitEpochRef.current === initEpoch;
    sourceSignatureRef.current = nextSignature;
    // Cache write deferred to after successful API completion (see below)

    async function initQueue() {
      let newQueue = [];
      let fetchedAudio = null;
      // Only true when we actually executed the queue API call below.
      // Used to gate the empty-queue onError branch so it doesn't misfire
      // on caller-supplied empty arrays or inline-media fall-throughs.
      let fetchedFromApi = false;

      // Extract overrides that should apply to all generated items
      const sourceObj = (play && typeof play === 'object' && !Array.isArray(play)) ? play :
                       (queue && typeof queue === 'object' && !Array.isArray(queue)) ? queue : {};

      const itemOverrides = {};
      if (sourceObj.resume !== undefined) itemOverrides.resume = sourceObj.resume;
      if (sourceObj.seconds !== undefined) itemOverrides.seconds = sourceObj.seconds;
      if (sourceObj.maxVideoBitrate !== undefined) itemOverrides.maxVideoBitrate = sourceObj.maxVideoBitrate;
      if (sourceObj.maxResolution !== undefined) itemOverrides.maxResolution = sourceObj.maxResolution;

      const prewarmToken = sourceObj.prewarmToken || null;
      const prewarmContentId = sourceObj.prewarmContentId || null;

      if (Array.isArray(play)) {
        newQueue = play.map(item => ({ ...item, guid: guid() }));
      } else if (Array.isArray(queue)) {
        newQueue = queue.map(item => ({ ...item, guid: guid() }));
      } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        if (contentRef) {
          const shuffleParam = isShuffle ? '?shuffle=true' : '';
          const response = await withTimeout(
            DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`),
            queueFetchTimeoutMs,
            'fetch-timeout',
            { contentRef }
          );
          if (!isAuthorized()) return;
          fetchedFromApi = true;
          newQueue = response.items.map(item => ({ ...item, ...itemOverrides, guid: guid() }));
          fetchedAudio = response.audio || null;

          // Inject pre-warmed DASH URL into first matching queue item
          if (prewarmToken && prewarmContentId && newQueue.length > 0) {
            const firstItem = newQueue[0];
            if (firstItem.contentId === prewarmContentId) {
              try {
                const resp = await DaylightAPI(`api/v1/prewarm/${prewarmToken}`);
                if (resp?.url) {
                  firstItem.mediaUrl = resp.url;
                  const transportFormat = prewarmTransportFormat(resp.url, firstItem.format ?? firstItem.mediaType);
                  if (transportFormat) {
                    firstItem.format = transportFormat;
                    firstItem.mediaType = transportFormat;
                  }
                  playbackLog('prewarm-applied', {
                    contentId: prewarmContentId,
                    token: prewarmToken
                  }, { level: 'info' });
                }
              } catch (err) {
                playbackLog('prewarm-redeem-failed', {
                  contentId: prewarmContentId,
                  error: err?.message
                }, { level: 'warn' });
                // Fall through — normal /play API flow will handle it
              }
            } else {
              playbackLog('prewarm-mismatch', {
                expected: prewarmContentId,
                actual: firstItem.contentId
              }, { level: 'debug' });
            }
          }
        } else if (play?.media) {
          // Inline media object — no API resolution needed
          newQueue = [{ ...play, ...itemOverrides, guid: guid() }];
        }
      }
      // Validate queue items — reject garbage (e.g., string-spread objects with numeric keys)
      const validQueue = newQueue.filter(item =>
        item.contentId || item.play || item.media || item.mediaUrl || item.media_url
        || item.key || item.id || item.plex || item.assetId
      );
      if (!isAuthorized()) return;

      // Trigger end-behavior tail marker — append a synthetic side-effect item
      // so the player fires the configured behavior (tv-off, clear) when the
      // queue plays through. See backend sideEffectHandlers.mjs.
      if (sourceObj.endBehavior && validQueue.length > 0) {
        validQueue.push({
          id: `sideeffect:${sourceObj.endBehavior}:${guid()}`,
          guid: guid(),
          mediaType: 'trigger/side-effect',
          behavior: sourceObj.endBehavior,
          location: sourceObj.endLocation || null,
          deviceId: sourceObj.endDeviceId || null,
          duration: 0,
          hidden: true,
        });
      }

      // Only fire empty-queue on the API-fetch path. Caller-supplied empty
      // arrays and inline-media fall-throughs must remain silent no-ops to
      // preserve pre-existing consumer behavior.
      if (fetchedFromApi && validQueue.length === 0 && newQueue.length === 0 && contentRef) {
        playbackLog('queue-init-empty', { contentRef }, { level: 'error' });
        if (typeof onError === 'function' && isAuthorized()) {
          onError({ kind: 'empty-queue', contentRef });
        }
        if (isAuthorized() && clear) clear();
        return;
      }

      if (newQueue.length > 0 && validQueue.length === 0) {
        playbackLog('queue-init-invalid', {
          contentRef,
          itemCount: newQueue.length,
          sampleKeys: Object.keys(newQueue[0] || {}).slice(0, 5),
        }, { level: 'error' });
        if (typeof onError === 'function' && isAuthorized()) {
          onError({
            kind: 'invalid-queue',
            contentRef,
            itemCount: newQueue.length,
          });
        }
        if (isAuthorized() && clear) clear();
        return;
      }

      if (isAuthorized()) {
        // A committed resolve is an owner load transition, including a new
        // source on the same mounted Player. Issue before scheduling React
        // state so a later capture cannot miss it between polls.
        issueOwnerRevision({ playback: true, queue: true });
        if (contentRef) _signatureCache.set(contentRef, nextSignature);
        setQueue(validQueue);
        setOriginalQueue(validQueue);
        setQueueAudio(fetchedAudio);
        isCompleted = true;
      }
    }
    initQueue().catch((error) => {
      if (!isAuthorized()) return;
      if (error?.isTimeout) {
        playbackLog('queue-init-timeout', { contentRef, timeoutMs: error.timeoutMs }, { level: 'error' });
        if (typeof onError === 'function' && isAuthorized()) {
          onError({ kind: 'fetch-timeout', contentRef, timeoutMs: error.timeoutMs });
        }
        if (isAuthorized()) {
          sourceSignatureRef.current = previousSignature;
          if (contentRef) _signatureCache.set(contentRef, previousSignature);
        }
        return;
      }
      // Parse structured error from API response (format: "HTTP 404: Not Found - {json}")
      let apiError = null;
      const dashIdx = error?.message?.indexOf(' - ');
      if (dashIdx > -1) {
        try { apiError = JSON.parse(error.message.slice(dashIdx + 3)); } catch {}
      }
      playbackLog('queue-init-failed', {
        contentRef,
        error: error?.message,
        apiSource: apiError?.source,
        apiLocalId: apiError?.localId,
        apiDetail: apiError?.error,
        httpStatus: error?.message?.match(/^HTTP (\d+)/)?.[1],
      }, { level: 'error' });
      if (typeof onError === 'function' && isAuthorized()) {
        onError({
          kind: 'fetch-failed',
          contentRef,
          message: error?.message,
          httpStatus: error?.message?.match(/^HTTP (\d+)/)?.[1] || null,
          apiDetail: apiError?.error || null,
        });
      }
      if (isAuthorized()) {
        sourceSignatureRef.current = previousSignature;
        if (contentRef) _signatureCache.set(contentRef, previousSignature);
      }
    });

    return () => {
      const ownsEpoch = queueInitEpochRef.current === initEpoch;
      isCancelled = true;
      if (!isCompleted && ownsEpoch) {
        // Only clear cache if the API call didn't complete successfully.
        // If it did complete, the cache entry is valid and should persist.
        if (contentRef) _signatureCache.delete(contentRef);
        sourceSignatureRef.current = null;
      }
    };
    // core queue-init network-fetch effect; onError is an unmemoized parent prop —
    // adding it risks a fetch storm on unrelated parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, queue, isShuffle, contentRef, issueOwnerRevision]);

  const advance = useCallback((step = 1) => {
    issueOwnerRevision({ playback: true, queue: true });
    // On-deck has priority when advancing forward.
    if (step > 0 && onDeck) {
      setQueue((prev) => {
        const rest = prev.length > 0 ? prev.slice(1) : prev;
        return [onDeck, ...rest];
      });
      setOnDeckState(null);
      return;
    }
    setQueue((prevQueue) => {
      if (prevQueue.length > 1) {
        if (step < 0) {
          const currentIndex = originalQueue.findIndex(item => item.guid === prevQueue[0]?.guid);
          const backtrackIndex = (currentIndex + step + originalQueue.length) % originalQueue.length;
          const backtrackItem = originalQueue[backtrackIndex];
          playbackLog('queue-advance', {
            action: 'backtrack',
            step,
            fromPosition: currentIndex,
            toPosition: backtrackIndex,
            queueLength: prevQueue.length + 1
          });
          return [backtrackItem, ...prevQueue];
        } else {
          const currentIndex = isContinuous
            ? (prevQueue.length + step) % prevQueue.length
            : Math.min(Math.max(0, step), prevQueue.length - 1);
          if (isContinuous) {
            const rotatedQueue = [
              ...prevQueue.slice(currentIndex),
              ...prevQueue.slice(0, currentIndex),
            ];
            playbackLog('queue-advance', {
              action: 'rotate',
              step,
              queueLength: rotatedQueue.length,
              isContinuous: true
            });
            return rotatedQueue;
          }
          playbackLog('queue-advance', {
            action: 'slice',
            step,
            prevLength: prevQueue.length,
            newLength: prevQueue.length - currentIndex
          });
          return prevQueue.slice(currentIndex);
        }
      } else if (prevQueue.length === 1 && isContinuous && originalQueue.length > 0) {
        // A continuous plan loops even when it contains one entry. Player owns
        // the native replay boundary when the next visit resolves to this same
        // entry; this owner mutation only preserves the authoritative plan.
        playbackLog('queue-advance', {
          action: 'reset-continuous',
          originalQueueLength: originalQueue.length,
          reason: 'continuous mode loop'
        });
        return [...originalQueue];
      }
      playbackLog('queue-advance', {
        action: 'clear',
        prevLength: prevQueue.length,
        isContinuous,
        originalQueueLength: originalQueue.length,
        reason: prevQueue.length === 0 ? 'empty queue' : 'end of non-continuous playlist'
      });
      clear();
      return [];
    });
  }, [clear, isContinuous, originalQueue, onDeck, issueOwnerRevision]);

  const jumpTo = useCallback((targetContentId, seekSeconds) => {
    const id = String(targetContentId ?? '');
    if (!id) return false;
    const origIdx = originalQueue.findIndex((item) => {
      const cid = item?.contentId ?? item?.assetId ?? item?.id ?? item?.plex ?? item?.key;
      return String(cid) === id;
    });
    if (origIdx < 0) return false;
    issueOwnerRevision({ playback: true, queue: true });
    playbackLog('queue-advance', {
      action: 'jump-to-item',
      targetContentId: id,
      targetIndex: origIdx,
      seekSeconds: Number.isFinite(seekSeconds) ? seekSeconds : null,
      originalQueueLength: originalQueue.length,
    });
    const sliced = originalQueue.slice(origIdx);
    if (Number.isFinite(seekSeconds) && seekSeconds > 0 && sliced[0]) {
      sliced[0] = { ...sliced[0], seconds: seekSeconds };
    }
    setQueue(sliced);
    return true;
  }, [originalQueue, issueOwnerRevision]);

  const queuePosition = originalQueue.findIndex(item => item.guid === playQueue[0]?.guid);

  // Read-only owner capture: retain historical entries and the exact active
  // visit order separately, since legacy slicing/rotation can make them diverge.
  const queueSnapshot = useMemo(() => {
    const byId = new Map();
    for (const item of [...originalQueue, ...playQueue, ...(onDeck ? [onDeck] : [])]) {
      if (item?.guid && !byId.has(item.guid)) byId.set(item.guid, { ...item, queueItemId: item.guid,
        contentId: item.contentId ?? item.assetId ?? item.id ?? item.plex,
        format: item.format ?? 'video',
        priority: item.guid === onDeck?.guid ? 'upNext' : (item.priority ?? 'queue') });
    }
    const items = [...byId.values()].filter((item) => item.contentId);
    const order = [playQueue[0], ...(onDeck ? [onDeck] : []), ...playQueue.slice(1)]
      .map((item) => item?.guid).filter(Boolean);
    return { items, currentIndex: items.findIndex((item) => item.queueItemId === playQueue[0]?.guid),
      upNextCount: items.filter((item) => item.priority === 'upNext').length, executionOrder: order };
  }, [originalQueue, playQueue, onDeck]);

  // Trigger end-behavior side-effect dispatcher.
  // When the queue advances onto a virtual side-effect tail item, POST to the
  // backend (fire-and-forget) and advance past it. Skips media mount entirely.
  const firedMarkersRef = useRef(new Set());
  useEffect(() => {
    const head = playQueue[0];
    if (!head || head.mediaType !== 'trigger/side-effect') return;
    if (firedMarkersRef.current.has(head.id)) return;
    firedMarkersRef.current.add(head.id);

    DaylightAPI('api/v1/trigger/side-effect', {
      behavior: head.behavior,
      location: head.location,
      deviceId: head.deviceId,
      markerId: head.id,
    }).catch((err) => {
      playbackLog('side-effect-post-failed', {
        markerId: head.id,
        behavior: head.behavior,
        error: err?.message,
      }, { level: 'warn' });
    });

    playbackLog('side-effect-fired', {
      markerId: head.id,
      behavior: head.behavior,
      location: head.location,
      deviceId: head.deviceId,
    }, { level: 'info' });

    advance(1);
  }, [playQueue, advance]);

  const lastLoggedGuidRef = useRef(null);

  useEffect(() => {
    const currentItem = playQueue[0];
    if (!currentItem) return;
    if (currentItem.guid === lastLoggedGuidRef.current) return;
    if (!shouldEmitTrackChanged(currentItem)) return;

    lastLoggedGuidRef.current = currentItem.guid;
    playbackLog('queue-track-changed', {
      title: currentItem.title,
      guid: currentItem.guid,
      queueLength: playQueue.length,
      queuePosition: originalQueue.findIndex(item => item.guid === currentItem.guid)
    }, { level: 'info' });
  }, [playQueue, originalQueue]);

  return {
    classes,
    cycleThroughClasses,
    shader,
    shaderUserCycled,
    setShader,
    setShaderUserCycled,
    isQueue,
    isShuffle,
    volume,
    isContinuous,
    repeatMode,
    playQueue,
    playbackRate,
    setQueue,
    advance,
    jumpTo,
    queuePosition,
    queueAudio,
    // Stable identity for the whole queue (volume/rate/etc. persist across item swaps).
    // Null for inline-array inputs that have no canonical id.
    queueSessionId: contentRef || null,
    queueSnapshot,
    onDeck,
    onDeckFlashKey,
    pushOnDeck,
    clearOnDeck,
    flashOnDeck,
    playNow,
    adoptQueueSnapshot,
  };
}
