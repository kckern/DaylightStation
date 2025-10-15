import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import './Player.scss';
import moment from 'moment';
import {Scriptures,Hymns, Talk, Poetry} from './../ContentScroller/ContentScroller.jsx';
import { DaylightAPI } from '../../lib/api.mjs';
import 'dash-video-element';
import spinner from '../../assets/icons/spinner.svg';
import pause from '../../assets/icons/pause.svg';
import AppContainer from '../AppContainer/AppContainer.jsx';
import { useMediaKeyboardHandler } from '../../lib/Player/useMediaKeyboardHandler.js';


/*─────────────────────────────────────────────────────────────*/
/*  HOOKS AND UTILITIES                                       */
/*─────────────────────────────────────────────────────────────*/

function guid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function formatTime(seconds) {
  return moment
    .utc(seconds * 1000)
    .format(seconds >= 3600 ? 'HH:mm:ss' : 'mm:ss')
    .replace(/^0(\d+)/, '$1');
}

function getProgressPercent(progress, duration) {
  if (!duration) return 0;
  return ((progress / duration) * 100).toFixed(1);
}

function ProgressBar({ percent, onClick }) {
  return (
    <div
      className="progress-bar"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : {}}
    >
      <div className="progress" style={{ width: `${percent}%` }} />
    </div>
  );
}


/*─────────────────────────────────────────────────────────────*/
/*  useCommonMediaController                                  */
/*─────────────────────────────────────────────────────────────*/

