/**
 * EmulatorSession — orchestrates the Emulator Console runtime.
 *
 * Wires the already-built modules into one lifecycle:
 *   boot the engine → calibrate WRAM → run the semantic StateMap →
 *   dispatch bindings (audio via the mixer, plus host-injected handlers) →
 *   enforce governance by pausing/resuming the emulator.
 *
 * Pure orchestration: every collaborator (engine, mixer, governanceGate) and
 * the module factories are injected, so this is fully unit-testable against
 * fakes with no real emulator.
 */

import getLogger from '@/lib/logging/Logger.js';
import { createWramCalibrator as realCreateWramCalibrator } from "./WramCalibrator.js";
import { createStateMap as realCreateStateMap } from "./StateMap.js";
import { createBindingMatcher as realCreateBindingMatcher } from "./BindingMatcher.js";
import { createEffectBindings } from "./EffectBindings.js";
import { loadShaderTextures, withShaderTextures, withoutShader } from "../shaders/customShaders.js";

let _log;
const log = () => (_log ??= getLogger().child({ component: 'emulator-session' }));

const GATE_POLL_MS = 250;
// A boot that has not produced frames yet cannot be calibrated; retry this
// often, this many times (~30 s), before giving up on the state map.
const CALIBRATION_RETRY_MS = 5000;
const CALIBRATION_RETRY_LIMIT = 6;

const DEFAULT_SCHEDULER = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (id) => clearInterval(id),
};

/**
 * @param {object} opts
 * @param {object} opts.engine emulator engine (boot/pause/resume/getHeap/setCheat/...)
 * @param {object} opts.mixer audio mixer (playMusic/playCue/stopMusic/...)
 * @param {object} opts.governanceGate { mode, isPlayable, getStatus, onChange }
 * @param {object} opts.game { id, system='gb', romUrl, states, bindings }
 * @param {object} opts.engineConfig { pathtodata, core='gb' }
 * @param {object} [opts.actionHandlers] host-provided { haScene, animation, governance, toast, effect }.
 *   `effect(effectId, phase, context)` runs a registry effect; phase is 'enter' | 'exit'.
 * @param {object} [opts.deps] { createWramCalibrator, createStateMap, createBindingMatcher, resolveMediaUrl }
 * @param {{set,clear}} [opts.scheduler] governance enforcement poll
 * @param {object} [opts.logger]
 */
