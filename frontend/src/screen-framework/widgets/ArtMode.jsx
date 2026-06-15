// frontend/src/screen-framework/widgets/ArtMode.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { getChildLogger } from '../../lib/logging/singleton.js';
import { artLayout } from './artLayout.js';
import './ArtMode.css';

const DIM_STEP = 0.1;
const DIM_MAX = 0.85;
const EXIT_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Escape', 'Esc']);
const NEXT_KEYS = new Set(['ArrowLeft', 'ArrowRight']);
const BRIGHTER_KEYS = new Set(['ArrowUp']);
const DIMMER_KEYS = new Set(['ArrowDown']);
const round2 = (n) => Math.round(n * 100) / 100;
const DEFAULT_FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };

/**
 * ArtMode — single landscape or portrait diptych, matted + framed, with engraved
 * brass nameplate(s). Home screensaver.
 *
 * Props (from screen YAML screensaver.props):
 *   placard        show nameplate(s) (default true)
 *   onExit/dismiss close the screensaver
 *   frame          frame PNG window insets {top,right,bottom,left} % (default DEFAULT_FRAME)
 *   matMargin      mat band % of height (default 4)
 *   cropMaxPerSide max cover-crop per side, % (default 8)
 */
function ArtMode({
  placard = true, onExit, dismiss,
  frame = DEFAULT_FRAME, matMargin = 4, cropMaxPerSide = 8,
}) {
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [dim, setDim] = useState(0);
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
        logger.info('artmode.loaded', { mode: data?.mode ?? null, count: data?.panels?.length ?? 0 });
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setFailed(true);
        logger.error('artmode.load-failed', { error: err.message });
      });
  }, [logger]);
  useEffect(() => { logger.info('artmode.mount', { placard }); load(); }, [logger, load, placard]);

  const exit = useCallback(() => { (onExit || dismiss)?.(); }, [onExit, dismiss]);
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      if (!(EXIT_KEYS.has(k) || NEXT_KEYS.has(k) || BRIGHTER_KEYS.has(k) || DIMMER_KEYS.has(k))) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (EXIT_KEYS.has(k)) { logger.info('artmode.exit', { key: k }); exit(); }
      else if (NEXT_KEYS.has(k)) { logger.info('artmode.shuffle', { key: k }); load(); }
      else if (BRIGHTER_KEYS.has(k)) setDim((d) => round2(Math.max(0, d - DIM_STEP)));
      else setDim((d) => round2(Math.min(DIM_MAX, d + DIM_STEP)));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exit, load, logger]);

  const matteVars = useMemo(() => {
    const m = art?.matte;
    if (!m) return undefined;
    return {
      '--matte-base': m.base, '--matte-glow': m.glow, '--matte-edge': m.edge,
      '--cut-top': m.bevelTop, '--cut-left': m.bevelLeft, '--cut-right': m.bevelRight, '--cut-bottom': m.bevelBottom,
    };
  }, [art]);

  const panels = (!failed && art?.panels) ? art.panels : [];
  const layout = useMemo(() => {
    if (!panels.length) return null;
    const ratios = panels.map((p) =>
      (p.meta?.width > 0 && p.meta?.height > 0) ? p.meta.width / p.meta.height : 1);
    return artLayout({ mode: art.mode, ratios, frame, matMargin, crop: cropMaxPerSide / 100 });
  }, [panels, art, frame, matMargin, cropMaxPerSide]);

  const testid = (base, i) => (i === 0 ? base : `${base}-${i}`);

  return (
    <div className="artmode" data-testid="artmode" style={matteVars}>
      <div className="artmode__stage">
        <div className="artmode__matte" aria-hidden="true" />
        {layout && (
          <div className="artmode__opening" style={{
            top: `${layout.opening.top}%`, bottom: `${layout.opening.bottom}%`,
            left: `${layout.opening.left}%`, right: `${layout.opening.right}%`,
            justifyContent: layout.justify,
          }}>
            {panels.map((p, i) => (
              <div key={i} className="artmode__window" data-testid={testid('artmode-window', i)}
                   style={{ height: `${layout.panels[i].heightPct}%`, aspectRatio: String(layout.panels[i].boxAspect) }}>
                <img className="artmode__image" data-testid={testid('artmode-image', i)}
                     src={DaylightMediaPath(p.image)} alt={p.meta?.title || 'Artwork'} />
                <span className="artmode__cut" aria-hidden="true" />
              </div>
            ))}
          </div>
        )}
        <img className="artmode__frame" data-testid="artmode-frame" src={frameSrc} alt="" />
        {placard && layout && panels.map((p, i) => {
          if (!(p.meta && (p.meta.title || p.meta.artist))) return null;
          return (
            <div key={i} className="artmode__placard" data-testid={testid('artmode-placard', i)}
                 style={{ left: `${layout.panels[i].centerXPct}%` }}>
              {p.meta.title && <span className="artmode__placard-title">{p.meta.title}</span>}
              {(p.meta.artist || p.meta.date) && (
                <span className="artmode__placard-artist">
                  {[p.meta.artist, p.meta.date].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
          );
        })}
        <div className="artmode__dim" data-testid="artmode-dim" aria-hidden="true" style={{ opacity: dim }} />
      </div>
    </div>
  );
}

export default ArtMode;
