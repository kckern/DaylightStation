import { useState, useEffect, useCallback, useRef } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { flattenQueueItems } from '../lib/api.js';
import { guid } from '../lib/helpers.js';
import { playbackLog } from '../lib/playbackLogger.js';

/**
 * Queue controller hook for managing playlist/queue playback
 * Handles queue initialization, advancement, and shader management
 */
export function useQueueController({ play, queue, clear }) {
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
  const [isShuffle, setIsShuffle] = useState(!!play?.shuffle || !!queue?.shuffle || false);
  const sourceSignatureRef = useRef(null);

  const cycleThroughClasses = useCallback((upOrDownInt) => {
    upOrDownInt = parseInt(upOrDownInt) || 1;
    setShader((prevClass) => {
      const currentIndex = classes.indexOf(prevClass);
      const newIndex = (currentIndex + upOrDownInt + classes.length) % classes.length;
      const nextClass = classes[newIndex];
      playbackLog('shader-changed', { from: prevClass, to: nextClass });
      return nextClass;
    });
  }, []);

  const isQueue = !!queue || (play && (play.playlist || play.queue)) || Array.isArray(play);
  const playlistKey = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
  const plexKey = queue?.plex || play?.plex;

  useEffect(() => {
    const signatureParts = [];

    if (playlistKey) signatureParts.push(`playlist:${playlistKey}`);
    if (plexKey) signatureParts.push(`plex:${plexKey}`);
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
    sourceSignatureRef.current = nextSignature;

    async function initQueue() {
      let newQueue = [];
      
      // Extract overrides that should apply to all generated items
      // This ensures that props like 'resume: false' or 'seconds: 0' from CompositePlayer
      // are propagated to items fetched from the API.
      const sourceObj = (play && typeof play === 'object' && !Array.isArray(play)) ? play : 
                       (queue && typeof queue === 'object' && !Array.isArray(queue)) ? queue : {};
      
      const itemOverrides = {};
      if (sourceObj.resume !== undefined) itemOverrides.resume = sourceObj.resume;
      if (sourceObj.seconds !== undefined) itemOverrides.seconds = sourceObj.seconds;
      if (sourceObj.maxVideoBitrate !== undefined) itemOverrides.maxVideoBitrate = sourceObj.maxVideoBitrate;
      if (sourceObj.maxResolution !== undefined) itemOverrides.maxResolution = sourceObj.maxResolution;

      if (Array.isArray(play)) {
        newQueue = play.map(item => ({ ...item, guid: guid() }));
      } else if (Array.isArray(queue)) {
        newQueue = queue.map(item => ({ ...item, guid: guid() }));
      } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        const queue_assetId = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
        if (queue_assetId) {
          const { items } = await DaylightAPI(`api/v1/item/folder/${queue_assetId}/playable${isShuffle ? ',shuffle' : ''}`);
          const flattened = await flattenQueueItems(items);
          newQueue = flattened.map(item => ({ ...item, ...item.play, ...itemOverrides, guid: guid() }));
        } else if (queue?.plex || play?.plex) {
          const plexId = queue?.plex || play?.plex;
          const { items } = await DaylightAPI(`api/v1/item/plex/${plexId}/playable${isShuffle ? ',shuffle' : ''}`);
          const flattened = await flattenQueueItems(items);
          newQueue = flattened.map(item => ({ ...item, ...item.play, ...itemOverrides, guid: guid() }));
        } else if (play?.media) {
          // Single media file - create queue from this item directly
          newQueue = [{ ...play, ...itemOverrides, guid: guid() }];
        }
      }
      if (!isCancelled) {
        setQueue(newQueue);
        setOriginalQueue(newQueue);
      }
    }
    initQueue().catch((error) => {
      playbackLog('queue-init-failed', {
        playlistKey,
        plexKey,
        error: error?.message
      }, { level: 'error' });
      if (!isCancelled) {
        sourceSignatureRef.current = previousSignature;
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [play, queue, isShuffle, playlistKey, plexKey]);

  const advance = useCallback((step = 1) => {
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
  }, [clear, isContinuous, originalQueue]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        clear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [clear]);

  const queuePosition = originalQueue.findIndex(item => item.guid === playQueue[0]?.guid);
  
  const lastLoggedGuidRef = useRef(null);

  useEffect(() => {
    const currentItem = playQueue[0];
    if (!currentItem) return;
    if (currentItem.guid === lastLoggedGuidRef.current) return;

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
    setShader,
    isQueue,
    volume,
    isContinuous,
    playQueue,
    playbackRate: play?.playbackRate || play?.playbackrate || queue?.playbackRate || queue?.playbackrate || 1,
    setQueue,
    advance,
    queuePosition
  };
}
