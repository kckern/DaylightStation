import React, { useRef, useEffect, useCallback, useState } from 'react';
import PropTypes from 'prop-types';
import { useScreenVolume } from '../../../lib/volume/ScreenVolumeContext.js';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'AudioLayer' });

/**
 * AudioLayer — configurable audio track alongside a visual queue.
 * Renders an inner <Player> for actual playback. Controls pause/duck/skip
 * behavior based on the current queue item's media type.
 *
 * Uses DOM queries to find the audio element because React 18.3's internal
 * ref format breaks useImperativeHandle forwarding for nested forwardRef
 * components — playerRef.current never gets populated.
 *
 * Modes: hidden | overlay | mini
 * Behaviors: pause (default) | duck | skip
 */
export function AudioLayer({
  contentId,
  behavior = 'pause',
  mode = 'hidden',
  duckLevel = 0.15,
  currentItemMediaType,
  Player,
  ignoreKeys: parentIgnoreKeys,
}) {
  const containerRef = useRef(null);
  const prevMediaTypeRef = useRef(currentItemMediaType);
  // savedVolume is the LOGICAL pre-duck volume (master-independent). Stored as
  // el.volume / master so we can restore correctly even if master changes mid-duck.
  const savedVolumeRef = useRef(1);
  const fadeRafRef = useRef(null);
  const isDuckedRef = useRef(false);
  const lastAudioElRef = useRef(null);
  const [audioQueue, setAudioQueue] = useState(null);
  const { master: masterVolume } = useScreenVolume();

  /** Find the audio/video element rendered by the nested Player */
  const getAudioEl = useCallback(() => {
    if (!containerRef.current) return null;
    return containerRef.current.querySelector('audio, video');
  }, []);

  /** Smoothly fade an audio element's volume over durationMs */
  const fadeVolume = useCallback((el, from, to, durationMs, onDone) => {
    // Cancel any in-progress fade
    if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current);
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1) {
        fadeRafRef.current = requestAnimationFrame(tick);
      } else {
        fadeRafRef.current = null;
        onDone?.();
      }
    };
    fadeRafRef.current = requestAnimationFrame(tick);
  }, []);

  // Mount/unmount logging
  useEffect(() => {
    logger.info('audio-layer-mount', { contentId, behavior, mode });
    return () => {
      if (fadeRafRef.current) cancelAnimationFrame(fadeRafRef.current);
      logger.debug('audio-layer-unmount', { contentId });
    };
  }, [contentId, behavior, mode]);

  // Resolve contentId to playable queue via API
  useEffect(() => {
    if (!contentId) return;

    let cancelled = false;
    const resolve = async () => {
      try {
        const response = await fetch(`/api/v1/queue/${encodeURIComponent(contentId)}`);
        if (!response.ok) {
          logger.warn('audio-layer-resolve-failed', { contentId, status: response.status });
          return;
        }
        const data = await response.json();
        if (!cancelled) {
          const items = data.items || data;
          setAudioQueue(items);
          logger.info('audio-layer-resolved', {
            contentId,
            itemCount: items.length,
            tracks: items.slice(0, 5).map(t => ({ id: t.id, title: t.title })),
          });
        }
      } catch (err) {
        logger.error('audio-layer-resolve-error', { contentId, error: err.message });
      }
    };

    resolve();
    return () => { cancelled = true; };
  }, [contentId]);

  // When master volume changes, the inner Player's master-change effect
  // re-applies el.volume = adjustedVolume × master, which undoes any active
  // duck. React commits child effects before parent effects, so by the time
  // this runs, Player has already restored the un-ducked level — we just
  // re-apply the duck on top.
  useEffect(() => {
    if (!isDuckedRef.current) return;
    if (behavior !== 'duck') return;
    const el = getAudioEl();
    if (!el) return;
    el.volume = Math.max(0, Math.min(1, el.volume * duckLevel));
    logger.debug('audio-layer-master-reduck', { contentId, volume: el.volume });
  }, [masterVolume, behavior, duckLevel, contentId, getAudioEl]);

  // Re-apply duck when the inner Player remounts (new audio element on track advance).
  // Volume is track-level state on the DOM element; this promotes it to playlist-level.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || behavior !== 'duck') return;

    const observer = new MutationObserver(() => {
      const el = getAudioEl();
      if (el && el !== lastAudioElRef.current) {
        lastAudioElRef.current = el;
        if (isDuckedRef.current) {
          // duckLevel is a proportion of the new element's natural volume; the
          // inner Player will have already set el.volume = adjustedVolume × master.
          el.volume = Math.max(0, Math.min(1, el.volume * duckLevel));
          logger.debug('audio-layer-reduck', { contentId, volume: el.volume, reason: 'track-advance' });
        }
      }
    });

    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [behavior, duckLevel, contentId, getAudioEl]);

  // React to media type changes for pause/duck/skip.
  // audioQueue in deps ensures we retry when the Player mounts (its queue resolves).
  useEffect(() => {
    const prev = prevMediaTypeRef.current;
    const el = getAudioEl();

    logger.debug('audio-layer-media-type-check', {
      prev, currentItemMediaType, behavior,
      hasEl: !!el,
      audioQueueReady: !!audioQueue,
      same: prev === currentItemMediaType,
    });

    if (prev === currentItemMediaType) return;

    if (!el) {
      logger.warn('audio-layer-no-audio-el', { contentId, prev, currentItemMediaType, behavior });
      return;
    }

    prevMediaTypeRef.current = currentItemMediaType;

    const isVideo = currentItemMediaType === 'video';
    const wasVideo = prev === 'video';

    const FADE_MS = 1000;

    if (isVideo && !wasVideo) {
      if (behavior === 'pause') {
        logger.info('audio-layer-pause', { contentId, reason: 'video-start', fromType: prev, toType: currentItemMediaType });
        el.pause();
      } else if (behavior === 'duck') {
        // Capture LOGICAL pre-duck volume (master-independent). Recover later
        // by multiplying back in by current master.
        const safeMaster = masterVolume > 0 ? masterVolume : 1;
        savedVolumeRef.current = el.volume / safeMaster;
        isDuckedRef.current = true;
        const target = Math.max(0, el.volume * duckLevel);
        logger.info('audio-layer-duck', { contentId, reason: 'video-start', from: el.volume, to: target, fadeMs: FADE_MS, savedLogical: savedVolumeRef.current });
        fadeVolume(el, el.volume, target, FADE_MS);
      }
    } else if (wasVideo && !isVideo) {
      if (behavior === 'pause') {
        logger.info('audio-layer-resume', { contentId, reason: 'video-end', fromType: prev, toType: currentItemMediaType });
        el.play().catch(() => {});
      } else if (behavior === 'duck') {
        isDuckedRef.current = false;
        // Restore: logical × current master. Handles mid-duck master changes.
        const restoreTo = Math.max(0, Math.min(1, savedVolumeRef.current * masterVolume));
        logger.info('audio-layer-unduck', { contentId, reason: 'video-end', from: el.volume, to: restoreTo, fadeMs: FADE_MS });
        fadeVolume(el, el.volume, restoreTo, FADE_MS);
      }
    } else {
      logger.debug('audio-layer-no-action', { isVideo, wasVideo, behavior });
    }
  }, [currentItemMediaType, behavior, audioQueue, getAudioEl]);

  const noop = useCallback(() => {}, []);

  if (!audioQueue || !Player) return null;

  const isHidden = mode === 'hidden';
  const containerStyle = isHidden
    ? { position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }
    : {};
  const containerClass = `audio-layer audio-layer--${mode}`;

  return (
    <div ref={containerRef} className={containerClass} style={containerStyle} data-track="audio">
      <Player
        playerType="background"
        queue={audioQueue}
        clear={noop}
        ignoreKeys={isHidden ? true : parentIgnoreKeys}
        shuffle={true}
      />
    </div>
  );
}

AudioLayer.propTypes = {
  contentId: PropTypes.string.isRequired,
  behavior: PropTypes.oneOf(['pause', 'duck', 'skip']),
  mode: PropTypes.oneOf(['hidden', 'overlay', 'mini']),
  duckLevel: PropTypes.number,
  currentItemMediaType: PropTypes.string,
  Player: PropTypes.elementType.isRequired,
  ignoreKeys: PropTypes.bool,
};
