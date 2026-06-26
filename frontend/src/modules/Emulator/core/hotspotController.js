/**
 * hotspotController — turns a bezel hotspot activation into an effect.
 *
 * Hotspots are the interactive engravings painted into the bezel art (speaker
 * grille → volume, stereo-sound text → mute, start button → pause, logo → exit,
 * …). Each hotspot carries either a built-in `action` verb or a `do:` block
 * reusing the per-game bindings vocabulary (music/chime/ha_scene/animation/
 * governance/toast), dispatched via the session's `runActions`.
 *
 * Pure + framework-free: every collaborator is injected so it unit-tests with
 * fakes. The controller owns the small player-control state (volume/mute/pause)
 * and emits `onChange(snapshot)` so the React layer can mirror it.
 *
 * @param {object} deps
 * @param {{setBusVolume?:Function, muteBus?:Function}} deps.mixer
 * @param {{pause?:Function, resume?:Function}} deps.engine
 * @param {Function} [deps.onExit]
 * @param {Function} [deps.runActions] (doMap, ctx) => void
 * @param {Function} [deps.saveState]
 * @param {Function} [deps.onChange] (state) => void
 * @param {number} [deps.initialVolume=1]
 * @param {number} [deps.volumeStep=0.25]
 * @param {{warn?:Function, debug?:Function}} [deps.logger]
 */
export function createHotspotController({
  mixer = {},
  engine = {},
  onExit,
  onReset,
  runActions,
  saveState,
  onChange,
  initialVolume = 1,
  volumeStep = 0.25,
  logger,
} = {}) {
  let volume = clamp01(initialVolume);
  let muted = false;
  let paused = false;

  const warn = typeof logger?.warn === 'function' ? logger.warn.bind(logger) : () => {};

  function getState() {
    return { volume, muted, paused };
  }

  function emit() {
    if (typeof onChange === 'function') onChange(getState());
  }

  function stepVolume() {
    let next = round2(volume - volumeStep);
    if (next < 0) next = 1; // wrap from silence back to full
    volume = next;
    mixer.setBusVolume?.('game', volume);
    emit();
  }

  function toggleMute() {
    muted = !muted;
    mixer.muteBus?.('game', muted);
    emit();
  }

  function togglePause() {
    paused = !paused;
    if (paused) engine.pause?.();
    else engine.resume?.();
    emit();
  }

  const verbs = {
    volume: stepVolume,
    mute: toggleMute,
    pause: togglePause,
    save_state: () => saveState?.(),
    exit: () => onExit?.(),
    // "Start over" — the power-switch etching. The console intercepts this to
    // raise a confirm modal before erasing the save + restarting the ROM.
    reset: () => onReset?.(),
  };

  function activate(hotspot) {
    if (!hotspot) return;
    try {
      if (hotspot.action) {
        const verb = verbs[hotspot.action];
        if (verb) verb();
        else warn('emulator.hotspot.unknown-action', { action: hotspot.action, id: hotspot.id });
        return;
      }
      if (hotspot.do && typeof runActions === 'function') {
        runActions(hotspot.do, { hotspot: hotspot.id });
      }
    } catch (err) {
      warn('emulator.hotspot.activate-failed', { id: hotspot.id, error: err && err.message });
    }
  }

  return { activate, getState };
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

export default createHotspotController;
