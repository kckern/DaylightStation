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
import ArtLayer from './ArtLayer.jsx';
import ArtPlacards from './ArtPlacards.jsx';
import { resolveAdvance } from './resolveAdvance.js';
import './ArtMode.css';

const DIM_STEP = 0.1;
const DIM_MAX = 0.85;
const EXIT_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Escape', 'Esc']);
const NEXT_KEYS = new Set(['ArrowLeft', 'ArrowRight']);
const BRIGHTER_KEYS = new Set(['ArrowUp']);
const DIMMER_KEYS = new Set(['ArrowDown']);
// Keys that cycle the view mode (ratio/frame). Tab is the universal fallback;
// screens add device-specific keys via screensaver `props.cycleKeys` (e.g. the
// living-room Shield remote's Rewind arrives as raw `MediaRewind`, keyCode 227).
const DEFAULT_CYCLE_KEYS = ['Tab'];
const round2 = (n) => Math.round(n * 100) / 100;
const DEFAULT_FRAME = { top: 11.9, right: 6.5, bottom: 11.1, left: 7.0 };
const CURTAIN_MIN_MS = 700;   // never part the curtain before this (minimum effect)
const CURTAIN_MAX_MS = 8000;  // safety rail: always part by this, even if assets stall
const CURTAIN_CLOSE_MS = 1400; // matches the .artmode__curtain-panel transition (ArtMode.css)
const CROSSFADE_MS = 1200;     // default cross-dissolve duration for transition:'crossfade'
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
 *   advance         what triggers the next artwork (see resolveAdvance.js):
 *                     'hold'  (default) static until remount / manual skip
 *                     'track' new artwork each time the music advances a song
 *                     'timer' new artwork every intervalSec seconds
 *                     'auto'  music → track, else interval → timer, else hold
 *   transition      how the artwork changes: 'curtains' (default, velvet drape)
 *                   or 'crossfade' (cross-dissolve — the slideshow look)
 *   intervalSec     timer period in seconds (advance 'timer'/'auto')
 *   crossfadeMs     cross-dissolve duration ms (transition 'crossfade')
 *   defaultViewMode initial view mode name (default 'gallery')
 *   measureText     optional (s)=>px text measurer (test seam; canvas in browser)
 */
