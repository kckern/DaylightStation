/**
 * EmulatorConsole — host-agnostic UI wrapper that drives an EmulatorSession.
 *
 * Renders three full-bleed layers (chrome bezel, emulator mount, shader/anim)
 * plus a governance overlay, and owns the session lifecycle:
 *   create engine + mixer + session → start({mount}) → enforce/poll governance.
 *
 * DECOUPLING INVARIANT: this module is fitness-agnostic. Everything
 * fitness-specific (governance gate, identity, action handlers) arrives via
 * props. It must NOT import from modules/Fitness or context/FitnessContext.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { createEmulatorEngine } from './core/EmulatorEngine.js';
import { createAudioMixer } from './audio/AudioMixer.js';
import { createEmulatorSession } from './core/EmulatorSession.js';
import { createHtmlAudioClip } from './audio/htmlAudioClip.js';
import { ControllerStatus } from './input/ControllerStatus.jsx';
import { TouchVolumeButtons, logVolumeFromLevel } from '@/modules/Fitness/player/panels/TouchVolumeButtons.jsx';
import { createHotspotController } from './core/hotspotController.js';
import { resolveOverlayValue, formatOverlayValue } from './core/resolveOverlayValue.js';
import { HotspotLayer } from './ui/HotspotLayer.jsx';
import { OverlayLayer } from './ui/OverlayLayer.jsx';
import './EmulatorConsole.scss';

const STATUS_POLL_MS = 500;
const DEFAULT_VOLUME_LEVEL = 70; // log curve: ~25% output — audible default (not muted)

// LCD shade tints (multiplied over the screen). Subtle, pale colours so the game
// reads through them like tinted glass. Cycled from the settings sheet.
const LCD_SHADES = [
  { name: 'Green', color: '#c6d2a2' },
  { name: 'Olive', color: '#bcc88a' },
  { name: 'Amber', color: '#d8c8a0' },
  { name: 'Blue', color: '#aebfd0' },
  { name: 'Gray', color: '#cfcfcf' },
];
const SHADE_STORAGE_KEY = 'emulator:lcd-shade';
const VOLUME_STORAGE_KEY = 'emulator:volume-level';
const ANIM_DURATION_MS = 1000;
const PAIR_DURATION_MS = 30000;
const PAIR_ENDPOINT = '/api/v1/emulator/bt/pair';

const DEFAULT_FACTORIES = {
  createEngine: createEmulatorEngine,
  createMixer: createAudioMixer,
  createSession: createEmulatorSession,
  createClip: createHtmlAudioClip,
};

/**
 * Pure integer-lock geometry: largest integer scale N where an
 * N×nativeW × N×nativeH device-px box fits the cutout, centered + pixel-snapped.
 * Exported for unit testing; the layout effect calls it with measured values.
 */
export function computeScreenBox({ cut, dpr, native }) {
  const nw = native && Number.isFinite(native.width) ? native.width : 160;
  const nh = native && Number.isFinite(native.height) ? native.height : 144;
  const scale = Math.max(1, Math.min(
    Math.floor((cut.width * dpr) / nw),
    Math.floor((cut.height * dpr) / nh),
  ));
  const width = (scale * nw) / dpr;
  const height = (scale * nh) / dpr;
  const left = Math.round((cut.left + (cut.width - width) / 2) * dpr) / dpr;
  const top = Math.round((cut.top + (cut.height - height) / 2) * dpr) / dpr;
  const cell = scale / dpr;
  return { left, top, width, height, cell, scale };
}

/**
 * Capture the resume blob(s) for a save mode. Battery captures BOTH a state
 * snapshot and the .srm; state captures only the snapshot. Returns
 * { state?, battery? } or null when nothing was captured.
 */
function captureForMode(engine, saveMode) {
  if (saveMode === 'state') {
    const state = engine.captureState?.();
    return state ? { state } : null;
  }
  if (saveMode === 'battery') {
    const captured = {};
    const state = engine.captureState?.();
    if (state) captured.state = state;
    const battery = engine.captureSave?.();
    if (battery) captured.battery = battery;
    return Object.keys(captured).length ? captured : null;
  }
  return null;
}

