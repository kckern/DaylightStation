import { useEffect, useRef, useCallback } from 'react';
import getLogger from '@/lib/logging/Logger.js';

const FADE_MS = 500;

let _logger;
const logger = () => {
  if (!_logger) _logger = getLogger().child({ component: 'useMenuMusic' });
  return _logger;
};

/**
 * Cancel a running rAF fade.
 */
const cancelFade = (handleRef) => {
  if (handleRef.current != null) {
    cancelAnimationFrame(handleRef.current);
    handleRef.current = null;
  }
};

/**
 * Linear rAF fade from fromVol to toVol over durationMs.
 * Stores rAF id in handleRef. Calls onDone when complete.
 */
const startFade = (audio, fromVol, toVol, durationMs, handleRef, onDone) => {
  cancelFade(handleRef);
  if (!audio) return;

  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / durationMs);
    audio.volume = Math.max(0, Math.min(1, fromVol + (toVol - fromVol) * t));
    if (t < 1) {
      handleRef.current = requestAnimationFrame(tick);
    } else {
      handleRef.current = null;
      onDone?.();
    }
  };
  handleRef.current = requestAnimationFrame(tick);
};

/**
 * useMenuMusic — ambient background music for the fitness browse screens.
 *
 * @param {object} opts
 * @param {boolean}  opts.isActive       - True when menu music should play.
 * @param {*}        opts.trackChangeKey - Changing this triggers a crossfade to a new track.
 * @param {number}   opts.volume         - Target volume (0–1), default 0.075.
 * @param {string[]} opts.trackUrls      - Fully-qualified audio URLs to pick from.
 */
const useMenuMusic = ({ isActive, trackChangeKey, volume = 0.075, trackUrls = [] }) => {
  const audioA = useRef(null);
  const audioB = useRef(null);
  const activeSlot = useRef('a');
  const lastUrl = useRef(null);
  const fadeHandleA = useRef(null);
  const fadeHandleB = useRef(null);
  // Guards trackChangeKey effect from firing on initial mount
  const hasStarted = useRef(false);

  // Stable refs so effects don't re-subscribe on every render
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const trackUrlsRef = useRef(trackUrls);
  useEffect(() => { trackUrlsRef.current = trackUrls; }, [trackUrls]);

  const isActiveRef = useRef(isActive);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);

  const getSlot = (name) => name === 'a' ? audioA.current : audioB.current;
  const getFadeHandle = (name) => name === 'a' ? fadeHandleA : fadeHandleB;

  const pickTrack = useCallback(() => {
    const urls = trackUrlsRef.current;
    if (!urls.length) return null;
    if (urls.length === 1) return urls[0];
    let candidate;
    let attempts = 0;
    do {
      candidate = urls[Math.floor(Math.random() * urls.length)];
      attempts++;
    } while (candidate === lastUrl.current && attempts < 10);
    return candidate;
  }, []);

  // Start a brand-new random track on the given slot, fading in from 0.
  // Used both for track-end continuation and could be reused elsewhere.
  const startFreshTrack = useCallback((slotName) => {
    const audio = slotName === 'a' ? audioA.current : audioB.current;
    const handle = slotName === 'a' ? fadeHandleA : fadeHandleB;
    if (!audio) return;
    const url = pickTrack();
    if (!url) return;
    lastUrl.current = url;
    audio.src = url;
    audio.volume = 0;
    audio.load();
    audio.play().catch(err => logger().warn('menu-music.continue-play-failed', { message: err?.message }));
    startFade(audio, 0, volumeRef.current, FADE_MS, handle, null);
    logger().info('menu-music.track-ended-continue', { slot: slotName });
  }, [pickTrack]);

  // Create Audio elements once on mount, destroy on unmount
  useEffect(() => {
    audioA.current = new Audio();
    audioA.current.volume = 0;
    audioB.current = new Audio();
    audioB.current.volume = 0;

    const onEndedA = () => {
      if (isActiveRef.current && activeSlot.current === 'a') startFreshTrack('a');
    };
    const onEndedB = () => {
      if (isActiveRef.current && activeSlot.current === 'b') startFreshTrack('b');
    };
    audioA.current.addEventListener('ended', onEndedA);
    audioB.current.addEventListener('ended', onEndedB);

    logger().info('menu-music.init');

    return () => {
      audioA.current?.removeEventListener('ended', onEndedA);
      audioB.current?.removeEventListener('ended', onEndedB);
      cancelFade(fadeHandleA);
      cancelFade(fadeHandleB);
      audioA.current?.pause();
      audioB.current?.pause();
      audioA.current = null;
      audioB.current = null;
      logger().info('menu-music.destroy');
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // isActive: start/stop music
  useEffect(() => {
    const slot = activeSlot.current;
    const audio = getSlot(slot);
    const handle = getFadeHandle(slot);
    if (!audio) return;

    if (isActive) {
      if (!audio.src || audio.ended) {
        const url = pickTrack();
        if (!url) return;
        lastUrl.current = url;
        audio.src = url;
        audio.load();
        logger().info('menu-music.track-loaded', { slot });
      }
      audio.play().catch(err => logger().warn('menu-music.play-failed', { message: err?.message }));
      startFade(audio, audio.volume, volumeRef.current, FADE_MS, handle, null);
      hasStarted.current = true;
      logger().info('menu-music.started', { slot });
    } else {
      if (!hasStarted.current) return;
      startFade(audio, audio.volume, 0, FADE_MS, handle, () => {
        audio.pause();
        logger().info('menu-music.paused', { slot });
      });
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // trackChangeKey: crossfade to new track
  useEffect(() => {
    if (!hasStarted.current || !isActive || !trackUrlsRef.current.length) return;

    const outSlot = activeSlot.current;
    const inSlot = outSlot === 'a' ? 'b' : 'a';
    const outAudio = getSlot(outSlot);
    const inAudio = getSlot(inSlot);
    const outHandle = getFadeHandle(outSlot);
    const inHandle = getFadeHandle(inSlot);
    if (!outAudio || !inAudio) return;

    const url = pickTrack();
    if (!url) return;
    lastUrl.current = url;

    inAudio.src = url;
    inAudio.volume = 0;
    inAudio.load();
    inAudio.play().catch(err => logger().warn('menu-music.crossfade-play-failed', { message: err?.message }));

    startFade(inAudio, 0, volumeRef.current, FADE_MS, inHandle, null);
    startFade(outAudio, outAudio.volume, 0, FADE_MS, outHandle, () => {
      outAudio.pause();
      outAudio.removeAttribute('src');
      outAudio.load();
    });

    activeSlot.current = inSlot;
    logger().info('menu-music.crossfade', { from: outSlot, to: inSlot });
  }, [trackChangeKey]); // eslint-disable-line react-hooks/exhaustive-deps
};

export default useMenuMusic;
