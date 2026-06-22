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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { createEmulatorEngine } from './core/EmulatorEngine.js';
import { createAudioMixer } from './audio/AudioMixer.js';
import { createEmulatorSession } from './core/EmulatorSession.js';
import { createHtmlAudioClip } from './audio/htmlAudioClip.js';
import './EmulatorConsole.scss';

const STATUS_POLL_MS = 500;
const ANIM_DURATION_MS = 1000;

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
}) {
  const fns = useMemo(() => ({ ...DEFAULT_FACTORIES, ...(factories || {}) }), [factories]);
  const logger = useMemo(() => getLogger().child({ component: 'emulator-console' }), []);

  const mountRef = useRef(null);
  const runtimeRef = useRef(null); // { engine, mixer, session }

  const [status, setStatus] = useState(() => governanceGate?.getStatus?.() || { state: 'playing' });
  const [animClass, setAnimClass] = useState('');
  const [, setError] = useState(null);
  const animTimerRef = useRef(null);

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

  const showOverlay = status.state !== 'playing';

  return (
    <div className="emulator-console" data-state={status.state}>
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
    </div>
  );
}

export default EmulatorConsole;
