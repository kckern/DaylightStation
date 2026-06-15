// frontend/src/screen-framework/widgets/ArtMode.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../lib/api.mjs';
import { getChildLogger } from '../../lib/logging/singleton.js';
import smartquotes from 'smartquotes';
import { artLayout } from './artLayout.js';
import { VIEW_MODES, modeIndexByName, nextMode, prevMode, objectFitWindows } from './artModes.js';
import { layoutTitle } from './titleLayout.js';
import { useWebSocketSubscription } from '../../hooks/useWebSocket.js';
import { luxToDim } from './luxToDim.js';
import './ArtMode.css';

const DIM_STEP = 0.1;
const DIM_MAX = 0.85;
const EXIT_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Escape', 'Esc']);
const NEXT_KEYS = new Set(['ArrowLeft', 'ArrowRight']);
const BRIGHTER_KEYS = new Set(['ArrowUp']);
const DIMMER_KEYS = new Set(['ArrowDown']);
const round2 = (n) => Math.round(n * 100) / 100;
const DEFAULT_FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
const CURTAIN_MIN_MS = 700;   // never part the curtain before this (minimum effect)
const CURTAIN_MAX_MS = 8000;  // safety rail: always part by this, even if assets stall
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Typographic quotes/apostrophes via the smartquotes library (no hand-rolled regex).
const smartQuotes = (s) => (s == null ? s : smartquotes.string(String(s)));

/**
 * ArtMode — single landscape or portrait diptych, matted + framed, with engraved
 * brass nameplate(s). Home screensaver.
 *
 * Tab / Shift+Tab cycle five view modes (Gallery → Framed·Contain → Framed·Cover
 * → Bare·Contain → Bare·Cover); the mode persists across shuffles, resets on remount.
 *
 * Props (from screen YAML screensaver.props):
 *   placard         show nameplate(s) (default true)
 *   onExit/dismiss  close the screensaver
 *   frame           frame PNG window insets {top,right,bottom,left} % (default DEFAULT_FRAME)
 *   matMargin       mat band % of height (default 4)
 *   cropMaxPerSide  max cover-crop per side, % (default 8)
 *   ambient         { defaultLux, curve } for auto-dim (optional)
 *   defaultViewMode initial view mode name (default 'gallery')
 *   measureText     optional (s)=>px text measurer (test seam; canvas in browser)
 */
