import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { useScreenVolume } from '../../../lib/volume/ScreenVolumeContext.js';
import getLogger from '../../../lib/logging/Logger.js';

const logger = getLogger().child({ component: 'AmbientLayer' });

const DEFAULT_FADE_MS = 1500;

/**
 * AmbientLayer — queue-wide ambient audio with crossfade.
 *
 * Lives above the SinglePlayer remount boundary so ambient audio survives item
 * advance. When `ambientUrl` changes, fades the current slot out while fading
 * the new slot in. Identical URLs across items are treated as continuous (no
 * crossfade, just volume sync if it changed).
 */
export function AmbientLayer({
  ambientUrl,
  ambientVolume = 0.1,
  fadeMs = DEFAULT_FADE_MS,
}) {
  const slotARef = useRef(null);
  const slotBRef = useRef(null);
  const activeSlotRef = useRef('none'); // 'A' | 'B' | 'none'
  const slotUrlsRef = useRef({ A: null, B: null });
  const fadeRafRef = useRef({ A: null, B: null });

  const { effectiveMaster: masterVolume } = useScreenVolume();
  const effectiveAmbient = Math.max(0, Math.min(1, ambientVolume * masterVolume));

  const cancelFade = (slot) => {
    if (fadeRafRef.current[slot]) {
      cancelAnimationFrame(fadeRafRef.current[slot]);
      fadeRafRef.current[slot] = null;
    }
  };

  const fade = (slot, to, durationMs, onDone) => {
    const ref = slot === 'A' ? slotARef : slotBRef;
    const el = ref.current;
    if (!el) { onDone?.(); return; }
    cancelFade(slot);
    const from = el.volume;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / Math.max(1, durationMs));
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1) {
        fadeRafRef.current[slot] = requestAnimationFrame(tick);
      } else {
        fadeRafRef.current[slot] = null;
        onDone?.();
      }
    };
    fadeRafRef.current[slot] = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const active = activeSlotRef.current;
    const urls = slotUrlsRef.current;

    if (!ambientUrl) {
      if (active !== 'none') {
        const activeEl = (active === 'A' ? slotARef : slotBRef).current;
        logger.info('ambient-stop', { fromUrl: urls[active] });
        fade(active, 0, fadeMs, () => {
          if (activeEl) activeEl.pause();
          urls[active] = null;
        });
        activeSlotRef.current = 'none';
      }
      return;
    }

    // Same URL still playing: just sync volume target (handles master/volume changes)
    if (active !== 'none' && urls[active] === ambientUrl) {
      const activeEl = (active === 'A' ? slotARef : slotBRef).current;
      if (activeEl && Math.abs((activeEl.volume || 0) - effectiveAmbient) > 0.001) {
        fade(active, effectiveAmbient, fadeMs);
      }
      return;
    }

    // Crossfade to new URL on the inactive slot
    const nextSlot = active === 'A' ? 'B' : 'A';
    const nextEl = (nextSlot === 'A' ? slotARef : slotBRef).current;
    if (!nextEl) return;

    nextEl.src = ambientUrl;
    nextEl.loop = true;
    nextEl.volume = 0;
    nextEl.load();
    const playPromise = nextEl.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        logger.warn('ambient-play-failed', { url: ambientUrl, error: err?.message });
      });
    }
    urls[nextSlot] = ambientUrl;
    fade(nextSlot, effectiveAmbient, fadeMs);

    if (active !== 'none') {
      const oldEl = (active === 'A' ? slotARef : slotBRef).current;
      const fromUrl = urls[active];
      logger.info('ambient-crossfade', { fromUrl, toUrl: ambientUrl, fadeMs });
      fade(active, 0, fadeMs, () => {
        if (oldEl) oldEl.pause();
        urls[active] = null;
      });
    } else {
      logger.info('ambient-start', { url: ambientUrl, fadeMs });
    }

    activeSlotRef.current = nextSlot;
  }, [ambientUrl, effectiveAmbient, fadeMs]);

  useEffect(() => () => {
    cancelFade('A');
    cancelFade('B');
  }, []);

  return (
    <div
      className="ambient-layer"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <audio ref={slotARef} preload="auto" data-role="ambient" />
      <audio ref={slotBRef} preload="auto" data-role="ambient" />
    </div>
  );
}

AmbientLayer.propTypes = {
  ambientUrl: PropTypes.string,
  ambientVolume: PropTypes.number,
  fadeMs: PropTypes.number,
};
