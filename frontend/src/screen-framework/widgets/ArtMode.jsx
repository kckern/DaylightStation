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
import { useScreenAmbient } from '../ambient/ScreenAmbientContext.jsx';
import { resolveAmbient } from './resolveAmbient.js';
import { useScreenAction } from '../input/useScreenAction.js';
import { useBackgroundMusic } from '../../lib/Player/useBackgroundMusic.js';
import MusicPlaque from './MusicPlaque.jsx';
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
const CURTAIN_CLOSE_MS = 1400; // matches the .artmode__curtain-panel transition (ArtMode.css)
const SEEK_STEP_SEC = 15;      // fwd/rew scrub grain within the current song
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
 *   advance         image-rotation mode: 'hold' (static, default) or 'track' (new
 *                   artwork each time the background music advances to a new song)
 *   defaultViewMode initial view mode name (default 'gallery')
 *   measureText     optional (s)=>px text measurer (test seam; canvas in browser)
 */
function ArtMode({
  placard = true, onExit, dismiss,
  frame = DEFAULT_FRAME, matMargin = 4, cropMaxPerSide = 8, ambient = null,
  defaultViewMode = 'gallery', measureText = null,
  curtainMinMs = CURTAIN_MIN_MS, curtainMaxMs = CURTAIN_MAX_MS, curtainCloseMs = CURTAIN_CLOSE_MS,
  music = null, collection = null,
  advance = 'hold', rawKeys = true,
}) {
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);
  const screenAmbient = useScreenAmbient();
  const resolvedAmbient = useMemo(() => resolveAmbient(screenAmbient, ambient), [screenAmbient, ambient]);
  const ambientCurve = resolvedAmbient?.curve ?? null;
  const ambientTopic = resolvedAmbient?.topic ?? 'ambient';
  const [autoDim, setAutoDim] = useState(() => (ambientCurve ? luxToDim(resolvedAmbient?.defaultLux ?? 0, ambientCurve) : 0));
  const [manualBias, setManualBias] = useState(0);
  const dim = round2(Math.max(0, Math.min(DIM_MAX, autoDim + manualBias)));
  const [revealed, setRevealed] = useState(false);   // curtain open?
  const revealedRef = useRef(false);                  // mirror of `revealed` for stable callbacks
  const setCurtain = useCallback((open) => { revealedRef.current = open; setRevealed(open); }, []);
  const loadedRef = useRef(0);                        // how many panel images have loaded
  const closeCompleteAtRef = useRef(0);               // ms-timestamp the in-flight close animation finishes
  const revealTimerRef = useRef(null);               // pending min-dwell reveal
  const maxTimerRef = useRef(null);                  // pending safety-rail reveal
  const commitTimerRef = useRef(null);               // pending behind-curtain content swap
  const pendingArtRef = useRef(null);                 // fetched art awaiting a closed curtain
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
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
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
    if (commitTimerRef.current) { clearTimeout(commitTimerRef.current); commitTimerRef.current = null; }
  }, []);

  const openCurtain = useCallback(() => {
    clearCurtainTimers();
    if (mountedRef.current) setCurtain(true);
  }, [clearCurtainTimers, setCurtain]);

  // Part the curtain once the art is ready, but never before the minimum dwell —
  // and always via a timer, so a warm-cache instant load can't skip the closed
  // paint (which would cancel the parting animation entirely). The dwell is
  // measured from when the close animation FINISHES (closeCompleteAtRef), not
  // from when the curtain dropped: the close itself takes curtainCloseMs, so
  // anchoring to the drop let the reveal fire the instant the panels met (or even
  // mid-close on a rapid re-trigger), making it look like they never shut.
  const scheduleReveal = useCallback(() => {
    if (revealTimerRef.current) return;                 // already scheduled
    const remaining = Math.max(0, (closeCompleteAtRef.current + curtainMinMs) - nowMs());
    revealTimerRef.current = setTimeout(openCurtain, remaining);
  }, [curtainMinMs, openCurtain]);

  const musicRef = useRef(null);
  const { track: musicTrack, next: musicNext, prev: musicPrev, toggle: musicToggle, seek: musicSeek } = useBackgroundMusic(musicRef, music);

  // The music plaque renders from `displayTrack`, a gated mirror of the live
  // `musicTrack`. In hold mode it follows the live track; during a track-driven
  // curtain swap it's pinned (plaqueGateRef) so the plaque changes WITH the art,
  // behind the closed curtain — never while the curtain is open.
  const [displayTrack, setDisplayTrack] = useState(null);
  const musicTrackRef = useRef(null);
  useEffect(() => { musicTrackRef.current = musicTrack; }, [musicTrack]);
  const plaqueGateRef = useRef(false);

  // Apply the buffered artwork (and, when a track swap is gated, the matching
  // music plaque) once the curtain has fully closed over the previous frame.
  const commitPending = useCallback(() => {
    commitTimerRef.current = null;
    if (!mountedRef.current) return;
    const data = pendingArtRef.current;
    if (data == null) return;
    pendingArtRef.current = null;
    setFailed(false);
    setArt(data);
    if (plaqueGateRef.current) {
      setDisplayTrack(musicTrackRef.current);
      plaqueGateRef.current = false;
    }
    logger.info('artmode.loaded', { mode: data?.mode ?? null, count: data?.panels?.length ?? 0 });
  }, [logger]);

  const load = useCallback(() => {
    // Drop the curtain (covers the swap); it parts after the MIN dwell once the
    // art loads, or by MAX at the latest (a rail so it can never stick down).
    loadedRef.current = 0;
    clearCurtainTimers();
    pendingArtRef.current = null;
    // If the curtain is currently open, the new content must not appear until the
    // drape has finished closing — even if the API returns instantly. A fresh
    // close runs for curtainCloseMs whenever the curtain was open; when it was
    // already closed/closing (mount, failed, or a rapid re-trigger) we KEEP the
    // in-flight close's completion time so a re-fire can't shorten the dwell or
    // let the reveal slip in mid-close.
    const wasOpen = revealedRef.current;
    setCurtain(false);
    const now = nowMs();
    closeCompleteAtRef.current = wasOpen
      ? now + curtainCloseMs
      : Math.max(closeCompleteAtRef.current, now);
    maxTimerRef.current = setTimeout(openCurtain, curtainMaxMs);
    const featuredUrl = collection
      ? `api/v1/art/featured?collection=${encodeURIComponent(collection)}`
      : 'api/v1/art/featured';
    DaylightAPI(featuredUrl)
      .then((data) => {
        if (!mountedRef.current) return;
        pendingArtRef.current = data;
        const remaining = Math.max(0, closeCompleteAtRef.current - nowMs());
        if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
        commitTimerRef.current = setTimeout(commitPending, remaining);
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        setFailed(true);
        logger.error('artmode.load-failed', { error: err.message });
      });
  }, [logger, clearCurtainTimers, openCurtain, setCurtain, commitPending, curtainMaxMs, curtainCloseMs, collection]);

  // If the fetch fails there are no images to wait on — part the curtain (still
  // honoring the minimum dwell so the effect never flashes by).
  useEffect(() => { if (failed) scheduleReveal(); }, [failed, scheduleReveal]);
  useEffect(() => { logger.info('artmode.mount', { placard }); load(); }, [logger, load, placard]);

  // Image-advance mode + music-plaque gating, in one effect so ordering is fixed.
  // `advance: 'hold'` (default) keeps one artwork up until remount/refresh and the
  // plaque follows each song live. `advance: 'track'` picks a fresh artwork each
  // time the music moves to a new song: the first track keeps the mount's artwork
  // and shows live; every subsequent song pins the plaque (plaqueGateRef) and
  // triggers a curtain swap so plaque + art change together behind the drape.
  const firstTrackRef = useRef(true);
  useEffect(() => {
    if (!musicTrack) return;
    if (advance !== 'track') { setDisplayTrack(musicTrack); return; }
    if (firstTrackRef.current) { firstTrackRef.current = false; setDisplayTrack(musicTrack); return; }
    plaqueGateRef.current = true;
    logger.info('artmode.advance', { trigger: 'track', title: musicTrack.title });
    load();
  }, [musicTrack, advance, load, logger]);

  // Advance both song and art. With advance:'track', skipping the song re-picks the
  // artwork via the effect above (so no double-load); otherwise reload the art directly.
  const goNext = useCallback(() => { musicNext(); if (advance !== 'track') load(); }, [musicNext, advance, load]);
  const goPrev = useCallback(() => { musicPrev(); if (advance !== 'track') load(); }, [musicPrev, advance, load]);

  // Screen-native control surface: numpad/remote → ActionBus.
  //   next/prev → advance the song (and art, per goNext/goPrev)
  //   fwd/rew   → scrub within the current song (plaque + art unchanged)
  //   pause     → play/pause the music (which holds the art in track mode)
  // Volume + escape are handled by the screen (system volume / overlay dismissal).
  useScreenAction('media:playback', useCallback((p) => {
    const c = p?.command;
    if (c === 'next') goNext();
    else if (c === 'prev') goPrev();
    else if (c === 'fwd') musicSeek(SEEK_STEP_SEC);
    else if (c === 'rew') musicSeek(-SEEK_STEP_SEC);
    else if (c === 'pause' || c === 'play' || c === 'toggle') musicToggle();
  }, [goNext, goPrev, musicSeek, musicToggle]));

  // Playback-rate button is meaningless for background music, so the office screen
  // repurposes it to cycle ArtMode's view mode (the Tab behavior) — the only way to
  // reach view-mode cycling on adapter-driven screens where rawKeys is off.
  useScreenAction('media:rate', useCallback(() => {
    setModeIdx((i) => nextMode(i));
    logger.info('artmode.viewmode', { dir: 'next', via: 'rate' });
  }, [logger]));

  // D-pad navigation (remote screens, rawKeys:false). On raw-key screens the capture
  // handler swallows the arrows first, so this never double-fires there.
  useScreenAction('navigate', useCallback((p) => {
    if (p?.direction === 'right') goNext();
    else if (p?.direction === 'left') goPrev();
  }, [goNext, goPrev]));

  const exit = useCallback(() => { (onExit || dismiss)?.(); }, [onExit, dismiss]);
  // Raw-key control for keyboard / remotes whose buttons arrive as standard keys.
  // Disabled (rawKeys:false) on presets shown on macro-keypad screens, where those
  // keypads emit semantic ActionBus actions AND spurious companion nav keys — letting
  // the raw handler run there would double-trigger view-mode/shuffle/brightness.
  useEffect(() => {
    if (!rawKeys) return undefined;
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
      else if (NEXT_KEYS.has(k)) { logger.info('artmode.shuffle', { key: k }); (k === 'ArrowLeft' ? goPrev : goNext)(); }
      else if (BRIGHTER_KEYS.has(k)) setManualBias((b) => round2(b - DIM_STEP));
      else setManualBias((b) => round2(b + DIM_STEP));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exit, goNext, goPrev, logger, rawKeys]);

  useWebSocketSubscription([ambientTopic], (msg) => {
    if (!ambientCurve || !msg) return;
    setAutoDim(luxToDim(Number(msg.lux), ambientCurve));
  }, [ambientCurve, ambientTopic]);

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

        {music && (
          <audio ref={musicRef} className="artmode__audio" data-role="artmode-music" data-testid="artmode-music" />
        )}

        {/* Steel music nameplate. In hold mode it transitions on each song change
            (fade out → resize → fade in); in track mode it swaps behind the
            curtain (animate=false). Hidden in bare modes (no frame). */}
        {music && mode.frame && (
          <MusicPlaque track={displayTrack} animate={advance !== 'track'} />
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
