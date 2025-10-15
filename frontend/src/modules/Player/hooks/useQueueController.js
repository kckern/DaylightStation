import { useState, useEffect, useCallback } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { flattenQueueItems } from '../lib/api.js';
import { guid } from '../lib/helpers.js';

/**
 * Queue controller hook for managing playlist/queue playback
 * Handles queue initialization, advancement, and shader management
 */
export function useQueueController({ play, queue, clear }) {
  const classes = ['regular', 'minimal', 'night', 'screensaver', 'dark'];
  const [shader, setShader] = useState(play?.shader || queue?.shader || classes[0]);
  const [volume] = useState(play?.volume || queue?.volume || 1);
  const [isContinuous] = useState(!!queue?.continuous || !!play?.continuous || false);
  const [playQueue, setQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);
  const [isShuffle, setIsShuffle] = useState(!!play?.shuffle || !!queue?.shuffle || false);

  const cycleThroughClasses = useCallback((upOrDownInt) => {
    upOrDownInt = parseInt(upOrDownInt) || 1;
    setShader((prevClass) => {
      const currentIndex = classes.indexOf(prevClass);
      const newIndex = (currentIndex + upOrDownInt + classes.length) % classes.length;
      return classes[newIndex];
    });
  }, []);

  const isQueue = !!queue || (play && (play.playlist || play.queue)) || Array.isArray(play);

  useEffect(() => {
    async function initQueue() {
      let newQueue = [];
      if (Array.isArray(play)) {
        newQueue = play.map(item => ({ ...item, guid: guid() }));
      } else if (Array.isArray(queue)) {
        newQueue = queue.map(item => ({ ...item, guid: guid() }));
      } else if ((play && typeof play === 'object') || (queue && typeof queue === 'object')) {
        const queue_media_key = play?.playlist || play?.queue || queue?.playlist || queue?.queue || queue?.media;
        if (queue_media_key) {
          const { items } = await DaylightAPI(`data/list/${queue_media_key}/playable${isShuffle ? ',shuffle' : ''}`);
          const flattened = await flattenQueueItems(items);
          newQueue = flattened.map(item => ({ ...item, ...item.play, guid: guid() }));
        } else if (queue?.plex) {
          const { items } = await DaylightAPI(`media/plex/list/${queue.plex}/playable${isShuffle ? ',shuffle' : ''}`);
          const flattened = await flattenQueueItems(items);
          newQueue = flattened.map(item => ({ ...item, ...item.play, guid: guid() }));
        }
      }
      setQueue(newQueue);
      setOriginalQueue(newQueue);
    }
    initQueue();
  }, [play, queue, isShuffle]);

  const advance = useCallback((step = 1) => {
    setQueue((prevQueue) => {
      if (prevQueue.length > 1) {
        if (step < 0) {
          const currentIndex = originalQueue.findIndex(item => item.guid === prevQueue[0]?.guid);
          const backtrackIndex = (currentIndex + step + originalQueue.length) % originalQueue.length;
          const backtrackItem = originalQueue[backtrackIndex];
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
            return rotatedQueue;
          }
          return prevQueue.slice(currentIndex);
        }
      }
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