function useCommonMediaController({
  start = 0,
  playbackRate = 1,
  onEnd = () => {},
  onClear = () => {},
  isAudio = false,
  isVideo = false,
  meta,
  type,
  onShaderLevelChange = () => {},
  shader,
  volume,
  cycleThroughClasses,
  playbackKeys,queuePosition,
  ignoreKeys,
  onProgress,
  onMediaRef,
  stallConfig = {}
}) {
  const media_key = meta.media_key || meta.key || meta.guid || meta.id  || meta.plex || meta.media_url;
  const containerRef = useRef(null);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  // Track active seek operations to display immediate feedback (spinner) during scrubs
  const [isSeeking, setIsSeeking] = useState(false);
  const lastLoggedTimeRef = useRef(0);
  const lastUpdatedTimeRef = useRef(0);
  // Stall detection refs (Phase 1 reintroduction - event driven, no tight polling)
  const stallStateRef = useRef({
    lastProgressTs: 0,
    stallCandidateTs: 0,
    softTimer: null,
    hardTimer: null,
    retryCount: 0,
    isStalled: false,
    recoveryPhase: 'none'
  });
  const [isStalled, setIsStalled] = useState(false);

  // Config with sane defaults
  const {
    enabled = true,
    softMs = 1200,
    hardMs = 8000,
    maxRetries = 1,
    mode = 'auto', // 'auto' | 'observe'
    debug = false,
    enablePhase2 = true,
    phase2SeekBackSeconds = 2
  } = stallConfig || {};

  const getMediaEl = () => {
    const mediaEl = containerRef.current?.shadowRoot?.querySelector('video') || containerRef.current;
    if (!mediaEl) return null;
    return mediaEl;
  };

  const isDash = meta.media_type === 'dash_video';

  const handleProgressClick = (event) => {
    if (!duration || !containerRef.current) return;
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    const rect = event.target.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    mediaEl.currentTime = (clickX / rect.width) * duration;
  };


  // Use centralized keyboard handler
  useMediaKeyboardHandler({
    getMediaEl,
    onEnd,
    onClear,
    cycleThroughClasses,
    playbackKeys,
    queuePosition,
    ignoreKeys,
    meta,
    type,
    media_key,
    setCurrentTime: setSeconds // Add the missing setCurrentTime parameter
  });

  // Helper: debug log
  const dlog = (...args) => { if (debug) console.log('[PlayerStall]', ...args); };

  // Clear timers utility
  const clearTimers = () => {
    const s = stallStateRef.current;
    if (s.softTimer) { clearTimeout(s.softTimer); s.softTimer = null; }
    if (s.hardTimer) { clearTimeout(s.hardTimer); s.hardTimer = null; }
  };

  const markProgress = () => {
    const s = stallStateRef.current;
    s.lastProgressTs = Date.now();
    if (s.isStalled) {
      dlog('Recovery: progress resumed');
      s.isStalled = false;
      s.stallCandidateTs = 0;
      clearTimers();
      setIsStalled(false);
      // Re-arm detection after a recovery so future stalls are caught
      scheduleStallDetection();
    }
    // Ensure a detection timer is armed after normal progress if none active
    if (!s.softTimer && !s.isStalled) {
      scheduleStallDetection();
    }
  };

  const scheduleStallDetection = () => {
    if (!enabled) return;
    const s = stallStateRef.current;
    if (s.softTimer || s.isStalled) return; // already monitoring
    const mediaEl = getMediaEl();
    if (!mediaEl) return;
    // Don't treat lack of progress while paused as stall
    if (mediaEl.paused) return;
    s.softTimer = setTimeout(() => {
      const now = Date.now();
      if (s.lastProgressTs === 0) return; // no baseline yet
      const diff = now - s.lastProgressTs;
      if (diff >= softMs) {
        // Soft stall confirmed
        s.isStalled = true;
        setIsStalled(true);
        dlog('Soft stall confirmed after', diff, 'ms');
        if (mode === 'auto') {
          // Start hard timer for escalation / light recovery
          s.hardTimer = setTimeout(() => {
            if (!s.isStalled) return;
            if (s.retryCount < maxRetries) {
              // Phase 1: light recovery
              s.retryCount += 1;
              s.recoveryPhase = 'light';
              dlog('Attempt light recovery, retry #', s.retryCount);
              try {
                const mediaEl = getMediaEl();
                if (mediaEl) {
                  const t = mediaEl.currentTime;
                  mediaEl.pause();
                  mediaEl.currentTime = Math.max(0, t - 0.001);
                  mediaEl.play().catch(()=>{});
                }
              } catch(_) {}
              clearTimers();
              s.softTimer = null;
              s.hardTimer = null;
              scheduleStallDetection();
            } else if (enablePhase2) {
              // Phase 2: reload element preserving approximate position
              const mediaEl = getMediaEl();
              if (mediaEl) {
                s.recoveryPhase = 'reload';
                dlog('Phase 2: reloading media element');
                const priorTime = mediaEl.currentTime || 0;
                try {
                  const src = mediaEl.getAttribute('src');
                  // Force reload sequence
                  mediaEl.pause();
                  mediaEl.removeAttribute('src');
                  mediaEl.load();
                  setTimeout(() => {
                    try {
                      if (src) mediaEl.setAttribute('src', src);
                      mediaEl.load();
                      mediaEl.addEventListener('loadedmetadata', function handleOnce() {
                        mediaEl.removeEventListener('loadedmetadata', handleOnce);
                        const target = Math.max(0, priorTime - phase2SeekBackSeconds);
                        if (!isNaN(target)) {
                          try { mediaEl.currentTime = target; } catch(_){}
                        }
                        mediaEl.play().catch(()=>{});
                      });
                    } catch(_) {}
                  }, 50);
                } catch(_) {}
                // After reload attempt, reschedule stall detection if still needed
                clearTimers();
                s.softTimer = null;
                s.hardTimer = null;
                // Keep isStalled true until progress resumes
                scheduleStallDetection();
              } else {
                dlog('Phase 2 requested but media element unavailable');
              }
            } else {
              dlog('Max light retries reached; Phase 2 disabled; leaving stalled state');
            }
          }, Math.max(0, hardMs - softMs));
        }
      }
    }, softMs);
  };

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (!mediaEl) return;

    const logProgress = async () => {
      const now = Date.now();
      lastUpdatedTimeRef.current = now;
      const diff = now - lastLoggedTimeRef.current;
      const pct = getProgressPercent(mediaEl.currentTime || 0, mediaEl.duration || 0);
      if (diff > 10000 && parseFloat(pct) > 0) {
        lastLoggedTimeRef.current = now;
        const secs = mediaEl.currentTime || 0;
        if (secs > 10) {
          const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
          await DaylightAPI(`media/log`, { title, type, media_key, seconds: secs, percent: pct });
        }
      }
    };

    const onTimeUpdate = () => {
      setSeconds(mediaEl.currentTime);
      logProgress();
      // mark progress for stall detection
      markProgress();
      if (onProgress) {
        onProgress({
          currentTime: mediaEl.currentTime || 0,
          duration: mediaEl.duration || 0,
          paused: mediaEl.paused,
          media: meta,
          percent: getProgressPercent(mediaEl.currentTime, mediaEl.duration),
          stalled: isStalled,
          retryCount: stallStateRef.current.retryCount,
          recoveryPhase: stallStateRef.current.recoveryPhase
        });
      }
    };
    const onDurationChange = () => {
      setDuration(mediaEl.duration);
    };
    const onEnded = () => {
      // Log 100% completion when content ends
      const title = meta.title + (meta.show ? ` (${meta.show} - ${meta.season})` : '');
      // Force one final log at completion
      lastLoggedTimeRef.current = 0; // reset so logProgress will pass time gate
      logProgress();
      onEnd();
    };
    const onLoadedMetadata = () => {
      const duration = mediaEl.duration || 0;
      
      // Simple volume mapping: volume parameter directly to decimal
      let processedVolume = parseFloat(volume || 100);
      if(processedVolume > 1) {
        processedVolume = processedVolume / 100; // Convert percentage to decimal
      }
      
      // Direct mapping - no complex volume curves
      const adjustedVolume = Math.min(1, Math.max(0, processedVolume));

      const isVideo = ['video', 'dash_video'].includes(mediaEl.tagName.toLowerCase());
      let startTime = (duration > (12 * 60) || isVideo) ? start : 0;
      
      // Reset to beginning if progress > 95% or less than 30 seconds remaining
      if (duration > 0 && startTime > 0) {
        const progressPercent = (startTime / duration) * 100;
        const secondsRemaining = duration - startTime;
        if (progressPercent > 95 || secondsRemaining < 30) {
          startTime = 0;
        }
      }
      
      mediaEl.dataset.key = media_key;
      if (Number.isFinite(startTime)) mediaEl.currentTime = startTime;
      mediaEl.autoplay = true;
      mediaEl.volume = adjustedVolume; // Set the volume level
      
      // Auto-loop videos that are under 20 seconds OR if marked as continuous
      if ((isVideo && duration < 20) || meta.continuous) {
        mediaEl.loop = true;
      }
      
      if (isVideo) {
      mediaEl.controls = false;
      mediaEl.addEventListener('play', () => {
        mediaEl.playbackRate = playbackRate;
      }, { once: false });
      mediaEl.addEventListener('seeked', () => {
        mediaEl.playbackRate = playbackRate;
      }, { once: false });
      } else {
      mediaEl.playbackRate = playbackRate;
      }
      // onReady removed (simplified pipeline)
      // Establish initial stall baseline & arm detection
      stallStateRef.current.lastProgressTs = Date.now();
      scheduleStallDetection();
    };

    mediaEl.addEventListener('timeupdate', onTimeUpdate);
    mediaEl.addEventListener('durationchange', onDurationChange);
    mediaEl.addEventListener('ended', onEnded);
    mediaEl.addEventListener('loadedmetadata', onLoadedMetadata);
    // Seeking lifecycle: show spinner immediately on seeking, hide on seeked/playing
    const handleSeeking = () => setIsSeeking(true);
    const clearSeeking = () => {
      // Allow a frame so stalled detection (if any) can assert before we hide
      requestAnimationFrame(() => setIsSeeking(false));
    };
    mediaEl.addEventListener('seeking', handleSeeking);
    mediaEl.addEventListener('seeked', clearSeeking);
    mediaEl.addEventListener('playing', clearSeeking);
    if (enabled) {
      const onWaiting = () => { dlog('waiting event'); scheduleStallDetection(); };
      const onStalled = () => { dlog('stalled event'); scheduleStallDetection(); };
      // Do not mark progress on 'playing' (it can fire while still stalled).
      // Only re-arm detection; real progress is tracked by 'timeupdate'.
      const onPlaying = () => { dlog('playing event'); scheduleStallDetection(); };
      mediaEl.addEventListener('waiting', onWaiting);
      mediaEl.addEventListener('stalled', onStalled);
      mediaEl.addEventListener('playing', onPlaying);
      return () => {
        mediaEl.removeEventListener('timeupdate', onTimeUpdate);
        mediaEl.removeEventListener('durationchange', onDurationChange);
        mediaEl.removeEventListener('ended', onEnded);
        mediaEl.removeEventListener('loadedmetadata', onLoadedMetadata);
        mediaEl.removeEventListener('waiting', onWaiting);
        mediaEl.removeEventListener('stalled', onStalled);
        mediaEl.removeEventListener('playing', onPlaying);
        mediaEl.removeEventListener('seeking', handleSeeking);
        mediaEl.removeEventListener('seeked', clearSeeking);
        mediaEl.removeEventListener('playing', clearSeeking);
      };
    }

    return () => {
      mediaEl.removeEventListener('timeupdate', onTimeUpdate);
      mediaEl.removeEventListener('durationchange', onDurationChange);
      mediaEl.removeEventListener('ended', onEnded);
      mediaEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      mediaEl.removeEventListener('seeking', handleSeeking);
      mediaEl.removeEventListener('seeked', clearSeeking);
      mediaEl.removeEventListener('playing', clearSeeking);
    };
  }, [onEnd, playbackRate, start, isVideo, meta.percent, meta.title, type, media_key, onProgress, enabled, softMs, hardMs, maxRetries, mode, isStalled]);

  useEffect(() => {
    const mediaEl = getMediaEl();
    if (mediaEl && onMediaRef) onMediaRef(mediaEl);
  }, [meta.media_key, onMediaRef]);

  return {
    containerRef,
    seconds,
  percent: getProgressPercent(seconds, duration),
    duration,
    isPaused: !seconds ? false : getMediaEl()?.paused || false,
    isDash,
    shader,
    isStalled,
    isSeeking,
    handleProgressClick
  };
}