export function createEmulatorSession({
  engine,
  mixer,
  governanceGate,
  game,
  engineConfig,
  actionHandlers = {},
  deps = {},
  scheduler = DEFAULT_SCHEDULER,
  logger,
} = {}) {
  const {
    createWramCalibrator = realCreateWramCalibrator,
    createStateMap = realCreateStateMap,
    createBindingMatcher = realCreateBindingMatcher,
    resolveMediaUrl = (p) => p,
    fetchBytes = (url) => globalThis.fetch(url),
    setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimer = (id) => globalThis.clearTimeout(id),
  } = deps;

  const childLog = logger || log();

  const system = game.system || 'gb';

  let stateMap = null;
  let matcher = null;
  let effects = null;
  let wramBase = null;
  let started = false;
  let stopped = false;
  let calibrationTimer = null;

  // Governance enforcement bookkeeping.
  let gateUnsub = null;
  let gateTimer = null;
  let lastPlayable = null; // null = never applied → first apply always runs

  // --- Binding handler map (action name → handler fn) -----------------------
  const handlers = {
    music: (p) =>
      mixer.playMusic(resolveMediaUrl(typeof p === 'string' ? p : p.url), {
        loop: typeof p === 'object' && p.loop != null ? p.loop : true,
      }),
    chime: (p) => mixer.playCue(resolveMediaUrl(typeof p === 'string' ? p : p.url)),
    ha_scene: (p, ctx) => actionHandlers.haScene?.(p, ctx),
    animation: (p, ctx) => actionHandlers.animation?.(p, ctx),
    governance: (p, ctx) => actionHandlers.governance?.(p, ctx),
    toast: (p, ctx) => actionHandlers.toast?.(p, ctx),
    log: (p) => childLog.info('emulator.binding.log', { p }),
  };

  // --- Governance enforcement ----------------------------------------------
  function applyGate() {
    const playable = governanceGate.isPlayable();
    if (playable === lastPlayable) return; // only act on a flip
    lastPlayable = playable;
    if (playable) {
      childLog.info('emulator.governance.resume', {});
      engine.resume();
    } else {
      childLog.info('emulator.governance.pause', {});
      engine.pause();
    }
  }

  // --- Picture-shader textures ------------------------------------------------
  // A preset's bitmaps live on the media mount; the manifest names them in
  // `presentation.ejs_shader_textures` ({ fileNameThePresetReads: engine path }).
  // Fetch them before boot and attach them to the preset. If any is missing,
  // drop the preset: EmulatorJS then shows the picture unfiltered.
  async function resolveShaderTable() {
    // `shaders` is a table, or an async loader of one (fetches /vendor shader text).
    const table = typeof engineConfig.shaders === 'function' ? await engineConfig.shaders() : engineConfig.shaders;
    const name = game.presentation?.ejs_shader;
    const textures = game.presentation?.ejs_shader_textures;
    if (!table?.[name] || !textures || !Object.keys(textures).length) return table;
    const { bytes, missing } = await loadShaderTextures(textures, {
      base: engineConfig.pathtodata || '',
      fetchImpl: fetchBytes,
    });
    if (missing.length) {
      childLog.error('emulator.shader.textures-missing', { game: game.id, shader: name, missing });
      return withoutShader(table, name);
    }
    childLog.info('emulator.shader.textures-loaded', {
      game: game.id,
      shader: name,
      files: Object.fromEntries(Object.entries(bytes).map(([f, b]) => [f, b.byteLength])),
    });
    return withShaderTextures(table, name, bytes);
  }

  // --- Lifecycle ------------------------------------------------------------
  async function start({ mount } = {}) {
    childLog.info('emulator.session.start', { game: game.id, system });

    const shaders = await resolveShaderTable();

    await engine.boot({
      mount,
      romUrl: game.romUrl,
      pathtodata: engineConfig.pathtodata,
      core: engineConfig.core || system,
      controls: engineConfig.controls,
      checkpointProvenance: engineConfig.checkpointProvenance,
      // Hand EJS the user's persisted volume so the value it re-asserts during
      // its own start chain is already correct (see loadEmulatorJS EJS_volume).
      volume: engineConfig.volume,
      // Our own picture-shader presets (the Game Boys' Harlequin dot matrix),
      // registered with EmulatorJS at boot so presentation.ejs_shader can name
      // them at the settle barrier.
      shaders,
    });

    await engineConfig.afterBoot?.(engine);

    // Calibrate WRAM via a harmless cheat ping — but ONLY for a game that
    // declares a semantic state map, since the base address exists to read that
    // map and nothing else. Calibrating regardless cost a cheat-ping round trip
    // on every boot and, worse, reported `emulator.calibration.failed` at warn
    // level for every title without states (Sonic, and five of the seven Game
    // Boy titles) — a permanent false alarm that would bury a real failure.
    stopped = false;
    let cal = null;
    let calibrator = null;
    if (game.states && engineConfig.checkpointProvenance) {
      // Restored SRAM/WRAM must never be probed with writes or calibration frames.
      // Missing optional state instrumentation cannot justify a destructive fallback.
      const nativeBase = engine.getWramBase?.();
      if (nativeBase != null) cal = { wramBase: nativeBase };
    } else if (game.states) {
      calibrator = createWramCalibrator({
        setCheat: engine.setCheat,
        resetCheat: engine.resetCheat,
        getHeap: engine.getHeap,
        waitFrames: engine.waitFrames,
        system,
        // Per-game ping pages from the sidecar (Super Mario Land's sprite table
        // makes the default page ambiguous).
        scratchAddrs: game.calibration?.scratch ?? null,
        logger: childLog,
      });
      try {
        cal = await calibrator.calibrate();
      } catch (err) {
        if (err?.code === 'ENOFRAMES') {
          // A stalled boot (no frames yet) says nothing about WRAM. Retry in
          // the background once the core is running instead of giving up.
          scheduleCalibrationRetry(calibrator, 1);
          cal = { pending: true };
        } else {
          childLog.warn('emulator.calibration.error', { error: err && err.message });
        }
      }
    } else {
      childLog.debug('emulator.calibration.skipped', { reason: 'no-states' });
    }

    if (cal && cal.wramBase != null && game.states) {
      startStateLayer(cal.wramBase);
    } else if (game.states && !cal?.pending) {
      // Only a game that ASKED for a state map can fail to get one.
      childLog.warn('emulator.calibration.failed', {
        calibrated: cal != null,
        hasStates: true,
      });
    }

    // Governance enforcement: apply once, subscribe, and poll.
    applyGate();
    gateUnsub = governanceGate.onChange(applyGate);
    gateTimer = scheduler.set(applyGate, GATE_POLL_MS);

    started = true;
    return { wramBase };
  }

  /** Read the game's states from WRAM and dispatch bindings and effects. */
  function startStateLayer(base) {
    wramBase = base;
    matcher = createBindingMatcher({
      bindings: game.bindings || [],
      handlers,
      logger: childLog,
    });
    // Scoped effects (`effect:` bindings) enter and exit with their state.
    effects = createEffectBindings({
      bindings: game.bindings || [],
      onEffect: (effectId, phase, ctx) => actionHandlers.effect?.(effectId, phase, { ...ctx, game: game.id }),
      logger: childLog,
    });
    stateMap = createStateMap({
      getHeap: engine.getHeap,
      wramBase,
      system,
      states: game.states,
      onState: (name, detail) => {
        matcher.onStateChange(name, detail);
        effects.onStateChange(name, detail);
      },
    });
    stateMap.start();
    childLog.info('emulator.statemap.started', { wramBase });
  }

  function scheduleCalibrationRetry(calibrator, attempt) {
    if (stopped) return;
    if (attempt > CALIBRATION_RETRY_LIMIT) {
      childLog.warn('emulator.calibration.failed', { calibrated: false, hasStates: true, reason: 'no-frames', attempts: attempt - 1 });
      return;
    }
    childLog.info('emulator.calibration.retry-scheduled', { attempt, delayMs: CALIBRATION_RETRY_MS, reason: 'no-frames' });
    calibrationTimer = setTimer(async () => {
      calibrationTimer = null;
      if (stopped) return;
      try {
        const cal = await calibrator.calibrate();
        if (stopped) return;
        if (cal && cal.wramBase != null) startStateLayer(cal.wramBase);
        else childLog.warn('emulator.calibration.failed', { calibrated: cal != null, hasStates: true, attempt });
      } catch (err) {
        if (err?.code === 'ENOFRAMES') scheduleCalibrationRetry(calibrator, attempt + 1);
        else childLog.warn('emulator.calibration.error', { error: err && err.message, attempt });
      }
    }, CALIBRATION_RETRY_MS);
  }

  function stop() {
    stopped = true;
    if (calibrationTimer != null) {
      clearTimer(calibrationTimer);
      calibrationTimer = null;
    }
    if (gateTimer != null) {
      scheduler.clear(gateTimer);
      gateTimer = null;
    }
    if (typeof gateUnsub === 'function') {
      gateUnsub();
      gateUnsub = null;
    }
    stateMap?.stop();
    // Never leave the house in a game's state: a closed game exits its effects.
    effects?.exitAll('session-stop');
    mixer.stopMusic();
    started = false;
    childLog.info('emulator.session.stop', {});
  }

  function destroy() {
    stop();
    engine.destroy();
    childLog.info('emulator.session.destroy', {});
  }

  // Dispatch an ad-hoc `do:` action map through the SAME handler table the
  // bindings use. This lets bezel hotspots (and any other UI affordance) emit
  // music/chime/ha_scene/animation/governance/toast actions identically to a
  // state-driven binding. Tolerant: unknown actions route to handlers.log.
  function runActions(doMap = {}, context = {}) {
    if (!doMap || typeof doMap !== 'object') return;
    for (const [action, payload] of Object.entries(doMap)) {
      const handler = handlers[action] || handlers.log;
      try {
        handler(payload, context);
      } catch (err) {
        childLog.warn('emulator.runActions.failed', { action, error: err && err.message });
      }
    }
  }

  function getGameState() {
    return stateMap?.getState() ?? {};
  }

  function getWramBase() {
    return wramBase;
  }

  /**
   * Exit every active effect without stopping the session. For the page going
   * away (reload, crash recovery, navigation), where React never unmounts and
   * stop() would not run: the house must not stay in the game's state.
   */
  function exitEffects(reason = 'page-hide') {
    effects?.exitAll(reason);
  }

  return {
    start,
    stop,
    destroy,
    runActions,
    exitEffects,
    getGameState,
    getWramBase,
    get _started() {
      return started;
    },
    // diagnostics / test access to the live state map
    get _stateMapForTest() {
      return stateMap;
    },
  };
}

export default createEmulatorSession;
