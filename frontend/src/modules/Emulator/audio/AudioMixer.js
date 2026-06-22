/**
 * AudioMixer — a 3-bus audio mixer for the Emulator Console.
 *
 * Buses:
 *  - game:  the emulator's master output (driven via injected setGameVolume).
 *  - music: app-triggered music tracks (one at a time).
 *  - cues:  app-triggered one-shot SFX/chimes (can overlap).
 *
 * Ducking: while >= 1 audible cue is playing, the configured buses (default
 * game + music) have their effective volume multiplied by `duck.factor`.
 * Buses restore only when the LAST ducking cue ends.
 *
 * All audio I/O is injected so this is fully unit-testable with no real audio.
 *
 * @param {object}   deps
 * @param {(v:number)=>void} deps.setGameVolume  Apply the effective game-bus volume (0..1).
 * @param {(url:string, opts:{loop:boolean})=>Clip} deps.createClip  Clip factory.
 * @param {{factor?:number, buses?:string[]}} [deps.duck]  Ducking config.
 * @param {object}   [deps.logger]  Optional logger ({ warn, debug, ... }); defaults to no-op.
 *
 * Clip handle shape: { play(), stop(), setVolume(v), onEnded(cb) }.
 */

const BUS_NAMES = ['game', 'music', 'cues'];

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

const NOOP = () => {};

function noopLogger() {
  return { debug: NOOP, info: NOOP, warn: NOOP, error: NOOP };
}

export function createAudioMixer({ setGameVolume, createClip, duck, logger } = {}) {
  const log = logger || noopLogger();
  const warn = typeof log.warn === 'function' ? log.warn.bind(log) : NOOP;
  const debug = typeof log.debug === 'function' ? log.debug.bind(log) : NOOP;

  const duckCfg = {
    factor: duck && typeof duck.factor === 'number' ? duck.factor : 0.2,
    buses: duck && Array.isArray(duck.buses) ? duck.buses : ['game', 'music'],
  };

  let master = 1;
  const buses = {
    game: { volume: 1, muted: false },
    music: { volume: 1, muted: false },
    cues: { volume: 1, muted: false },
  };
  let duckDepth = 0;
  let musicClip = null;

  function isValidBus(name) {
    return BUS_NAMES.includes(name);
  }

  function effective(busName) {
    const bus = buses[busName];
    if (!bus) return 0;
    const muteFactor = bus.muted ? 0 : 1;
    const isDucked = duckCfg.buses.includes(busName) && duckDepth > 0;
    const duckFactor = isDucked ? duckCfg.factor : 1;
    return clamp01(master * bus.volume * muteFactor * duckFactor);
  }

  /**
   * Push current effective volumes to the live sinks (game output + music clip).
   * Cues are one-shots and are not retro-adjusted.
   */
  function reapply() {
    setGameVolume(effective('game'));
    if (musicClip) musicClip.setVolume(effective('music'));
  }

  function setMasterVolume(v) {
    master = clamp01(Number(v));
    reapply();
  }

  function setBusVolume(busName, v) {
    if (!isValidBus(busName)) {
      warn('audio-mixer.unknown-bus', { method: 'setBusVolume', bus: busName });
      return;
    }
    buses[busName].volume = clamp01(Number(v));
    reapply();
  }

  function muteBus(busName, muted = true) {
    if (!isValidBus(busName)) {
      warn('audio-mixer.unknown-bus', { method: 'muteBus', bus: busName });
      return;
    }
    buses[busName].muted = !!muted;
    reapply();
  }

  function playMusic(url, { loop = true } = {}) {
    if (musicClip) musicClip.stop();
    musicClip = createClip(url, { loop });
    musicClip.setVolume(effective('music'));
    musicClip.play();
    debug('audio-mixer.music-play', { url, loop, volume: effective('music') });
    return musicClip;
  }

  function stopMusic() {
    if (musicClip) {
      musicClip.stop();
      musicClip = null;
      debug('audio-mixer.music-stop', {});
    }
  }

  function playCue(url) {
    const clip = createClip(url, { loop: false });
    const cueVolume = effective('cues');
    clip.setVolume(cueVolume);
    clip.play();

    // Only duck for audible cues when ducking is configured.
    if (cueVolume > 0 && duckCfg.buses.length > 0) {
      duckDepth += 1;
      reapply();
      let restored = false;
      clip.onEnded(() => {
        if (restored) return;
        restored = true;
        duckDepth -= 1;
        if (duckDepth < 0) duckDepth = 0;
        reapply();
        debug('audio-mixer.cue-end', { url, duckDepth });
      });
      debug('audio-mixer.cue-play', { url, volume: cueVolume, duck: true, duckDepth });
    } else {
      debug('audio-mixer.cue-play', { url, volume: cueVolume, duck: false });
    }

    return clip;
  }

  function getEffective(busName) {
    return effective(busName);
  }

  // Initialize the emulator output at the right level.
  setGameVolume(effective('game'));

  return {
    setMasterVolume,
    setBusVolume,
    muteBus,
    playMusic,
    stopMusic,
    playCue,
    getEffective,
  };
}

export default createAudioMixer;