function ArtMode({
  placard = true, onExit, dismiss,
  frame = DEFAULT_FRAME, matMargin = 4, cropMaxPerSide = 8, ambient = null,
  defaultViewMode = 'gallery', measureText = null,
  curtainMinMs = CURTAIN_MIN_MS, curtainMaxMs = CURTAIN_MAX_MS,
}) {
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);
  const ambientCurve = ambient?.curve ?? null;
  const [autoDim, setAutoDim] = useState(() => (ambientCurve ? luxToDim(ambient?.defaultLux ?? 0, ambientCurve) : 0));
  const [manualBias, setManualBias] = useState(0);
  const dim = round2(Math.max(0, Math.min(DIM_MAX, autoDim + manualBias)));
  const [revealed, setRevealed] = useState(false);   // curtain open?
  const loadedRef = useRef(0);                        // how many panel images have loaded
  const dropAtRef = useRef(0);                        // when the curtain last dropped (ms)
  const revealTimerRef = useRef(null);               // pending min-dwell reveal
  const maxTimerRef = useRef(null);                  // pending safety-rail reveal
  const [modeIdx, setModeIdx] = useState(() => modeIndexByName(defaultViewMode));
  const mode = VIEW_MODES[modeIdx];
  const isGallery = mode.fit === 'gallery';
  const logger = useMemo(() => getChildLogger({ widget: 'art' }), []);
  const frameSrc = useMemo(() => DaylightMediaPath('media/img/ui/frame.png'), []);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
  }, []);

  // Stage size — drives placard width + title measurement.
  const stageRef = useRef(null);
  const [stage, setStage] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 720,
  }));
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const update = () => setStage((p) => ({ w: el.clientWidth || p.w, h: el.clientHeight || p.h }));
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clearCurtainTimers = useCallback(() => {
    if (revealTimerRef.current) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
  }, []);

  const openCurtain = useCallback(() => {
    clearCurtainTimers();
    if (mountedRef.current) setRevealed(true);
  }, [clearCurtainTimers]);

  // Part the curtain once the art is ready, but never before the minimum dwell —
  // and always via a timer, so a warm-cache instant load can't skip the closed
  // paint (which would cancel the parting animation entirely).
  const scheduleReveal = useCallback(() => {
    if (revealTimerRef.current) return;                 // already scheduled
    const remaining = Math.max(0, curtainMinMs - (nowMs() - dropAtRef.current));
    revealTimerRef.current = setTimeout(openCurtain, remaining);
  }, [curtainMinMs, openCurtain]);

  const load = useCallback(() => {
    // Drop the curtain (covers the swap); it parts after the MIN dwell once the
    // art loads, or by MAX at the latest (a rail so it can never stick down).
    loadedRef.current = 0;
    clearCurtainTimers();
    setRevealed(false);
    dropAtRef.current = nowMs();
    maxTimerRef.current = setTimeout(openCurtain, curtainMaxMs);
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
  }, [logger, clearCurtainTimers, openCurtain, curtainMaxMs]);

  // If the fetch fails there are no images to wait on — part the curtain (still
  // honoring the minimum dwell so the effect never flashes by).
  useEffect(() => { if (failed) scheduleReveal(); }, [failed, scheduleReveal]);
  useEffect(() => { logger.info('artmode.mount', { placard }); load(); }, [logger, load, placard]);

  const exit = useCallback(() => { (onExit || dismiss)?.(); }, [onExit, dismiss]);
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key;
      const isTab = k === 'Tab';
      if (!(EXIT_KEYS.has(k) || NEXT_KEYS.has(k) || BRIGHTER_KEYS.has(k) || DIMMER_KEYS.has(k) || isTab)) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (isTab) {
        setModeIdx((i) => (e.shiftKey ? prevMode(i) : nextMode(i)));
        logger.info('artmode.viewmode', { dir: e.shiftKey ? 'prev' : 'next' });
      } else if (EXIT_KEYS.has(k)) { logger.info('artmode.exit', { key: k }); exit(); }
      else if (NEXT_KEYS.has(k)) { logger.info('artmode.shuffle', { key: k }); load(); }
      else if (BRIGHTER_KEYS.has(k)) setManualBias((b) => round2(b - DIM_STEP));
      else setManualBias((b) => round2(b + DIM_STEP));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exit, load, logger]);

  useWebSocketSubscription(['ambient'], (msg) => {
    if (!ambientCurve || !msg) return;
    setAutoDim(luxToDim(Number(msg.lux), ambientCurve));
  }, [ambientCurve]);

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

  const fitWindows = useMemo(
    () => (panels.length ? objectFitWindows({ count: panels.length, frame, fullWindow: mode.fullWindow }) : []),
    [panels.length, frame, mode.fullWindow]);

  // Title measurement — canvas in the browser, injectable for tests. The
  // splitting itself is pure (titleLayout.js).
  const fontPx = Math.max(15.2, Math.min(27.2, 0.021 * stage.h));
  const measure = useMemo(() => {
    if (measureText) return measureText;
    if (typeof document === 'undefined') return null;
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.font = `italic 600 ${fontPx}px "Cormorant Garamond", Georgia, serif`;
    return (s) => ctx.measureText(s).width;
  }, [measureText, fontPx]);

  const placardGeom = isGallery ? (layout?.panels ?? []) : fitWindows;
  // Pre-split titles into 1-2 balanced lines per panel (memoized so brightness
  // keypresses, which re-render, don't re-measure every title).
  const placardLines = useMemo(
    () => placardGeom.map((g, i) => {
      const t = panels[i]?.meta?.title;
      if (!t) return [];
      const textPx = Math.max(0, (g.widthPct / 100) * stage.w - 3.4 * fontPx); // minus ~h-padding
      return layoutTitle(smartQuotes(t), textPx, measure);
    }),
    [placardGeom, panels, stage.w, fontPx, measure],
  );
  const testid = (base, i) => (i === 0 ? base : `${base}-${i}`);

  const onLoaded = () => {
    loadedRef.current += 1;
    if (loadedRef.current >= panels.length) scheduleReveal();
  };

  return (
    <div className="artmode" data-testid="artmode" data-mode={mode.name} style={matteVars}>
      <div className="artmode__stage" ref={stageRef}>
        <div className="artmode__matte" aria-hidden="true" />

        {isGallery && layout && (
          <div className="artmode__opening" style={{
            top: `${layout.opening.top}%`, bottom: `${layout.opening.bottom}%`,
            left: `${layout.opening.left}%`, right: `${layout.opening.right}%`,
            justifyContent: layout.justify,
          }}>
            {panels.map((p, i) => (
              <div key={p.image} className="artmode__window" data-testid={testid('artmode-window', i)}
                   style={{ height: `${layout.panels[i].heightPct}%`, aspectRatio: String(layout.panels[i].boxAspect) }}>
                <img className="artmode__image" data-testid={testid('artmode-image', i)}
                     src={DaylightMediaPath(p.image)} alt={p.meta?.title || 'Artwork'}
                     onLoad={onLoaded} onError={onLoaded} />
                <span className="artmode__cut" aria-hidden="true" />
              </div>
            ))}
          </div>
        )}

        {!isGallery && panels.map((p, i) => {
          const win = fitWindows[i];
          return (
            <div key={p.image} className="artmode__fitwindow" data-testid={testid('artmode-window', i)}
                 style={{ top: `${win.top}%`, left: `${win.left}%`, right: `${win.right}%`, bottom: `${win.bottom}%` }}>
              <img className={`artmode__fitimage artmode__fitimage--${mode.fit}`}
                   data-testid={testid('artmode-image', i)}
                   src={DaylightMediaPath(p.image)} alt={p.meta?.title || 'Artwork'}
                   onLoad={onLoaded} onError={onLoaded} />
            </div>
          );
        })}

        {/* Curtain: down by default, parts once the artwork has loaded. */}
        <div className={`artmode__curtain${revealed ? ' artmode__curtain--open' : ''}`}
             data-testid="artmode-curtain" aria-hidden="true">
          <div className="artmode__curtain-panel artmode__curtain-panel--l" />
          <div className="artmode__curtain-panel artmode__curtain-panel--r" />
        </div>

        {mode.frame && (
          <img className="artmode__frame" data-testid="artmode-frame" src={frameSrc} alt="" />
        )}

        {placard && mode.placard && placardGeom.map((g, i) => {
          const p = panels[i];
          if (!p || !(p.meta && (p.meta.title || p.meta.artist))) return null;
          const lines = placardLines[i] ?? [];
          return (
            <div key={panels[i]?.image ?? i} className="artmode__placard" data-testid={testid('artmode-placard', i)}
                 style={{ left: `${g.centerXPct}%`, maxWidth: `${g.widthPct}%` }}>
              {lines.map((ln, j) => (
                <span key={j} className="artmode__placard-title artmode__placard-line">{ln}</span>
              ))}
              {(p.meta.artist || p.meta.date) && (
                <span className="artmode__placard-artist artmode__placard-line">
                  {smartQuotes([p.meta.artist, p.meta.date].filter(Boolean).join(' · '))}
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