export async function flattenQueueItems(items, level = 1) {
  const flattened = [];

  for (const item of items) {
    if (item.queue) {
      const shuffle = !!item.queue.shuffle || item.shuffle || false;
      if (item.queue.playlist || item.queue.queue) {
        const queueKey = item.queue.playlist ?? item.queue.queue;
        const { items: nestedItems } = await DaylightAPI(`data/list/${queueKey}/playable${shuffle ? ',shuffle' : ''}`);
        const nestedFlattened = await flattenQueueItems(nestedItems, level + 1);
        flattened.push(...nestedFlattened);
      } else if (item.queue.plex) {
        const { items: plexItems } = await DaylightAPI(`media/plex/list/${item.queue.plex}/playable${shuffle ? ',shuffle' : ''}`);
        const nestedFlattened = await flattenQueueItems(plexItems, level + 1);
        flattened.push(...nestedFlattened);
      }
    } else if (item.play) {
      flattened.push(item);
    } else {
      flattened.push(item);
    }
  }

  return flattened.filter(item => item?.active !== false);
}


/*─────────────────────────────────────────────────────────────*/
/*  useQueueController                                        */
/*─────────────────────────────────────────────────────────────*/

function useQueueController({ play, queue, clear }) {
 
  const classes = ['regular', 'minimal', 'night', 'screensaver', 'dark'];
  const [shader, setShader] = useState(play?.shader || queue?.shader || classes[0]);
  const [volume] = useState(play?.volume || queue?.volume || 1);
  const [isContinuous] = useState(!!queue?.continuous || !!play?.continuous || false);
  const [playQueue, setQueue] = useState([]);
  const [originalQueue, setOriginalQueue] = useState([]);
  const [isShuffle, setIsShuffle] = useState(!!play?.shuffle || !!queue?.shuffle || false);

  const cycleThroughClasses = (upOrDownInt) => {
    upOrDownInt = parseInt(upOrDownInt) || 1;
    setShader((prevClass) => {
      const currentIndex = classes.indexOf(prevClass);
      const newIndex = (currentIndex + upOrDownInt + classes.length) % classes.length;
      return classes[newIndex];
    });
  };

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
  }, [play, queue]);

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


