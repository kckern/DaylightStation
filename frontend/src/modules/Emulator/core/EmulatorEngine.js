/**
 * EmulatorEngine — thin wrapper around the running EmulatorJS instance.
 *
 * All methods delegate through the stored `EJS_emulator` instance using the
 * verified EmulatorJS API. The engine itself holds no game state; it just
 * brokers boot/readiness and forwards calls so the pure surface is unit-testable
 * against a fake instance.
 */

import { loadEmulatorJS } from './loadEmulatorJS.js';
import getLogger from '@/lib/logging/Logger.js';

let _log;
const log = () => (_log ??= getLogger().child({ component: 'emulator-engine' }));

const FRAME_INTERVAL_MS = 16;
const WAIT_FRAMES_CAP_MS = 3000;
const LOADER_SCRIPT_ID = 'ejs-loader';

function clamp01(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * @param {object} [opts]
 * @param {Function} [opts.load=loadEmulatorJS] - injectable loader (for tests).
 * @param {Window} [opts.win=window]
 * @returns engine object
 */
export function createEmulatorEngine({ load = loadEmulatorJS, win = window } = {}) {
  let instance = null;
  let ready = false;
  let bootPromise = null;

  /**
   * Boot the emulator. Idempotent: a second call returns the same readiness
   * promise rather than re-loading the single-instance library.
   */
  async function boot({ mount, romUrl, pathtodata, core = 'gb', controls } = {}) {
    if (bootPromise) return bootPromise;

    log().info('boot.start', { core });
    bootPromise = load({ player: mount, core, romUrl, pathtodata, controls, win })
      .then((emu) => {
        instance = emu;
        ready = true;
        log().info('boot.ready', { core });
        return instance;
      })
      .catch((err) => {
        bootPromise = null; // allow a retry after a hard failure
        log().error('boot.failed', { error: err?.message });
        throw err;
      });

    return bootPromise;
  }

  function isReady() {
    return ready;
  }

  function pause() {
    if (!ready) return;
    instance.pause();
    log().debug('pause', {});
  }

  function resume() {
    if (!ready) return;
    instance.play();
    log().debug('resume', {});
  }

  function setVolume(v) {
    if (!ready) return;
    const clamped = clamp01(v);
    instance.setVolume(clamped);
    log().debug('set-volume', { volume: clamped });
  }

  /** Fresh HEAPU8 each call — the WASM heap can be reallocated. */
  function getHeap() {
    if (!ready) return null;
    return instance.gameManager.Module.HEAPU8;
  }

  function setCheat(i, enabled, code) {
    if (!ready) return;
    instance.gameManager.functions.setCheat(i, enabled, code);
  }

  function resetCheat() {
    if (!ready) return;
    instance.gameManager.functions.resetCheat();
  }

  function getFrameNum() {
    if (!ready) return null;
    return instance.gameManager.functions.getFrameNum();
  }

  function readFrameNum() {
    try {
      const fn = instance?.gameManager?.functions?.getFrameNum;
      return typeof fn === 'function' ? fn.call(instance.gameManager.functions) : null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve once the frame counter has advanced by >= n since the call.
   * Polls every ~16ms. If getFrameNum is unavailable, falls back to a
   * time-based delay (~n*16ms). Total wait is capped at ~3s.
   */
  function waitFrames(n = 70) {
    return new Promise((resolve) => {
      const tick = win.requestAnimationFrame
        ? (cb) => win.requestAnimationFrame(cb)
        : (cb) => setTimeout(cb, FRAME_INTERVAL_MS);

      const start = readFrameNum();
      const startTime = Date.now();

      // No frame counter -> time-based fallback.
      if (start === null) {
        setTimeout(resolve, n * FRAME_INTERVAL_MS);
        return;
      }

      const poll = () => {
        const elapsed = Date.now() - startTime;
        const current = readFrameNum();
        const advanced = current !== null && current - start >= n;
        if (advanced || elapsed >= WAIT_FRAMES_CAP_MS) {
          resolve();
          return;
        }
        tick(poll);
      };
      tick(poll);
    });
  }

  /**
   * Best-effort teardown. EmulatorJS does not cleanly support re-init within a
   * single page; a full re-boot may require a page reload. That's acceptable —
   * this just releases what it can so a reload starts clean.
   */
  function destroy() {
    try {
      if (ready && instance?.pause) instance.pause();
    } catch (err) {
      log().warn('destroy.pause-failed', { error: err?.message });
    }
    try {
      const script = win.document.getElementById(LOADER_SCRIPT_ID);
      if (script?.remove) script.remove();
    } catch (err) {
      log().warn('destroy.script-remove-failed', { error: err?.message });
    }
    instance = null;
    ready = false;
    bootPromise = null;
    log().info('destroy', {});
  }

  return {
    boot,
    isReady,
    pause,
    resume,
    setVolume,
    getHeap,
    setCheat,
    resetCheat,
    getFrameNum,
    waitFrames,
    destroy,
  };
}
