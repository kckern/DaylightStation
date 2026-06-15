// frontend/src/screen-framework/widgets/ArtMode.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { getChildLogger } from '../../lib/logging/singleton.js';
import './ArtMode.css';

const DIM_STEP = 0.1;
const DIM_MAX = 0.85;        // never fully black
const EXIT_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Escape', 'Esc']);
const NEXT_KEYS = new Set(['ArrowLeft', 'ArrowRight']);
const BRIGHTER_KEYS = new Set(['ArrowUp']);
const DIMMER_KEYS = new Set(['ArrowDown']);
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * ArtMode — a painting recessed UNDER a cut mat, inside an ornate frame, with
 * an engraved brass nameplate. Used as the home screensaver.
 *
 * Interaction (keyboard / Shield D-pad):
 *   Enter · Space · Escape   → exit (back to the menu)
 *   Left · Right             → shuffle to a new random painting
 *   Up · Down                → brighten / dim (black opacity overlay)
 *
 * Props:
 *   placard: boolean   show the engraved nameplate (default true)
 *   onExit / dismiss   called to close the screensaver (onExit preferred)
 */
function ArtMode({ placard = true, onExit, dismiss }) {
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [dim, setDim] = useState(0);           // black overlay opacity (0 = full brightness)
  const logger = useMemo(() => getChildLogger({ widget: 'art' }), []);
  const frameSrc = useMemo(() => DaylightMediaPath('media/img/ui/frame.png'), []);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(() => {
    DaylightAPI('api/v1/art/featured')
      .then((data) => {
        if (!mountedRef.current) return;
        setFailed(false);
        setArt(data);
        logger.info('artmode.loaded', { title: data?.meta?.title ?? null, artist: data?.meta?.artist ?? null });
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setFailed(true);
        logger.error('artmode.load-failed', { error: err.message });
      });
  }, [logger]);

  useEffect(() => {
    logger.info('artmode.mount', { placard });
    load();
  }, [logger, load, placard]);

  const exit = useCallback(() => {
    (onExit || dismiss)?.();
  }, [onExit, dismiss]);

  // Capture-phase key handling: adapters listen on the bubble phase, so swallowing
  // here (stopPropagation + preventDefault) keeps handled keys out of the menu.
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      const isHandled =
        EXIT_KEYS.has(k) || NEXT_KEYS.has(k) || BRIGHTER_KEYS.has(k) || DIMMER_KEYS.has(k);
      if (!isHandled) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();

      if (EXIT_KEYS.has(k)) {
        logger.info('artmode.exit', { key: k });
        exit();
      } else if (NEXT_KEYS.has(k)) {
        logger.info('artmode.shuffle', { key: k });
        load();
      } else if (BRIGHTER_KEYS.has(k)) {
        setDim((d) => round2(Math.max(0, d - DIM_STEP)));
      } else if (DIMMER_KEYS.has(k)) {
        setDim((d) => round2(Math.min(DIM_MAX, d + DIM_STEP)));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exit, load, logger]);

  const caption = useMemo(() => {
    if (!art?.meta) return null;
    const { title, artist, date } = art.meta;
    return { title: title || null, artist: artist || null, date: date || null };
  }, [art]);

  // Intrinsic dimensions let the mat window take the painting's exact shape
  // before the image loads (no reflow) and guarantee it never overflows the mat.
  const dims = useMemo(() => {
    const w = art?.meta?.width;
    const h = art?.meta?.height;
    return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? { w, h } : null;
  }, [art]);

  return (
    <div className="artmode" data-testid="artmode">
      <div className="artmode__stage">
        <div className="artmode__matte" aria-hidden="true" />
        <div className="artmode__opening">
          {art?.image && !failed && (
            <div
              className="artmode__window"
              style={dims ? { aspectRatio: `${dims.w} / ${dims.h}` } : undefined}
            >
              <img
                className="artmode__image"
                data-testid="artmode-image"
                src={DaylightMediaPath(art.image)}
                alt={caption?.title || 'Artwork'}
                width={dims?.w}
                height={dims?.h}
              />
              <span className="artmode__cut" aria-hidden="true" />
            </div>
          )}
        </div>
        <img className="artmode__frame" data-testid="artmode-frame" src={frameSrc} alt="" />
        {placard && caption && (caption.title || caption.artist) && (
          <div className="artmode__placard" data-testid="artmode-placard">
            {caption.title && <span className="artmode__placard-title">{caption.title}</span>}
            {(caption.artist || caption.date) && (
              <span className="artmode__placard-artist">
                {[caption.artist, caption.date].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        )}
        <div
          className="artmode__dim"
          data-testid="artmode-dim"
          aria-hidden="true"
          style={{ opacity: dim }}
        />
      </div>
    </div>
  );
}

export default ArtMode;
