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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { createEmulatorEngine } from './core/EmulatorEngine.js';
import { createAudioMixer } from './audio/AudioMixer.js';
import { createEmulatorSession } from './core/EmulatorSession.js';
import { createHtmlAudioClip } from './audio/htmlAudioClip.js';
import { ControllerStatus } from './input/ControllerStatus.jsx';
import './EmulatorConsole.scss';

const STATUS_POLL_MS = 500;
const ANIM_DURATION_MS = 1000;
const PAIR_DURATION_MS = 30000;
const PAIR_ENDPOINT = '/api/v1/emulator/bt/pair';

const DEFAULT_FACTORIES = {
  createEngine: createEmulatorEngine,
  createMixer: createAudioMixer,
  createSession: createEmulatorSession,
  createClip: createHtmlAudioClip,
};

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
  const logger = useMemo(() => getLogger().child({ component: 'emulator-console' }), []);

  const mountRef = useRef(null);
  const runtimeRef = useRef(null); // { engine, mixer, session }

  const [status, setStatus] = useState(() => governanceGate?.getStatus?.() || { state: 'playing' });
  const [animClass, setAnimClass] = useState('');
  const [, setError] = useState(null);
  const animTimerRef = useRef(null);

  // Controller panel: visibility + console-managed local pairing state.
  const [panelOpen, setPanelOpen] = useState(false);
  const [localPairing, setLocalPairing] = useState(null);
  const pairTimerRef = useRef(null);

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

    logger.info('emulator.console.mount', { game: game?.id, system: game?.system });

    const engine = fns.createEngine();
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

    // Kick off boot/start asynchronously; never block render.
    Promise.resolve()
      .then(() => session.start({ mount: mountRef.current }))
      .then((res) => {
        if (cancelled) return;
        logger.info('emulator.console.started', { game: game?.id, wramBase: res?.wramBase });
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('emulator.console.start-error', { error: err && err.message });
        setError(err);
      });

    // Seed + subscribe + poll governance status.
    const refresh = () => {
      try {
        setStatus(governanceGate.getStatus());
      } catch (err) {
        logger.warn('emulator.console.status-error', { error: err && err.message });
      }
    };
    refresh();
    if (typeof governanceGate?.onChange === 'function') {
      unsub = governanceGate.onChange(() => refresh());
    }
    interval = setInterval(refresh, STATUS_POLL_MS);

    return () => {
      cancelled = true;
      logger.info('emulator.console.unmount', { game: game?.id });
      if (interval) clearInterval(interval);
      if (typeof unsub === 'function') unsub();
      if (animTimerRef.current) {
        clearTimeout(animTimerRef.current);
        animTimerRef.current = null;
      }
      try {
        runtimeRef.current?.session?.destroy();
      } catch (err) {
        logger.warn('emulator.console.destroy-error', { error: err && err.message });
      }
      runtimeRef.current = null;
    };
    // Mount-once: collaborators are stable for the life of the console.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Tap the screen area to toggle "filled" — the console breaks out to cover the
  // whole app surface (.fitness-app-viewport) rather than just its in-frame box.
  // NOT the browser Fullscreen API; just a CSS takeover. Taps on the on-screen
  // buttons / controller panel are ignored so they keep their own behavior.
  const [filled, setFilled] = useState(false);
  const handleScreenPress = useCallback((e) => {
    if (e?.target?.closest?.('button, .emulator-controller-panel')) return;
    setFilled((v) => !v);
  }, []);

  return (
    <div
      className={`emulator-console${filled ? ' emulator-console--filled' : ''}`}
      data-state={status.state}
      onPointerDown={handleScreenPress}
    >
      <div className={`emulator-chrome chrome-${game?.chrome || 'none'}`} />
      <div className="emulator-mount" ref={mountRef} />
      <div className={`emulator-shader shader-${game?.shader || 'none'} ${animClass}`.trim()} />
      {showOverlay && (
        <div className={`emulator-governance-overlay overlay-${status.state}`}>
          <span>{overlayText(status)}</span>
        </div>
      )}
      {typeof onExit === 'function' && (
        <button
          type="button"
          className="emulator-exit-affordance"
          aria-label="Exit emulator"
          onClick={onExit}
        />
      )}

      <button
        type="button"
        className={`emulator-controller-toggle${panelOpen ? ' is-open' : ''}`}
        aria-label={panelOpen ? 'Hide controller panel' : 'Show controller panel'}
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((v) => !v)}
      >
        🎮
      </button>
      {panelOpen && (
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
    </div>
  );
}

export default EmulatorConsole;