/*─────────────────────────────────────────────────────────────*/
/*  MAIN PLAYER                                               */
/*─────────────────────────────────────────────────────────────*/

const Player = forwardRef(function Player(props, ref) {
  if (props.play?.overlay || props.queue?.overlay) {
    return <CompositePlayer {...props} />;
  }
  let { play, queue, clear, playbackrate, playbackKeys, playerType, ignoreKeys } = props || {};
  

  
  if(playbackrate && play) play['playbackRate'] = playbackrate; //Override playback rate if passed in via menu selection
  if(play?.playbackrate && !play?.playbackRate) play['playbackRate'] = play.playbackrate; //Convert lowercase to camelCase

  const {
    classes,
    cycleThroughClasses,
    shader: queueShader,
    setShader,
    isQueue,
    volume: queueVolume,
    queuePosition,
    playbackRate: queuePlaybackRate,
    playQueue,
    advance
  } = useQueueController({ play, queue, clear });

  const singlePlayerProps = (() => {
    if (isQueue && playQueue?.length > 0) {
      return { key: playQueue[0].guid, ...playQueue[0] };
    }
    if (play && !Array.isArray(play)) {
      return { ...play };
    }
    return null;
  })();

  // Get playback rate from the current item, falling back to queue/play level, then default
  const currentItemPlaybackRate = singlePlayerProps?.playbackRate || singlePlayerProps?.playbackrate;
  const effectivePlaybackRate = currentItemPlaybackRate || queuePlaybackRate;

  // Get volume from the current item, falling back to queue/play level, then default
  const currentItemVolume = singlePlayerProps?.volume;
  const effectiveVolume = currentItemVolume !== undefined ? currentItemVolume : queueVolume;

  // Get shader from the current item, falling back to queue/play level, then default
  const currentItemShader = singlePlayerProps?.shader;
  const effectiveShader = currentItemShader || queueShader;

  // Create appropriate advance function for single continuous items
  const singleAdvance = useCallback(() => {
    if (singlePlayerProps?.continuous) {
      // For continuous single items, check if native loop is already handling it
      const mediaEl = document.querySelector(`[data-key="${singlePlayerProps.media_key || singlePlayerProps.plex}"]`);
      if (mediaEl && !mediaEl.loop) {
        // If not using native loop, manually restart
        mediaEl.currentTime = 0;
        mediaEl.play();
      }
      // If using native loop (mediaEl.loop = true), the browser handles it automatically
    } else {
      clear();
    }
  }, [singlePlayerProps?.continuous, singlePlayerProps?.media_key, singlePlayerProps?.plex, clear]);

  const exposedMediaRef = useRef(null);

  // Compose onMediaRef so we keep existing external callback semantics.
  const handleMediaRef = useCallback((el) => {
    exposedMediaRef.current = el;
    if (props.onMediaRef) props.onMediaRef(el);
  }, [props.onMediaRef]);

  useImperativeHandle(ref, () => ({
    seek: (t) => { const el = exposedMediaRef.current; if (el && Number.isFinite(t)) { try { el.currentTime = t; } catch(_){} } },
    play: () => { const el = exposedMediaRef.current; try { el?.play(); } catch(_){} },
    pause: () => { const el = exposedMediaRef.current; try { el?.pause(); } catch(_){} },
    toggle: () => { const el = exposedMediaRef.current; if (el) { el.paused ? el.play() : el.pause(); } },
    getCurrentTime: () => exposedMediaRef.current?.currentTime || 0,
    getDuration: () => exposedMediaRef.current?.duration || 0,
    getMediaElement: () => exposedMediaRef.current,
  }), []);

  const playerProps = {
    advance: isQueue ? advance : singleAdvance,
    clear,
    shader: effectiveShader,
    volume: effectiveVolume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackRate: effectivePlaybackRate,
    playbackKeys,
    playerType,
    queuePosition,
    ignoreKeys,
    onProgress: props.onProgress,
    onMediaRef: handleMediaRef,
    // onReady removed
    stallConfig: props.stallConfig
  };
  if(singlePlayerProps?.key) delete singlePlayerProps.key;


  return singlePlayerProps ? (
    <SinglePlayer {...singlePlayerProps} {...playerProps} />
  ) : (
    <div className={`player ${effectiveShader} ${props.playerType || ''}`}>
      <LoadingOverlay />
    </div>
  );
});