function overlayText(status) {
  if (status.state === 'warning') {
    const grace = status.graceMsLeft != null ? ` ${Math.ceil(status.graceMsLeft / 1000)}s` : '';
    return `Keep moving!${grace}`;
  }
  if (status.state === 'depleted') return 'Out of credit — earn more!';
  // paused
  return 'Paused — meet the zone to continue';
}

export function EmulatorConsole({
  game,
  engineConfig,
  governanceGate,
  identity,
  actionHandlers = {},
  resolveMediaUrl = (p) => p,
  onExit,
  // Bezel control surface: hotspots (clickable engravings) + overlays
  // (environmental UI). Defaults to the game's own `presentation` block; a
  // host may override. `overlayData` is the injected data bag overlays read
  // (e.g. { 'fitness.heart_rate': 142, 'session.current_player': {...} }).
  presentation: presentationProp,
  overlayData: overlayDataProp = {},
  // Per-user save/resume contract from the host (saveMode/persist/userId +
  // loadResume/saveResume/clearResume). Drives boot-time resume injection,
  // persist-on-exit, and the reset hotspot. Null ⇒ anonymous, no persistence.
  persistence = null,
  // Interval in seconds to auto-persist the resume blob while playing.
  // Keyed on persistence?.persist/userId so claiming post-mount starts it.
  autosaveSeconds = 15,
  // Now-playing person ({ name, avatarSrc }) for the player overlay, and the
  // launch timestamp for the count-up play timer.
  nowPlaying = null,
  playStartedAt = null,
  factories,
  // Controller panel
  controllers = [],
  btInventory,
  pairing,
  onPairController,
  getGamepads,
  fetchImpl = () => globalThis.fetch,
}) {
  const fns = useMemo(() => ({ ...DEFAULT_FACTORIES, ...(factories || {}) }), [factories]);
  // Per-mount correlation id: stamped on every console/session/engine/mixer event
  // so one play session greps end-to-end. (Math.random is fine — this only needs
  // to be unique within a log window, not cryptographic.)
  const playId = useMemo(() => `play-${Math.random().toString(36).slice(2, 10)}`, []);
  const logger = useMemo(() => getLogger().child({ component: 'emulator-console', playId }), [playId]);

  const mountRef = useRef(null);
  const consoleRef = useRef(null);
  const runtimeRef = useRef(null); // { engine, mixer, session }
  const gridCanvasRef = useRef(null);
  const volumeLevelRef = useRef(DEFAULT_VOLUME_LEVEL); // latest volume for the boot apply
  const controllerRef = useRef(null); // hotspot controller
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  // Stable indirection so the mount-once hotspot controller can open the (live)
  // reset confirm modal without being recreated.
  const openResetRef = useRef(null);
  openResetRef.current = () => setResetOpen(true);

  const presentation = presentationProp || game?.presentation || {};
  const hotspots = presentation.hotspots || [];
  const overlays = presentation.overlays || [];

  const [status, setStatus] = useState(() => governanceGate?.getStatus?.() || { state: 'playing' });
  const [gameState, setGameState] = useState({});
  const [, setHotspotState] = useState({ volume: 1, muted: false, paused: false });
  const [animClass, setAnimClass] = useState('');
  // Boot error state — now actually RENDERED (was previously discarded, making
  // setError a no-op). `bootNonce` re-runs the boot effect for a clean retry.
  const [error, setError] = useState(null);
  const [bootNonce, setBootNonce] = useState(0);
  const retryBoot = useCallback(() => {
    logger.info('emulator.console.retry', { fromError: error?.kind || null });
    setError(null);
    setBootNonce((n) => n + 1);
  }, [logger, error]);
  const animTimerRef = useRef(null);

  // Persistence held in a ref so the mount-once effect's cleanup reads the latest
  // contract without re-running the boot effect.
  const persistenceRef = useRef(persistence);
  persistenceRef.current = persistence;

  // Reset ("start over") confirm modal.
  const [resetOpen, setResetOpen] = useState(false);

  // Count-up play timer (seconds since launch), ticked every 1s.
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (!playStartedAt) return undefined;
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - playStartedAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [playStartedAt]);

  // Continuous autosave: once the session is save-enabled AND user-scoped,
  // capture + persist the resume blob(s) every autosaveSeconds. Re-runs when
  // persistence flips active (the claim path), so saving starts without remount.
  useEffect(() => {
    if (!autosaveSeconds || !persistence?.persist || !persistence?.userId) return undefined;
    const id = setInterval(() => {
      const cur = persistenceRef.current;
      const eng = runtimeRef.current?.engine;
      if (!eng || !cur?.persist || !cur?.userId || !cur?.saveResume) return;
      const captured = captureForMode(eng, cur.saveMode);
      if (!captured) return;
      Promise.resolve(cur.saveResume(captured))
        .then((result) => {
          if (result?.status === 'ok') logger.debug('emulator.console.autosaved', { saveMode: cur.saveMode });
          else if (result?.status !== 'skipped') logger.warn('emulator.console.autosave-failed', { saveMode: cur.saveMode, status: result?.status ?? 'unknown' });
        })
        .catch((err) => logger.warn('emulator.console.autosave-failed', { error: err && err.message }));
    }, autosaveSeconds * 1000);
    return () => clearInterval(id);
  }, [autosaveSeconds, persistence?.persist, persistence?.userId, persistence?.saveMode, logger]);

  // Merge host overlayData with the live now-playing person, play timer, and the
  // coin placeholder so the bezel's player/timer/coins slots resolve.
  const overlayData = useMemo(() => ({
    ...overlayDataProp,
    'session.current_player': nowPlaying
      ? { name: nowPlaying.name, avatar: nowPlaying.avatarSrc }
      : (overlayDataProp['session.current_player'] ?? null),
    'session.play_seconds': elapsedSec,
    // Coins economy not built yet — render a literal placeholder.
    'session.coins': overlayDataProp['session.coins'] ?? '—',
  }), [overlayDataProp, nowPlaying, elapsedSec]);

  // Controller panel: visibility + console-managed local pairing state.
  const [panelOpen, setPanelOpen] = useState(false);
  const [localPairing, setLocalPairing] = useState(null);
  const pairTimerRef = useRef(null);

  // Settings modal (volume + LCD shade) — the speaker button on the bezel.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(() => {
    try {
      const saved = Number(window.localStorage?.getItem(VOLUME_STORAGE_KEY));
      return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : DEFAULT_VOLUME_LEVEL;
    } catch { return DEFAULT_VOLUME_LEVEL; }
  });
  const [shadeIndex, setShadeIndex] = useState(() => {
    try {
      const saved = Number(window.localStorage?.getItem(SHADE_STORAGE_KEY));
      return Number.isInteger(saved) && saved >= 0 && saved < LCD_SHADES.length ? saved : 0;
    } catch { return 0; }
  });
  const shade = LCD_SHADES[shadeIndex] || LCD_SHADES[0];
  const cycleShade = useCallback(() => {
    setShadeIndex((i) => {
      const next = (i + 1) % LCD_SHADES.length;
      try { window.localStorage?.setItem(SHADE_STORAGE_KEY, String(next)); }
      catch (err) { logger.debug('emulator.console.localstorage-failed', { key: SHADE_STORAGE_KEY, error: err && err.message }); }
      return next;
    });
  }, [logger]);

  // ── Integer-locked LCD geometry ──────────────────────────────────────────
  // The dot-matrix grid is only uniform AND aligned with the game's pixels when
  // the screen box is an EXACT integer multiple of the game's NATIVE framebuffer
  // (config-driven per-game `native` {width,height} — e.g. GB 160×144, GBA
  // 240×160), measured in *device* pixels, with the grid period equal to that
  // integer scale. Anything fractional — a `%` cutout (41.667% → 800.006px) or a
  // `calc(100%/nativeW)` per-cell size — accumulates sub-pixel rounding across
  // the cells, so some grid lines land 1 device px thicker than others (uneven
  // thickness) and the grid drifts off the game pixels (the offset/moiré the
  // user sees). Fix: measure the console, pick the largest integer scale that
  // fits the cutout, and pin an exact box — pillar/letterboxing the slack inside
  // the bezel. The box origin is snapped to a whole device pixel too (a
  // fractional left/top re-blurs the 1px lines). The pure math lives in
  // computeScreenBox (exported, unit-tested); this effect only measures + sets.
  const [screenBox, setScreenBox] = useState(null);
  useLayoutEffect(() => {
    const root = consoleRef.current;
    if (!root) return undefined;
    const compute = () => {
      const rect = root.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      const sc = game?.presentation?.screen;
      const hasCut = sc && Number.isFinite(sc.x);
      const cut = {
        left: hasCut ? (sc.x / 100) * rect.width : 0,
        top: hasCut ? (sc.y / 100) * rect.height : 0,
        width: hasCut ? (sc.width / 100) * rect.width : rect.width,
        height: hasCut ? (sc.height / 100) * rect.height : rect.height,
      };
      const next = computeScreenBox({ cut, dpr, native: game?.native });
      setScreenBox((prev) => (prev && prev.scale === next.scale && prev.left === next.left
        && prev.top === next.top && prev.width === next.width && prev.height === next.height
        ? prev : next));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(root);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
  }, [game]);

  // ── Canvas LCD grid — device-pixel-exact, no moiré at any DPR ─────────
  // CSS gradients with a fractional px period (scale/dpr) cause moiré because
  // sub-pixel rounding differs cell to cell. Drawing on a canvas whose pixel
  // dimensions are set to integer device pixels and whose grid lines fall at
  // exact integer positions (multiples of `scale`) eliminates this entirely.
  // Works at any DPR, including non-integer multipliers like 1.05.
  useEffect(() => {
    if (!screenBox) return;
    const canvas = gridCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const devW = Math.round(screenBox.width * dpr);
    const devH = Math.round(screenBox.height * dpr);
    canvas.width = devW;
    canvas.height = devH;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, devW, devH);
    ctx.strokeStyle = 'rgba(0,0,0,0.20)';
    ctx.lineWidth = 1;
    const s = screenBox.scale;
    for (let x = s; x < devW; x += s) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, devH); ctx.stroke();
    }
    for (let y = s; y < devH; y += s) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(devW, y + 0.5); ctx.stroke();
    }
  }, [screenBox]);

  // Diagnostic: log live gamepad input (pressed button indices + active axes)
  // exactly as the browser reports it — the source of truth for EmulatorJS
  // mappings (e.g. D-pad on buttons 12-15 vs axes). Logs only on state change.
  useEffect(() => {
    let raf;
    let lastSig = '';
    const read = () => {
      const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp) continue;
        const buttons = [];
        (gp.buttons || []).forEach((btn, i) => { if (btn && btn.pressed) buttons.push(i); });
        const axes = (gp.axes || [])
          .map((a, i) => (Math.abs(a) > 0.5 ? `${i}:${a > 0 ? '+' : '-'}` : null))
          .filter(Boolean);
        if (buttons.length || axes.length) {
          const sig = `${gp.index}|${buttons.join(',')}|${axes.join(',')}`;
          if (sig !== lastSig) {
            lastSig = sig;
            logger.info('emulator.gamepad.input', { slot: gp.index, id: gp.id, mapping: gp.mapping, buttons, axes });
          }
        }
      }
      raf = requestAnimationFrame(read);
    };
    raf = requestAnimationFrame(read);
    return () => cancelAnimationFrame(raf);
  }, [logger]);

  // Apply a touch-volume level (0..100, log curve) to the emulator's game bus.
  // Also resumes the audio engine, since browsers gate autoplay until a gesture.
  volumeLevelRef.current = volumeLevel;
  const applyVolume = useCallback((level) => {
    setVolumeLevel(level);
    volumeLevelRef.current = level;
    try { window.localStorage?.setItem(VOLUME_STORAGE_KEY, String(level)); }
    catch (err) { logger.debug('emulator.console.localstorage-failed', { key: VOLUME_STORAGE_KEY, error: err && err.message }); }
    const v = logVolumeFromLevel(level);
    runtimeRef.current?.mixer?.setBusVolume?.('game', v);
    runtimeRef.current?.engine?.resume?.();
    logger.info('emulator.console.volume-applied', { reason: 'change', level, volume: v, bus: 'game' });
  }, [logger]);

  // Re-assert the saved volume on the game bus whenever the settings panel opens.
  // This is the path that historically "made the volume finally take" — now it is
  // explicit and logged, instead of an accidental side effect.
  useEffect(() => {
    if (!settingsOpen) return;
    const level = volumeLevelRef.current;
    const v = logVolumeFromLevel(level);
    runtimeRef.current?.mixer?.setBusVolume?.('game', v);
    logger.info('emulator.console.volume-applied', { reason: 'panel-open', level, volume: v, bus: 'game' });
  }, [settingsOpen, logger]);

  // Internal default pairing trigger: POST to this app's own backend, then flip
  // local pairing to scanning → done (or error). Host can override via
  // `onPairController`, or feed a `pairing` prop to drive the UI directly.
  const defaultPair = useCallback(async () => {
    if (pairTimerRef.current) {
      clearTimeout(pairTimerRef.current);
      pairTimerRef.current = null;
    }
    setLocalPairing({ phase: 'scanning', durationMs: PAIR_DURATION_MS });
    logger.info('emulator.console.pair-start', { durationMs: PAIR_DURATION_MS });
    try {
      const doFetch = fetchImpl();
      if (typeof doFetch !== 'function') throw new Error('no fetch implementation');
      const res = await doFetch(PAIR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationMs: PAIR_DURATION_MS }),
      });
      if (res && res.ok === false) throw new Error(`pair request failed (${res.status})`);
      pairTimerRef.current = setTimeout(() => {
        setLocalPairing({ phase: 'done' });
        pairTimerRef.current = null;
        logger.info('emulator.console.pair-done', {});
      }, PAIR_DURATION_MS);
    } catch (err) {
      const message = (err && err.message) || 'pairing failed';
      setLocalPairing({ phase: 'error', message });
      logger.warn('emulator.console.pair-error', { error: message });
    }
  }, [fetchImpl, logger]);

  const effectiveOnPair = onPairController || defaultPair;
  // Host-provided pairing prop takes precedence over console-managed local state.
  const effectivePairing = pairing ?? localPairing;

  // Reset / "start over": erase the user's save, then restart the ROM fresh.
  const confirmReset = useCallback(async () => {
    setResetOpen(false);
    const p = persistenceRef.current;
    try { if (p?.clearResume) await p.clearResume(); }
    catch (err) { logger.warn('emulator.console.reset-clear-failed', { error: err && err.message }); }
    try { runtimeRef.current?.engine?.restart?.(); }
    catch (err) { logger.warn('emulator.console.reset-restart-failed', { error: err && err.message }); }
    logger.info('emulator.console.reset', { game: game?.id, user: p?.userId || null });
  }, [game, logger]);

  // Console-owned animation handler: flash a transient CSS class on the shader.
  const triggerAnim = (name) => {
    if (!name) return;
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    setAnimClass(`emu-anim-${name}`);
    animTimerRef.current = setTimeout(() => {
      setAnimClass('');
      animTimerRef.current = null;
    }, ANIM_DURATION_MS);
    logger.debug('emulator.console.animation', { name });
  };

  useEffect(() => {
    let unsub = null;
    let interval = null;
    let cancelled = false;

    const mountedAt = Date.now();
    logger.info('emulator.console.mount', { game: game?.id, system: game?.system });

    const engine = fns.createEngine({ logger });
    const mixer = fns.createMixer({
      setGameVolume: engine.setVolume,
      createClip: fns.createClip,
      logger,
    });

    const mergedHandlers = { ...actionHandlers, animation: (name) => triggerAnim(name) };

    const session = fns.createSession({
      engine,
      mixer,
      governanceGate,
      game,
      engineConfig,
      actionHandlers: mergedHandlers,
      deps: { resolveMediaUrl },
      logger,
    });

    runtimeRef.current = { engine, mixer, session };

    // Bezel hotspot controller: built-in player verbs (volume/mute/pause/
    // save_state/exit) drive engine+mixer here; `do:` blocks reuse the
    // session's binding handler map via runActions.
    controllerRef.current = createHotspotController({
      mixer,
      engine,
      onExit: () => onExitRef.current?.(),
      onReset: () => openResetRef.current?.(),
      runActions: (doMap, ctx) => session.runActions?.(doMap, ctx),
      saveState: actionHandlers.saveState,
      onChange: (s) => setHotspotState(s),
      logger,
    });
    setHotspotState(controllerRef.current.getState());

    // Kick off boot/start asynchronously; never block render.
    Promise.resolve()
      .then(() => session.start({ mount: mountRef.current }))
      .then(async (res) => {
        if (cancelled) return;
        // Apply the persisted (or default) volume to the game bus on boot — and
        // LOG it (info), so "did the saved volume take on load?" is answerable.
        const level = volumeLevelRef.current;
        const gameVol = logVolumeFromLevel(level);
        mixer.setBusVolume?.('game', gameVol);
        logger.info('emulator.console.volume-applied', {
          reason: 'boot',
          level,
          volume: gameVol,
          bus: 'game',
          isDefault: level === DEFAULT_VOLUME_LEVEL,
        });
        const audioCtxState = runtimeRef.current?.engine?.getAudioContextState?.() ?? 'unavailable';
        logger.info('emulator.console.started', { game: game?.id, wramBase: res?.wramBase, audioContext: audioCtxState });

        // Success = OBSERVED, not resolved: confirm the game actually rendered a
        // frame. A booted-but-blank screen (e.g. a stale single-instance reuse)
        // trips the error/retry state instead of silently showing nothing.
        const rendered = await engine.confirmFirstFrame?.({ core: engineConfig?.core });
        if (cancelled) return;
        if (rendered === false) {
          logger.error('emulator.console.no-frames', { game: game?.id });
          setError({ kind: 'no-frames', message: 'The game booted but never appeared.' });
          return;
        }

        // Inject the user's resume blob (battery .srm or save-state) after boot.
        // saveClient returns a discriminated result so an absent save and a
        // failed load are distinct — a failed load is surfaced, never silent.
        const p = persistenceRef.current;
        if (p?.loadResume) {
          try {
            const result = await p.loadResume();
            if (cancelled) return;
            if (result?.status === 'ok' && result.data) {
              const ok = engine.loadResume(result.kind || p.saveMode, result.data);
              logger.info('emulator.console.resume-loaded', { ok, kind: result.kind || p.saveMode });
            } else if (result?.status === 'error') {
              logger.warn('emulator.console.resume-load-failed', { saveMode: p.saveMode, httpStatus: result.httpStatus ?? null });
            } else {
              logger.info('emulator.console.resume-absent', { saveMode: p.saveMode });
            }
          } catch (err) {
            logger.warn('emulator.console.resume-failed', { error: err && err.message });
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('emulator.console.start-error', { error: err && err.message });
        setError({ kind: 'start-error', message: err && err.message, error: err });
      });

    // Seed + subscribe + poll governance status.
    const refresh = () => {
      try {
        setStatus(governanceGate.getStatus());
      } catch (err) {
        logger.warn('emulator.console.status-error', { error: err && err.message });
      }
      // Poll the live semantic state map so game-state-driven overlays
      // (e.g. badge meters) stay current.
      try {
        const gs = runtimeRef.current?.session?.getGameState?.();
        if (gs) setGameState(gs);
      } catch (err) {
        logger.warn('emulator.console.gamestate-error', { error: err && err.message });
      }
    };
    refresh();
    if (typeof governanceGate?.onChange === 'function') {
      unsub = governanceGate.onChange(() => refresh());
    }
    interval = setInterval(refresh, STATUS_POLL_MS);

    return () => {
      cancelled = true;
      const playDurationMs = Date.now() - mountedAt;
      logger.info('emulator.console.unmount', { game: game?.id, playDurationMs });
      if (interval) clearInterval(interval);
      if (typeof unsub === 'function') unsub();
      if (animTimerRef.current) {
        clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
      // Persist the resume point on exit (battery .srm or save-state) BEFORE
      // teardown, for an identified, save-enabled session. The write outlives
      // this synchronous cleanup, but its OUTCOME is logged when it settles —
      // never a silent .catch(() => {}). A failed save is a logged warn.
      try {
        const p = persistenceRef.current;
        const eng = runtimeRef.current?.engine;
        if (p?.persist && p?.saveResume) {
          const captured = captureForMode(eng, p.saveMode);
          if (captured) {
            logger.info('emulator.console.persist-start', { saveMode: p.saveMode });
            Promise.resolve(p.saveResume(captured))
              .then((result) => {
                if (result?.status === 'ok') logger.info('emulator.console.persisted', { saveMode: p.saveMode });
                else logger.warn('emulator.console.persist-failed', { saveMode: p.saveMode, status: result?.status ?? 'unknown', httpStatus: result?.httpStatus ?? null });
              })
              .catch((err) => logger.warn('emulator.console.persist-failed', { saveMode: p.saveMode, error: err && err.message }));
          } else {
            logger.warn('emulator.console.persist-skipped', { saveMode: p.saveMode, reason: 'no-bytes' });
          }
        }
      } catch (err) {
        logger.warn('emulator.console.persist-failed', { error: err && err.message });
      }
      try {
        runtimeRef.current?.session?.destroy();
      } catch (err) {
        logger.warn('emulator.console.destroy-error', { error: err && err.message });
      }
      runtimeRef.current = null;
    };
    // Re-runs on retry (bootNonce). Cleanup fully tears down the prior session +
    // loader memo, so each retry boots clean. Other collaborators are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootNonce]);

  // No controller nag: the panel starts collapsed and is only opened via the
  // 🎮 toggle. Keyboard always works (arrows = D-pad, Enter = Start, Space =
  // Select), so a controller-less user is never interrupted on mount.

  // Clear any pending pair timer on unmount.
  useEffect(
    () => () => {
      if (pairTimerRef.current) {
        clearTimeout(pairTimerRef.current);
        pairTimerRef.current = null;
      }
    },
    [],
  );

  const showOverlay = status.state !== 'playing';

  // Bezel screen cutout (config-driven, % of frame): position the emulator video
  // and shader pass into the bezel's window. Absent ⇒ full-bleed (CSS default).
  // Sourced from the merged `presentation` block (origin's bezel model).
  const sc = presentation?.screen;
  const screenStyle = sc && Number.isFinite(sc.x)
    ? { inset: 'auto', left: `${sc.x}%`, top: `${sc.y}%`, width: `${sc.width}%`, height: `${sc.height}%` }
    : undefined;

  // Once measured, use the exact integer-pixel box; until then fall back to the
  // % cutout so first paint isn't empty. The shader gets the same box plus the
  // integer grid period (background-size) and the shade tint.
  const pixelBox = screenBox
    ? { inset: 'auto', left: `${screenBox.left}px`, top: `${screenBox.top}px`, width: `${screenBox.width}px`, height: `${screenBox.height}px` }
    : screenStyle;
  const isDotmatrix = game?.shader === 'dotmatrix';
  const shaderStyle = {
    ...(isDotmatrix ? { ...pixelBox, backgroundColor: shade.color } : pixelBox),
  };

  // On-screen controls (native EmulatorJS menu/virtual-gamepad + our controller
  // panel) are config-gated and OFF by default — driven by hooks/api instead.
  const osd = !!presentation?.onscreen_controls;

  // Resolve + format a single overlay against the live data context. Kept inline
  // so it always reads the latest gameState/status/overlayData on re-render.
  const resolveOverlay = useCallback(
    (o) =>
      formatOverlayValue(
        o.format,
        resolveOverlayValue(o.source, { gameState, governance: status, overlayData }),
      ),
    [gameState, status, overlayData],
  );

  return (
    <div
      ref={consoleRef}
      className={`emulator-console${osd ? '' : ' emulator-console--no-osd'}`}
      data-state={status.state}
      data-chrome={game?.chrome || 'none'}
      data-shader={game?.shader || 'none'}
    >
      <div
        className={`emulator-chrome chrome-${game?.chrome || 'none'}`}
        style={game?.bezelUrl ? { backgroundImage: `url("${game.bezelUrl}")` } : undefined}
      />
      {/* The cutout is positioned on this WRAPPER, not the mount — EmulatorJS owns
          the mount element's inline styles, so it must fill an already-positioned box. */}
      <div className="emulator-screen-window" style={pixelBox}>
        <div className="emulator-mount" ref={mountRef} />
      </div>
      <div
        className={`emulator-shader shader-${game?.shader || 'none'} ${animClass}`.trim()}
        style={shaderStyle}
      >
        {isDotmatrix && <canvas ref={gridCanvasRef} className="emulator-shader-grid" aria-hidden="true" />}
      </div>
      <OverlayLayer overlays={overlays} resolve={resolveOverlay} />
      <HotspotLayer hotspots={hotspots} onActivate={(h) => controllerRef.current?.activate(h)} />
      {showOverlay && (
        <div className={`emulator-governance-overlay overlay-${status.state}`}>
          <span>{overlayText(status)}</span>
        </div>
      )}
      {error && (
        <div className="emulator-error-overlay" role="alertdialog" aria-label="Emulator error">
          <div className="emulator-error-card">
            <p className="emulator-error-message">
              {error.kind === 'no-frames'
                ? 'The game booted but never appeared.'
                : 'The game failed to load.'}
            </p>
            <div className="emulator-error-actions">
              <button type="button" className="emulator-error-retry" onClick={retryBoot}>Retry</button>
              {typeof onExit === 'function' && (
                <button type="button" className="emulator-error-exit" onClick={onExit}>Exit</button>
              )}
            </div>
          </div>
        </div>
      )}
      {typeof onExit === 'function' && (
        <button
          type="button"
          className="emulator-exit-affordance"
          aria-label="Exit emulator"
          onClick={onExit}
        >
          ✕
        </button>
      )}

      {osd && (
      <button
        type="button"
        className={`emulator-controller-toggle${panelOpen ? ' is-open' : ''}`}
        aria-label={panelOpen ? 'Hide controller panel' : 'Show controller panel'}
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((v) => !v)}
      >
        🎮
      </button>
      )}
      {osd && panelOpen && (
        <div className="emulator-controller-panel" role="dialog" aria-label="Controllers">
          <ControllerStatus
            controllers={controllers}
            btInventory={btInventory}
            getGamepads={getGamepads}
            pairing={effectivePairing}
            onPair={effectiveOnPair}
          />
        </div>
      )}

      {/* Volume — round, bottom-left on the bezel. Opens the controls sheet. */}
      <button
        type="button"
        className="emulator-settings-toggle"
        aria-label="Emulator volume & settings"
        aria-expanded={settingsOpen}
        onClick={() => { applyVolume(volumeLevel); setSettingsOpen((v) => !v); }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 6a9 9 0 0 1 0 12" />
        </svg>
      </button>
      {settingsOpen && (
        <div className="emulator-settings-modal" role="dialog" aria-modal="true" aria-label="Emulator settings">
          <div className="emulator-settings-modal__backdrop" onPointerDown={() => setSettingsOpen(false)} />
          <div className="emulator-settings-modal__sheet">
            <div className="emulator-settings-modal__header">
              <span id="emulator-volume-label">Sound · {volumeLevel}%</span>
              <button type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>✕</button>
            </div>
            <TouchVolumeButtons
              controlId="emulator-volume"
              currentLevel={volumeLevel}
              onSelect={applyVolume}
            />
            <div className="emulator-settings-modal__row">
              <span>Screen shade</span>
              <button type="button" className="emulator-shade-cycle" onClick={cycleShade}>
                <span className="emulator-shade-swatch" style={{ background: shade.color }} aria-hidden="true" />
                {shade.name}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset / "start over" confirm — raised by the power-switch hotspot. */}
      {resetOpen && (
        <div className="emulator-reset-modal" role="dialog" aria-modal="true" aria-label="Start over">
          <div className="emulator-reset-modal__backdrop" onPointerDown={() => setResetOpen(false)} />
          <div className="emulator-reset-modal__sheet">
            <div className="emulator-reset-modal__title">Start {game?.title || 'this game'} over?</div>
            <div className="emulator-reset-modal__body">
              {persistence?.persist && nowPlaying?.name
                ? `This erases ${nowPlaying.name}'s save and begins a fresh game.`
                : 'This restarts the game from the beginning.'}
            </div>
            <div className="emulator-reset-modal__actions">
              <button type="button" className="emulator-reset-modal__cancel" onPointerDown={() => setResetOpen(false)}>
                Keep playing
              </button>
              <button type="button" className="emulator-reset-modal__confirm" onPointerDown={confirmReset}>
                Start over
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EmulatorConsole;
