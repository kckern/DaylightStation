import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

import { guid } from '../lib/helpers.js';
import { playbackLog } from '../lib/playbackLogger.js';
import { shouldEmitTrackChanged } from '../lib/shouldEmitTrackChanged.js';

// Module-level signature cache — survives React remounts for the same content.
// Prevents re-fetching queue when the player remounts during resilience recovery.
// Follows the same pattern as _recoveryTracker in useMediaResilience.js.
const _signatureCache = new Map();

/**
 * Queue controller hook for managing playlist/queue playback
 * Handles queue initialization, advancement, and shader management
 */
export function useQueueController({ play, queue, clear, shuffle }) {
  const classes = ['default', 'focused', 'night', 'blackout'];
  // Legacy aliases: multiple old names can map to the same canonical shader
  const shaderAliases = {
    dark: 'blackout',
    minimal: 'focused',
    regular: 'default',
    screensaver: 'focused' // screensaver removed, map to focused
  };
  const rawShader = play?.shader || queue?.shader || 'default';
  const resolvedShader = shaderAliases[rawShader] ?? rawShader;
  const [shader, setShader] = useState(classes.includes(resolvedShader) ? resolvedShader : 'default');
  const [volume] = useState(play?.volume || queue?.volume || 1);
  const [isContinuous] = useState(!!queue?.continuous || !!play?.continuous || false);
  const [playQueue, setQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);
  const [isShuffle, setIsShuffle] = useState(!!play?.shuffle || !!queue?.shuffle || !!shuffle || false);
  const [shaderUserCycled, setShaderUserCycled] = useState(false);
  const [queueAudio, setQueueAudio] = useState(null);
  const [onDeck, setOnDeckState] = useState(null);
  const [onDeckFlashKey, setOnDeckFlashKey] = useState(0);

  const pushOnDeck = useCallback((item, opts = {}) => {
    setOnDeckState((prev) => {
      if (prev && opts.displaceToQueue) {
        // Prepend the displaced item to the queue head
        setQueue((q) => [prev, ...q]);
        setOriginalQueue((q) => [prev, ...q]);
      }
      return item;
    });
  }, []);

  const clearOnDeck = useCallback(() => {
    setOnDeckState(null);
  }, []);

  const flashOnDeck = useCallback(() => {
    setOnDeckFlashKey((k) => k + 1);
  }, []);

  // In-place head replacement for op: 'play-now' from an active Player.
  // Replaces currently playing; queue tail and on-deck are untouched.
  const playNow = useCallback((item) => {
    setQueue((prev) => prev.length > 0 ? [item, ...prev.slice(1)] : [item]);
    setOriginalQueue((prev) => prev.length > 0 ? [item, ...prev.slice(1)] : [item]);
  }, []);

  const isQueue = !!queue || (play && (play.playlist || play.queue)) || Array.isArray(play);
  const contentRef = play?.contentId || queue?.contentId
                  || play?.plex || queue?.plex
                  || play?.playlist || play?.queue
                  || queue?.playlist || queue?.queue || queue?.media
                  || null;

  const sourceSignatureRef = useRef(_signatureCache.get(contentRef) ?? null);

  const cycleThroughClasses = useCallback((upOrDownInt) => {
    upOrDownInt = parseInt(upOrDownInt) || 1;
    setShaderUserCycled(true);
    setShader((prevClass) => {
      const currentIndex = classes.indexOf(prevClass);
      const newIndex = (currentIndex + upOrDownInt + classes.length) % classes.length;
      const nextClass = classes[newIndex];
      playbackLog('shader-changed', { from: prevClass, to: nextClass });
      return nextClass;
    });
  }, []);

  useEffect(() => {
    const signatureParts = [];

    if (contentRef) signatureParts.push(`ref:${contentRef}`);
    signatureParts.push(`shuffle:${isShuffle ? '1' : '0'}`);

    if (Array.isArray(play)) {
      const playArraySignature = play
        .map((item) => item?.guid || item?.media || item?.assetId || item?.id || '')
        .join('|');
      signatureParts.push(`play:${play.length}:${playArraySignature}`);
    } else if (Array.isArray(queue)) {
      const queueArraySignature = queue
        .map((item) => item?.guid || item?.media || item?.assetId || item?.id || '')
        .join('|');
      signatureParts.push(`queue:${queue.length}:${queueArraySignature}`);
    }

    const nextSignature = signatureParts.join(';');
    const previousSignature = sourceSignatureRef.current;

    if (previousSignature === nextSignature) {
      return;
    }

    let isCancelled = false;
    let isCompleted = false;
    sourceSignatureRef.current = nextSignature;
    // Cache write deferred to after successful API completion (see below)

    async function initQueue() {
      let newQueue = [];
      let fetchedAudio = null;

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
          const response = await DaylightAPI(`api/v1/queue/${contentRef}${shuffleParam}`);
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
                  firstItem.format = 'dash_video';
                  firstItem.mediaType = 'dash_video';
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
      if (newQueue.length > 0 && validQueue.length === 0) {
        playbackLog('queue-init-invalid', {
          contentRef,
          itemCount: newQueue.length,
          sampleKeys: Object.keys(newQueue[0] || {}).slice(0, 5),
        }, { level: 'error' });
        if (!isCancelled && clear) clear();
        return;
      }

      if (!isCancelled) {
        if (contentRef) _signatureCache.set(contentRef, nextSignature);
        setQueue(validQueue);
        setOriginalQueue(validQueue);
        setQueueAudio(fetchedAudio);
        isCompleted = true;
      }
    }
    initQueue().catch((error) => {
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
      if (!isCancelled) {
        sourceSignatureRef.current = previousSignature;
        if (contentRef) _signatureCache.set(contentRef, previousSignature);
      }
    });

    return () => {
      isCancelled = true;
      if (!isCompleted) {
        // Only clear cache if the API call didn't complete successfully.
        // If it did complete, the cache entry is valid and should persist.
        if (contentRef) _signatureCache.delete(contentRef);
        sourceSignatureRef.current = null;
      }
    };
  }, [play, queue, isShuffle, contentRef]);

  const advance = useCallback((step = 1) => {
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
      } else if (prevQueue.length === 1 && isContinuous && originalQueue.length > 1) {
        // When last item finishes in continuous mode with multi-item original queue,
        // reset to full original queue to loop playback
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
  }, [clear, isContinuous, originalQueue, onDeck]);

  // Removed: Escape key auto-clear handler (audit #13) — queue destruction should be explicit

  const queuePosition = originalQueue.findIndex(item => item.guid === playQueue[0]?.guid);
  
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
    isQueue,
    volume,
    isContinuous,
    playQueue,
    playbackRate: play?.playbackRate || play?.playbackrate || queue?.playbackRate || queue?.playbackrate || 1,
    setQueue,
    advance,
    queuePosition,
    queueAudio,
    onDeck,
    onDeckFlashKey,
    pushOnDeck,
    clearOnDeck,
    flashOnDeck,
    playNow,
  };
}
