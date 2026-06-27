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
import { createWramCalibrator as realCreateWramCalibrator } from './WramCalibrator.js';
import { createStateMap as realCreateStateMap } from './StateMap.js';
import { createBindingMatcher as realCreateBindingMatcher } from './BindingMatcher.js';

let _log;
const log = () => (_log ??= getLogger().child({ component: 'emulator-session' }));

const GATE_POLL_MS = 250;

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
 * @param {object} [opts.actionHandlers] host-provided { haScene, animation, governance, toast }
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
  } = deps;

  const childLog = logger || log();

  const system = game.system || 'gb';

  let stateMap = null;
  let matcher = null;
  let wramBase = null;
  let started = false;

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

  // --- Lifecycle ------------------------------------------------------------
  async function start({ mount } = {}) {
    childLog.info('emulator.session.start', { game: game.id, system });

    await engine.boot({
      mount,
      romUrl: game.romUrl,
      pathtodata: engineConfig.pathtodata,
      core: engineConfig.core || system,
      controls: engineConfig.controls,
    });

    // Calibrate WRAM via a harmless cheat ping.
    const calibrator = createWramCalibrator({
      setCheat: engine.setCheat,
      resetCheat: engine.resetCheat,
      getHeap: engine.getHeap,
      waitFrames: engine.waitFrames,
      system,
      logger: childLog,
    });

    let cal = null;
    try {
      cal = await calibrator.calibrate();
    } catch (err) {
      childLog.warn('emulator.calibration.error', { error: err && err.message });
    }

    if (cal && cal.wramBase != null && game.states) {
      wramBase = cal.wramBase;
      matcher = createBindingMatcher({
        bindings: game.bindings || [],
        handlers,
        logger: childLog,
      });
      stateMap = createStateMap({
        getHeap: engine.getHeap,
        wramBase,
        system,
        states: game.states,
        onState: (name, detail) => matcher.onStateChange(name, detail),
      });
      stateMap.start();
      childLog.info('emulator.statemap.started', { wramBase });
    } else {
      childLog.warn('emulator.calibration.failed', {
        calibrated: cal != null,
        hasStates: !!game.states,
      });
    }

    // Governance enforcement: apply once, subscribe, and poll.
    applyGate();
    gateUnsub = governanceGate.onChange(applyGate);
    gateTimer = scheduler.set(applyGate, GATE_POLL_MS);

    started = true;
    return { wramBase };
  }

  function stop() {
    if (gateTimer != null) {
      scheduler.clear(gateTimer);
      gateTimer = null;
    }
    if (typeof gateUnsub === 'function') {
      gateUnsub();
      gateUnsub = null;
    }
    stateMap?.stop();
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

  return {
    start,
    stop,
    destroy,
    runActions,
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