Player.propTypes = {
  play: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  queue: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  clear: PropTypes.func,
  playbackrate: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  playbackKeys: PropTypes.arrayOf(PropTypes.string),
  playerType: PropTypes.string,
  ignoreKeys: PropTypes.bool,
  onProgress: PropTypes.func,
  onMediaRef: PropTypes.func,
  stallConfig: PropTypes.shape({
    enabled: PropTypes.bool,
    softMs: PropTypes.number,
    hardMs: PropTypes.number,
    maxRetries: PropTypes.number,
    mode: PropTypes.oneOf(['auto','observe']),
    debug: PropTypes.bool,
    enablePhase2: PropTypes.bool,
    phase2SeekBackSeconds: PropTypes.number
  })
};

export default Player;


/*─────────────────────────────────────────────────────────────*/
/*  Composite Player (Video Player with Audio Overlay)       */
/* Use cases: 
/* - workout video with audio playlist,
/* - ambient video with modular background music,
/* - sermon video with background hymns or talks
/* Required input variables:
/* - play or queue: object with media details
*/    

function CompositePlayer(props) {
  const { play, queue } = props;
  const isQueue = !!queue;

  const primaryProps = React.useMemo(() => {
    const baseProps = { ...props };
    const overlayKey = isQueue ? 'queue' : 'play';
    if (baseProps[overlayKey]) {
      baseProps[overlayKey] = { ...baseProps[overlayKey], overlay: undefined };
    }
    return baseProps;
  }, [props, isQueue]);

  const overlayProps = React.useMemo(() => ({ queue: { plex: isQueue ? queue.overlay : play.overlay, shuffle: 1 } }), [play, queue, isQueue]);
  const shader = primaryProps.primary?.shader || primaryProps.overlay?.shader || 'regular';
  return <div className={`player composite ${shader}`}>
    <Player playerType="overlay" {...overlayProps} />
    <Player playerType="primary" {...primaryProps} ignoreKeys={true} />
    </div>;

}