function ArtMode({
  placard = true, onExit, dismiss,
  frame = DEFAULT_FRAME, matMargin = 4, cropMaxPerSide = 8, ambient = null,
  defaultViewMode = 'gallery', measureText = null,
  curtainMinMs = CURTAIN_MIN_MS, curtainMaxMs = CURTAIN_MAX_MS, curtainCloseMs = CURTAIN_CLOSE_MS,
  music = null, collection = null,
  advance = 'hold', transition = 'curtains', intervalSec = null, crossfadeMs = CROSSFADE_MS,
  rawKeys = true, cycleKeys = DEFAULT_CYCLE_KEYS,
}) {
  const [art, setArt] = useState(null);
  const [failed, setFailed] = useState(false);

  // Concrete advance trigger + transition style. `effectiveAdvance` collapses the
  // (advance, music, interval) config — including the 'auto' fallback chain — into
  // one of 'hold' | 'track' | 'timer' (resolveAdvance.js). `isCrossfade` swaps the
  // velvet curtain for a stacked cross-dissolve (ArtLayer planes).
  const intervalMs = Number(intervalSec) > 0 ? Number(intervalSec) * 1000 : 0;
  const effectiveAdvance = resolveAdvance({ advance, hasMusic: !!music, intervalMs });
  const isCrossfade = transition === 'crossfade';

  // Crossfade planes: each is a fully self-contained matted picture (ArtLayer) that
  // dissolves in over the one beneath. A plane is revealed (opacity → 1) only once
  // all its panel images have painted, then older planes are pruned a crossfade later.
  const [layers, setLayers] = useState([]);          // [{ key, art }] oldest → newest
  const [visibleKeys, setVisibleKeys] = useState(() => new Set());
  const layerSeqRef = useRef(0);
  const crossfadeTimersRef = useRef([]);

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
    crossfadeTimersRef.current.forEach(clearTimeout);
    crossfadeTimersRef.current = [];
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

  const featuredUrl = collection
    ? `api/v1/art/featured?collection=${encodeURIComponent(collection)}`
    : 'api/v1/art/featured';

  // Reveal a freshly-painted plane, then prune everything beneath it a crossfade
  // later (by which point the dissolve has fully covered them).
  const onLayerReady = useCallback((key) => {
    if (!mountedRef.current) return;
    setVisibleKeys((prev) => { const n = new Set(prev); n.add(key); return n; });
    const t = setTimeout(() => {
      if (!mountedRef.current) return;
      setLayers((prev) => prev.filter((l) => l.key >= key));
      setVisibleKeys((prev) => { const n = new Set([...prev].filter((k) => k >= key)); return n; });
    }, crossfadeMs);
    crossfadeTimersRef.current.push(t);
  }, [crossfadeMs]);

  // Crossfade path: fetch the next artwork and stack it as a new plane. It mounts
  // hidden (opacity 0) and dissolves in once its images paint (onLayerReady). No
  // curtain is involved — the planes themselves are the transition.
  const loadCrossfade = useCallback(() => {
    DaylightAPI(featuredUrl)
      .then((data) => {
        if (!mountedRef.current || !data?.panels?.length) return;
        const key = (layerSeqRef.current += 1);
        setLayers((prev) => [...prev, { key, art: data }]);
        logger.info('artmode.crossfade.load', { key, count: data.panels.length });
      })
      .catch((err) => logger.error('artmode.load-failed', { error: err.message }));
  }, [featuredUrl, logger]);

  const loadCurtain = useCallback(() => {
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
  }, [logger, clearCurtainTimers, openCurtain, setCurtain, commitPending, curtainMaxMs, curtainCloseMs, featuredUrl]);

  // Single entry point both the mount load and every advance go through; it picks
  // the active transition (cross-dissolve planes vs. the velvet curtain swap).
  const load = useCallback(
    () => (isCrossfade ? loadCrossfade() : loadCurtain()),
    [isCrossfade, loadCrossfade, loadCurtain],
  );

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
    if (effectiveAdvance !== 'track') { setDisplayTrack(musicTrack); return; }
    if (firstTrackRef.current) { firstTrackRef.current = false; setDisplayTrack(musicTrack); return; }
    // Curtain swaps pin the plaque so it changes WITH the art behind the drape; a
    // crossfade has no closed cover, so the plaque just follows the song live.
    if (isCrossfade) setDisplayTrack(musicTrack);
    else plaqueGateRef.current = true;
    logger.info('artmode.advance', { trigger: 'track', title: musicTrack.title });
    load();
  }, [musicTrack, effectiveAdvance, isCrossfade, load, logger]);

  // Timer advance: step the artwork every intervalMs (advance 'timer', or 'auto'
  // with no music). Music-independent; works with either transition.
  useEffect(() => {
    if (effectiveAdvance !== 'timer' || intervalMs <= 0) return undefined;
    const id = setInterval(() => load(), intervalMs);
    logger.info('artmode.timer.start', { intervalMs });
    return () => clearInterval(id);
  }, [effectiveAdvance, intervalMs, load, logger]);

  // Advance both song and art. With advance:'track', skipping the song re-picks the
  // artwork via the effect above (so no double-load); otherwise reload the art directly.
  const goNext = useCallback(() => { musicNext(); if (effectiveAdvance !== 'track') load(); }, [musicNext, effectiveAdvance, load]);
  const goPrev = useCallback(() => { musicPrev(); if (effectiveAdvance !== 'track') load(); }, [musicPrev, effectiveAdvance, load]);

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
  // View-mode cycle keys: configured per-screen, always including the Tab fallback.
  const cycleKeySet = useMemo(
    () => new Set([...(Array.isArray(cycleKeys) ? cycleKeys : DEFAULT_CYCLE_KEYS), 'Tab']),
    [cycleKeys],
  );
  // Raw-key control for keyboard / remotes whose buttons arrive as standard keys.
  // Disabled (rawKeys:false) on presets shown on macro-keypad screens, where those
  // keypads emit semantic ActionBus actions AND spurious companion nav keys — letting
  // the raw handler run there would double-trigger view-mode/shuffle/brightness.
  useEffect(() => {
    if (!rawKeys) return undefined;
    const onKey = (e) => {
      const k = e.key;
      const isCycle = cycleKeySet.has(k);
      if (!(EXIT_KEYS.has(k) || NEXT_KEYS.has(k) || BRIGHTER_KEYS.has(k) || DIMMER_KEYS.has(k) || isCycle)) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (isCycle) {
        setModeIdx((i) => (e.shiftKey ? prevMode(i) : nextMode(i)));
        logger.info('artmode.viewmode', { dir: e.shiftKey ? 'prev' : 'next', key: k });
      } else if (EXIT_KEYS.has(k)) { logger.info('artmode.exit', { key: k }); exit(); }
      else if (NEXT_KEYS.has(k)) { logger.info('artmode.shuffle', { key: k }); (k === 'ArrowLeft' ? goPrev : goNext)(); }
      else if (BRIGHTER_KEYS.has(k)) setManualBias((b) => round2(b - DIM_STEP));
      else setManualBias((b) => round2(b + DIM_STEP));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exit, goNext, goPrev, logger, rawKeys, cycleKeySet]);

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

  // Crossfade placards live in a shared overlay (ArtPlacards) so they choreograph
  // their own label change instead of dissolving with the layer. Drive them off the
  // newest *visible* plane so the nameplate transitions in step with the picture it
  // describes (and never leads it, while the next plane is still painting in).
  const topArt = useMemo(() => {
    const visible = layers.filter((l) => visibleKeys.has(l.key));
    const top = visible.length ? visible[visible.length - 1] : layers[layers.length - 1];
    return top?.art ?? null;
  }, [layers, visibleKeys]);

  return (
    <div className="artmode" data-testid="artmode" data-mode={mode.name} style={matteVars}>
      <div className="artmode__stage" ref={stageRef}>

        {/* Crossfade (slideshow): each artwork is a self-contained plane that
            dissolves in over the one beneath; the planes ARE the transition. */}
        {isCrossfade && layers.map((layer) => (
          <ArtLayer
            key={layer.key}
            art={layer.art}
            mode={mode}
            frame={frame}
            matMargin={matMargin}
            cropMaxPerSide={cropMaxPerSide}
            placard={false}
            stage={stage}
            fontPx={fontPx}
            measure={measure}
            frameSrc={frameSrc}
            visible={visibleKeys.has(layer.key)}
            transitionMs={crossfadeMs}
            onImageLoad={() => onLayerReady(layer.key)}
          />
        ))}

        {/* Crossfade nameplates: a persistent overlay above the dissolving planes so
            each placard fades its engraving out, resizes the plate (width/centre
            FLIP) to the new title, then fades back in — instead of cross-dissolving
            with the picture. Driven by the newest visible plane (topArt). */}
        {isCrossfade && placard && topArt && (
          <ArtPlacards
            art={topArt}
            mode={mode}
            frame={frame}
            matMargin={matMargin}
            cropMaxPerSide={cropMaxPerSide}
            stage={stage}
            fontPx={fontPx}
            measure={measure}
            animate
          />
        )}

        {/* Curtain transition (default): one matted picture under a velvet drape
            that closes over each swap and parts once the new art has loaded. */}
        {!isCrossfade && (
          <>
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
          </>
        )}

        {/* Shared overlays (both transitions). */}
        {music && (
          <audio ref={musicRef} className="artmode__audio" data-role="artmode-music" data-testid="artmode-music" />
        )}

        {/* Steel music nameplate. In hold mode it transitions on each song change
            (fade out → resize → fade in); in track mode it swaps behind the
            curtain (animate=false). Hidden in bare modes (no frame). */}
        {music && mode.frame && (
          <MusicPlaque track={displayTrack} animate={effectiveAdvance !== 'track'} />
        )}

        <div className="artmode__dim" data-testid="artmode-dim" aria-hidden="true" style={{ opacity: dim }} />
      </div>
    </div>
  );
}

export default ArtMode;
