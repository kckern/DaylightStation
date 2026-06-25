import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI, DaylightMediaPath } from '../../../../lib/api.mjs';
import getLogger from '../../../../lib/logging/Logger.js';
import { EmulatorConsole } from '../../../Emulator/EmulatorConsole.jsx';
import { buildEjsControls } from '../../../Emulator/input/buildEjsControls.js';
import { buildFitnessGameGate } from './fitnessGameGate.js';

// Absolute (leading slash): EmulatorJS sets `script.src = `${pathtodata}loader.js``,
// which must resolve from the origin root — a relative path resolves against the
// SPA route (/fitness/module/...) and 404/504s.
const ENGINE_PATH = '/api/v1/emulator/engine/';
const GATE_TICK_MS = 1000;

/**
 * Resolve the per-controller gamepad value2 override (special mappings live in
 * input.yml under each controller). Prefer a controller whose `match` regex hits
 * a currently-connected pad; otherwise fall back to the first controller that
 * defines an override (covers the single-controller kiosk where the pad may not
 * be awake at boot). Returns a semantic→value2 map (or {} for stock mapping).
 */
function resolveControllerGamepad(controllers) {
  const list = Array.isArray(controllers) ? controllers : [];
  const pads = (typeof navigator !== 'undefined' && navigator.getGamepads)
    ? Array.from(navigator.getGamepads()).filter(Boolean)
    : [];
  for (const c of list) {
    if (!c?.gamepad) continue;
    let re = null;
    try { re = c.match ? new RegExp(c.match, 'i') : null; } catch { re = null; }
    if (re && pads.some((p) => re.test(p.id))) return c.gamepad;
  }
  return list.find((c) => c?.gamepad)?.gamepad || {};
}

// Fitness binding for the host-agnostic EmulatorConsole: library → game/controls/
// gate/identity → governed console. Locked-launch is handled by the menu (locks).
export default function EmulatorGameWidget({ fitnessContext, onClose, config, onMount }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-emulator' }), []);
  const [game, setGame] = useState(null);
  const [engineConfig, setEngineConfig] = useState(null);
  const [error, setError] = useState(null);
  const gateRef = useRef(null);

  const zonesOrder = useMemo(() => Object.keys(fitnessContext?.zones || {}), [fitnessContext]);

  // getActivePlayerId: FitnessContext does NOT expose this directly.
  // Fallback: first user in the session roster (covers single-rider fitness sessions).
  // This is a documented concern — see task notes.
  const getActivePlayerId = fitnessContext?.getActivePlayerId
    || (() => fitnessContext?.fitnessSessionInstance?.roster?.[0]?.userId ?? null);
  const getUserVitals = fitnessContext?.getUserVitals || (() => null);

  useEffect(() => {
    let alive = true;
    DaylightAPI('api/v1/emulator/library').then((lib) => {
      if (!alive) return;
      const games = lib?.games || [];
      const chosen = (config?.gameId && games.find((g) => g.id === config.gameId)) || games[0];
      if (!chosen) { setError('No games'); onMount?.(); return; }
      const controls = buildEjsControls(lib?.input?.keyboard || {}, resolveControllerGamepad(lib?.input?.controllers));
      const gate = buildFitnessGameGate({ game: chosen, zonesOrder, getActivePlayerId, getUserVitals });
      gateRef.current = gate;
      setGame({ id: chosen.id, system: chosen.system, romUrl: chosen.romUrl, chrome: chosen.chrome, shader: chosen.shader, bezelUrl: chosen.bezelUrl, screen: chosen.screen, onscreenControls: chosen.onscreenControls });
      setEngineConfig({ pathtodata: ENGINE_PATH, core: lib?.systems?.[chosen.system]?.core || chosen.system || 'gb', controls });
      logger.info('fitness-emulator.loaded', { game: chosen.id, gate: gate.mode });
      onMount?.();
    }).catch((e) => { if (alive) { setError(e.message); logger.error('fitness-emulator.load-failed', { error: e.message }); onMount?.(); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop the menu GamepadAdapter from fighting EmulatorJS while a game is up.
  useEffect(() => {
    window.__emulatorCapturingGamepad = true;
    return () => { window.__emulatorCapturingGamepad = false; };
  }, []);

  // Drive the credit gate from live vitals.
  useEffect(() => {
    const id = setInterval(() => gateRef.current?.tick?.(GATE_TICK_MS / 1000), GATE_TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (error) return <div className="fitness-emulator__error">Emulator unavailable: {error}</div>;
  if (!game || !engineConfig) return <div className="fitness-emulator__loading">Loading…</div>;

  return (
    <EmulatorConsole
      game={game}
      engineConfig={engineConfig}
      governanceGate={gateRef.current}
      identity={{ getActivePlayerId }}
      resolveMediaUrl={(p) => DaylightMediaPath(p)}
      onExit={onClose}
    />
  );
}
