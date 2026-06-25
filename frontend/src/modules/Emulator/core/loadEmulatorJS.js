/**
 * loadEmulatorJS — lazy loader for the self-hosted EmulatorJS bundle.
 *
 * EmulatorJS is a single-instance, globals-driven library: you set a batch of
 * `window.EJS_*` globals, then inject `loader.js`, which boots and exposes the
 * running instance as `window.EJS_emulator`. This module wraps that dance in a
 * memoized, promise-returning loader so callers get a clean async API.
 *
 * The EJS_* API used here is verified against a real headless boot — do not
 * swap in alternative globals or methods.
 */

import getLogger from '@/lib/logging/Logger.js';

let _log;
const log = () => (_log ??= getLogger().child({ component: 'emulator-loader' }));

const DEFAULT_TIMEOUT_MS = 60000;
const LOADER_SCRIPT_ID = 'ejs-loader';

/**
 * Build the object of `EJS_*` globals to assign onto `window`.
 * Pure + unit-testable: no side effects, no DOM access.
 *
 * @param {object} args
 * @param {string|Element} args.player - CSS selector or element for the mount div.
 * @param {string} [args.core='gb'] - EmulatorJS core id.
 * @param {string} args.romUrl - URL to the ROM file.
 * @param {string} args.pathtodata - URL to the served EmulatorJS `data/` bundle (normalized to end with `/`).
 * @param {Function} [args.onReady] - lifecycle callback wired to EJS_ready.
 * @param {Function} [args.onGameStart] - lifecycle callback wired to EJS_onGameStart.
 * @param {object} [args.controls] - EJS_defaultControls object (player->index->{value,value2}).
 * @returns {object} key/value map of EJS_* globals.
 */
export function buildEjsGlobals({ player, core = 'gb', romUrl, pathtodata, onReady, onGameStart, controls } = {}) {
  if (!player) throw new Error('buildEjsGlobals: player (mount selector/element) is required');
  if (!romUrl) throw new Error('buildEjsGlobals: romUrl is required');
  if (!pathtodata) throw new Error('buildEjsGlobals: pathtodata is required');

  const normalizedPath = pathtodata.endsWith('/') ? pathtodata : `${pathtodata}/`;

  // EmulatorJS does `document.querySelector(EJS_player)`, so the player MUST be a
  // selector string — an element coerces to "[object HTMLDivElement]" and throws
  // a SyntaxError, halting boot. Accept an element by giving it an id and passing
  // the `#id` selector.
  let playerSelector = player;
  if (player && typeof player !== 'string') {
    if (!player.id) {
      const rnd = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID().replace(/[^a-z0-9]/gi, '').slice(0, 8)
        : `${Date.now().toString(36)}`;
      player.id = `ejs-mount-${rnd}`;
    }
    playerSelector = `#${player.id}`;
  }

  const globals = {
    EJS_player: playerSelector,
    EJS_core: core,
    EJS_gameUrl: romUrl,
    EJS_pathtodata: normalizedPath,
    EJS_startOnLoaded: true,
    EJS_threads: false,
    // Non-muted default; the console's AudioMixer pushes the real game-bus level
    // on boot and on volume changes. Without this EmulatorJS can start silent.
    EJS_volume: 0.5,
    // NOTE: deliberately NOT setting EJS_DEBUG_XX — it forces unminified
    // src/* loads that 404 on the self-hosted bundle.
  };
  if (onReady) globals.EJS_ready = onReady;
  if (onGameStart) globals.EJS_onGameStart = onGameStart;
  if (controls) globals.EJS_defaultControls = controls;
  return globals;
}

// Memoized in-flight / resolved promise. Single-instance library => single load.
let _loadPromise = null;

/**
 * Lazily load and boot EmulatorJS. Returns a promise that resolves with the
 * running `EJS_emulator` instance once the game starts.
 *
 * Memoized: concurrent / repeat calls return the same promise.
 *
 * @param {object} args
 * @param {string|Element} args.player - mount selector or element.
 * @param {string} [args.core='gb']
 * @param {string} args.romUrl
 * @param {string} args.pathtodata
 * @param {Window} [args.win=window]
 * @param {number} [args.timeoutMs=60000]
 * @param {object} [args.controls] - EJS_defaultControls (keyboard+gamepad mapping).
 * @returns {Promise<object>} resolves with win.EJS_emulator
 */
export function loadEmulatorJS({ player, core = 'gb', romUrl, pathtodata, win = window, timeoutMs = DEFAULT_TIMEOUT_MS, controls } = {}) {
  if (_loadPromise) {
    log().debug('load.memoized-hit', {});
    return _loadPromise;
  }

  _loadPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const handleGameStart = () => {
      if (settled) return;
      settled = true;
      cleanup();
      log().info('load.game-start', { core });
      resolve(win.EJS_emulator);
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Allow a future retry after a hard failure.
      _loadPromise = null;
      log().error('load.failed', { error: err?.message });
      reject(err);
    };

    let globals;
    try {
      globals = buildEjsGlobals({ player, core, romUrl, pathtodata, onGameStart: handleGameStart, controls });
    } catch (err) {
      fail(err);
      return;
    }

    // Assign EJS_* globals onto the window before injecting the loader.
    for (const [key, value] of Object.entries(globals)) {
      win[key] = value;
    }

    const pathtodataNorm = globals.EJS_pathtodata;

    // Guard against double-injection.
    if (!win.document.getElementById(LOADER_SCRIPT_ID)) {
      const script = win.document.createElement('script');
      script.id = LOADER_SCRIPT_ID;
      script.src = `${pathtodataNorm}loader.js`;
      script.onerror = () => fail(new Error('EmulatorJS loader.js failed to load'));
      win.document.head.appendChild(script);
      log().info('load.script-injected', { src: script.src, core });
    } else {
      log().debug('load.script-already-present', {});
    }

    timer = setTimeout(() => {
      fail(new Error(`EmulatorJS load timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return _loadPromise;
}

/** Test-only: reset memoization between cases. */
export function _resetLoaderForTests() {
  _loadPromise = null;
}