/*─────────────────────────────────────────────────────────────*/
/*  SINGLE PLAYER                                             */
/*─────────────────────────────────────────────────────────────*/
export function SinglePlayer(play) {
  const {
    plex,
    media,
    hymn,
    primary,
    scripture,
    talk,
    poem,
    rate,
    advance,
    open,
    clear,
    setShader,
    cycleThroughClasses,
    classes,
    playbackKeys,
    queuePosition,
    playerType,
    ignoreKeys,
    shuffle,
    continuous,
    //configs
    shader,
    volume,
    playbackRate,
    // newly forwarded callbacks from parent Player (were previously implicitly referenced)
    onProgress,
    onMediaRef,
  // onReady removed



  } = play || {};
  
  // Prepare common props for content scroller components
  const contentProps = {
    ...play,
    playbackKeys,
    ignoreKeys,
    queuePosition
  };

  if (!!scripture)    return <Scriptures {...contentProps} />;
  if (!!hymn)         return <Hymns {...contentProps} />;
  if (!!primary)      return <Hymns {...{ ...contentProps, hymn: primary, subfolder: "primary" }} />;
  if (!!talk)         return <Talk {...contentProps} />;
  if (!!poem)         return <Poetry {...contentProps} />;

  const [mediaInfo, setMediaInfo] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [goToApp, setGoToApp] = useState(false);


  const fetchVideoInfo = useCallback(async () => {
    setIsReady(false);
    if (!!plex) {
      const bitrate = play.maxVideoBitrate ? (shuffle ? `&maxVideoBitrate=${encodeURIComponent(play.maxVideoBitrate)}` : `?maxVideoBitrate=${encodeURIComponent(play.maxVideoBitrate)}`) : '';
      const url = shuffle ? `media/plex/info/${plex}/shuffle${bitrate}` : `media/plex/info/${plex}${bitrate}`;
      const infoResponse = await DaylightAPI(url);
      setMediaInfo({ ...infoResponse, media_key: infoResponse.plex, continuous });
      setIsReady(true);
    } else if (!!media) {
      const url = shuffle ? `media/info/${media}?shuffle=${shuffle}` : `media/info/${media}`;
      const infoResponse = await DaylightAPI(url);
      console.log({ infoResponse });
      setMediaInfo({ ...infoResponse, media_key: infoResponse.media_key  || infoResponse.listkey, continuous });
      setIsReady(true);
    } else if (!!open) {
      setGoToApp(open);
    }
  }, [plex, media, rate, open, shuffle, continuous]);

  useEffect(() => {
    fetchVideoInfo();
  }, [fetchVideoInfo]);

  if (goToApp) return <AppContainer open={goToApp} clear={clear} />;
  return (
    <div className={`player ${playerType || ''}`}>
      {!isReady && <div className={`shader on notReady ${shader}`}><LoadingOverlay /></div>}
      {isReady && ['dash_video', 'video', 'audio'].includes(mediaInfo.media_type) && (
        React.createElement(
          {
            audio: AudioPlayer,
            video: VideoPlayer,
            dash_video: VideoPlayer
          }[mediaInfo.media_type],
          {
            media: mediaInfo,
            advance,
            clear,
            shader,
            volume,
            playbackRate,
            setShader,
            cycleThroughClasses,
            classes,
            playbackKeys,
            queuePosition,
            fetchVideoInfo,
            ignoreKeys,
            onProgress,
            onMediaRef,
            stallConfig: play?.stallConfig
          }
        )
      )}
      {isReady && !['dash_video', 'video', 'audio'].includes(mediaInfo.media_type) && (
        <pre>
          {JSON.stringify(mediaInfo, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AudioPlayer({ media, advance, clear, shader, setShader, volume, playbackRate, cycleThroughClasses, classes,playbackKeys,queuePosition, fetchVideoInfo, ignoreKeys, onProgress, onMediaRef, stallConfig }) {
  const { media_url, title, artist, albumArtist, album, image, type } = media || {};
  const {
    seconds,
    duration,
    containerRef,
    isPaused,
    isStalled,
    isSeeking,
    handleProgressClick
  } = useCommonMediaController({
    start: media.seconds,
    playbackRate: playbackRate || media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: true,
    isVideo: false,
    meta: media,
    type: ['track'].includes(type) ? 'plex' : 'media',
    shader,
    setShader,
    cycleThroughClasses,
    classes,
    volume,
    playbackKeys,queuePosition,
    ignoreKeys,
    onProgress,
    onMediaRef,
    stallConfig
  });

  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  const header = !!artist && !!album ? `${artist} - ${album}` : !!artist ? artist : !!album ? album : media_url;
  const shaderState = percent < 0.1 || seconds > duration - 2 ? 'on' : 'off';

  const footer = `${title}${albumArtist && albumArtist !== artist ? ` (${albumArtist})` : ''}`;
  return (
    <div className={`audio-player ${shader}`}>
      <div className={`shader ${shaderState}`} />
  {(seconds === 0 || isStalled || isSeeking) && (
        <LoadingOverlay
          isPaused={isPaused}
          fetchVideoInfo={fetchVideoInfo}
          stalled={isStalled}
          initialStart={media.seconds || 0}
          seconds={seconds}
          // Provide context and element introspection for debug
          debugContext={{
            scope: 'audio',
            mediaType: media?.media_type,
            type,
            title,
            artist,
            album,
            albumArtist,
            url: media_url,
            media_key: media?.media_key || media?.key || media?.plex,
            shader
          }}
          getMediaEl={() => {
            const el = (containerRef.current?.shadowRoot?.querySelector('video')) || containerRef.current;
            return el || null;
          }}
        />
      )}
      <ProgressBar percent={percent} onClick={handleProgressClick} />
      <div className="audio-content">
        <div className="image-container">
          {image && (
            <>
              <img src={image} alt={title} className="cover" />
              <div className="image-backdrop" />
            </>
          )}
        </div>
        <div className="audio-info">
          <p className="audio-header">{header}</p>
          <p className="audio-timing">{formatTime(seconds)} / {formatTime(duration)}</p>
          <p className="audio-footer">{footer}</p>
        </div>
      </div>
      <audio ref={containerRef} src={media_url} autoPlay style={{ display: 'none' }} />
    </div>
  );
}

function VideoPlayer({ media, advance, clear, shader, volume, playbackRate,setShader, cycleThroughClasses, classes, playbackKeys,queuePosition, fetchVideoInfo, ignoreKeys, onProgress, onMediaRef, stallConfig  }) {
  const isPlex = ['dash_video'].includes(media.media_type);
  const [displayReady, setDisplayReady] = useState(false);
  const {
    isDash,
    containerRef,
    seconds,
    isPaused,
    duration,
    isStalled,
    isSeeking,
    handleProgressClick,
  } = useCommonMediaController({
    start: media.seconds,
    playbackRate: playbackRate || media.playbackRate || 1,
    onEnd: advance,
    onClear: clear,
    isAudio: false,
    isVideo: true,
    meta: media,
    type: isPlex ? 'plex' : 'media',
    shader,
    volume,
    setShader,
    cycleThroughClasses,
    classes,
    playbackKeys,queuePosition,
    ignoreKeys,
    onProgress,
    onMediaRef,
    stallConfig
  });

  const { show, season, title, media_url } = media;
  const percent = duration ? ((seconds / duration) * 100).toFixed(1) : 0;
  const heading = !!show && !!season && !!title
    ? `${show} - ${season}: ${title}`
    : !!show && !!season
    ? `${show} - ${season}`
    : !!show
    ? show
    : title;

  return (
    <div className={`video-player ${shader}`}>
      <h2>
        {heading} {`(${playbackRate}×)`}
      </h2>
      <ProgressBar percent={percent} onClick={handleProgressClick} />
  {(seconds === 0 || isStalled || isSeeking) && (
        <LoadingOverlay
          seconds={seconds}
          isPaused={isPaused}
          fetchVideoInfo={fetchVideoInfo}
          stalled={isStalled}
          initialStart={media.seconds || 0}
          debugContext={{
            scope: 'video',
            mediaType: media?.media_type,
            title,
            show,
            season,
            url: media_url,
            media_key: media?.media_key || media?.key || media?.plex,
            isDash,
            shader
          }}
          getMediaEl={() => {
            const el = (containerRef.current?.shadowRoot?.querySelector('video')) || containerRef.current;
            return el || null;
          }}
        />
      )}
      {isDash ? (
        <dash-video
          ref={containerRef}
          class={`video-element ${displayReady ? 'show' : ''}`}
          // controls intentionally omitted to avoid native chrome flash
          src={media_url}
          onCanPlay={() => setDisplayReady(true)}
          onPlaying={() => setDisplayReady(true)}
        />
      ) : (
        <video
          autoPlay
          ref={containerRef}
          className={`video-element ${displayReady ? 'show' : ''}`}
          src={media_url}
          // controls omitted (custom minimal UI elsewhere)
          onCanPlay={() => setDisplayReady(true)}
          onPlaying={() => setDisplayReady(true)}
        />
      )}
    </div>
  );
}


/*─────────────────────────────────────────────────────────────*/
/*  LOADING OVERLAY                                           */
/*─────────────────────────────────────────────────────────────*/

// Global state to remember pause overlay visibility setting
let pauseOverlayVisible = true;

export function LoadingOverlay({ isPaused, fetchVideoInfo, onTogglePauseOverlay, initialStart = 0, seconds = 0, stalled, debugContext, getMediaEl }) {
  const [visible, setVisible] = useState(false);
  const [loadingTime, setLoadingTime] = useState(0);
  const [showPauseOverlay, setShowPauseOverlay] = useState(pauseOverlayVisible);
  const [showDebug, setShowDebug] = useState(false);
  const [debugSnapshot, setDebugSnapshot] = useState(null);

  useEffect(() => {
    const timeout = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    setShowPauseOverlay(pauseOverlayVisible);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isPaused && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        const newVisibility = !showPauseOverlay;
        setShowPauseOverlay(newVisibility);
        pauseOverlayVisible = newVisibility; // Remember setting globally
      }
    };

    if (isPaused) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (isPaused) {
        window.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [isPaused, showPauseOverlay]);

  useEffect(() => {
    if (!isPaused) {
      const interval = setInterval(() => {
        setLoadingTime((prev) => prev + 1);
      }, 1000);

      if (loadingTime >= 10) {
        fetchVideoInfo?.();
        setLoadingTime(0); // Reset loading time after fetching
      }

      return () => clearInterval(interval);
    } else {
      setLoadingTime(0); // Reset loading time if paused
    }
  }, [isPaused, loadingTime, fetchVideoInfo]);

  // After 3s on initial load (seconds===0), reveal debug info
  useEffect(() => {
    if (isPaused) { setShowDebug(false); return; }
    let to;
    if (visible && seconds === 0) {
      to = setTimeout(() => setShowDebug(true), 3000);
    } else {
      setShowDebug(false);
    }
    return () => { if (to) clearTimeout(to); };
  }, [visible, seconds, isPaused]);

  // Build a snapshot of media element state for debugging
  useEffect(() => {
    if (!showDebug) return;
    const mapReady = (n) => ({0:'HAVE_NOTHING',1:'HAVE_METADATA',2:'HAVE_CURRENT_DATA',3:'HAVE_FUTURE_DATA',4:'HAVE_ENOUGH_DATA'}[n] || String(n));
    const mapNetwork = (n) => ({0:'NETWORK_EMPTY',1:'NETWORK_IDLE',2:'NETWORK_LOADING',3:'NETWORK_NO_SOURCE'}[n] || String(n));
    const collect = () => {
      const el = typeof getMediaEl === 'function' ? getMediaEl() : null;
      const err = el?.error ? (el.error.message || el.error.code) : undefined;
      const bufferedEnd = (() => { try { return el?.buffered?.length ? el.buffered.end(el.buffered.length - 1).toFixed(2) : undefined; } catch { return undefined; } })();
      setDebugSnapshot({
        when: new Date().toISOString(),
        context: debugContext || {},
        elPresent: !!el,
        readyState: el?.readyState,
        readyStateText: mapReady(el?.readyState),
        networkState: el?.networkState,
        networkStateText: mapNetwork(el?.networkState),
        paused: el?.paused,
        seeking: el?.seeking,
        ended: el?.ended,
        currentTime: el?.currentTime,
        duration: el?.duration,
        bufferedEnd,
        src: el?.getAttribute?.('src'),
        currentSrc: el?.currentSrc,
        error: err,
        stalled
      });
    };
    collect();
    const id = setInterval(collect, 1000);
    return () => clearInterval(id);
  }, [showDebug, getMediaEl, debugContext, stalled]);

  const imgSrc = isPaused ? pause : spinner;
  const showSeekInfo = initialStart > 0 && seconds === 0 && !stalled;
  const formatSeek = (s) => {
    if (!Number.isFinite(s)) return '';
    const mm = Math.floor(s / 60).toString().padStart(2,'0');
    const ss = Math.floor(s % 60).toString().padStart(2,'0');
    return `${mm}:${ss}`;
  };

  // Always show loading overlay when not paused (loading state)
  // For paused state, respect the user's toggle setting
  if (isPaused && !showPauseOverlay) {
    return null;
  }

  return (
    <div
      className={`loading-overlay ${isPaused ? 'paused' : 'loading'}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
      }}
    >
      <img src={imgSrc} alt="" />
      {(showSeekInfo || showDebug) && (
        <div className="loading-info">
          {showSeekInfo && <div>Loading at {formatSeek(initialStart)}</div>}
          {showDebug && (
            <pre style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>
{JSON.stringify(debugSnapshot, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}