/**
 * EmulatorEngine — thin wrapper around the running EmulatorJS instance.
 *
 * All methods delegate through the stored `EJS_emulator` instance using the
 * verified EmulatorJS API. The engine itself holds no game state; it just
 * brokers boot/readiness and forwards calls so the pure surface is unit-testable
 * against a fake instance.
 */

import { loadEmulatorJS, resetEmulatorJSLoader } from './loadEmulatorJS.js';
import getLogger from '@/lib/logging/Logger.js';

let _log;
const moduleLog = () => (_log ??= getLogger().child({ component: 'emulator-engine' }));

const FRAME_INTERVAL_MS = 16;
const WAIT_FRAMES_CAP_MS = 3000;

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
export function createEmulatorEngine({ load = loadEmulatorJS, win = window, logger } = {}) {
  // Inherit the console's child logger (carries the per-play correlation id) when
  // provided, so engine events join the same play session in the logs.
  const _engineLog = logger ? logger.child({ component: 'emulator-engine' }) : null;
  const log = () => _engineLog || moduleLog();
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

  /**
   * Confirm the game actually RENDERED, not just that the boot promise resolved.
   * Polls the frame counter until it advances. Resolves `true` on a confirmed
   * frame, `false` on timeout (→ `boot.no-frames`, a real "booted but blank"
   * signal the caller turns into an error/retry state). Cores without a frame
   * counter can't be confirmed; we treat that as inconclusive-OK to avoid false
   * negatives, and say so in the event.
   */
  function confirmFirstFrame({ timeoutMs = WAIT_FRAMES_CAP_MS, core = null } = {}) {
    if (!ready) {
      log().warn('boot.no-frames', { core, reason: 'not-ready' });
      return Promise.resolve(false);
    }
    const start = readFrameNum();
    if (start === null) {
      log().info('boot.first-frame', { core, frames: null, confirmed: false });
      return Promise.resolve(true);
    }
    const startTime = Date.now();
    return new Promise((resolve) => {
      const tick = win.requestAnimationFrame
        ? (cb) => win.requestAnimationFrame(cb)
        : (cb) => setTimeout(cb, FRAME_INTERVAL_MS);
      const poll = () => {
        const current = readFrameNum();
        if (current !== null && current > start) {
          log().info('boot.first-frame', { core, frames: current });
          resolve(true);
          return;
        }
        if (Date.now() - startTime >= timeoutMs) {
          log().warn('boot.no-frames', { core, lastFrame: current });
          resolve(false);
          return;
        }
        tick(poll);
      };
      tick(poll);
    });
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

  // ── Save / resume ─────────────────────────────────────────────────────────
  // Verified against the vendored EmulatorJS gameManager API:
  //   getState() → Uint8Array (save-state)         loadState(Uint8Array)
  //   getSaveFile() → Uint8Array (.srm; flushes SRAM first)   getSaveFilePath()
  //   loadSaveFiles() (reads SRM from FS)           restart()
  // These are how we snapshot/restore the single per-user resume point.

  /** Capture a save-state snapshot (Uint8Array) or null if unavailable. */
  function captureState() {
    if (!ready) return null;
    try {
      return instance.gameManager.getState();
    } catch (err) {
      log().warn('capture-state.failed', { error: err?.message });
      return null;
    }
  }

  /** Restore a save-state snapshot (Uint8Array). Returns success. */
  function loadState(data) {
    if (!ready || !data) return false;
    try {
      instance.gameManager.loadState(toU8(data));
      return true;
    } catch (err) {
      log().warn('load-state.failed', { error: err?.message });
      return false;
    }
  }

  /** Capture the battery save (.srm) bytes (Uint8Array) or null. */
  function captureSave() {
    if (!ready) return null;
    try {
      return instance.gameManager.getSaveFile(); // flushes SRAM → FS, then reads
    } catch (err) {
      log().warn('capture-save.failed', { error: err?.message });
      return null;
    }
  }

  /** Inject a battery save (.srm): write to the FS path, then load it. */
  function loadSave(data) {
    if (!ready || !data) return false;
    try {
      const gm = instance.gameManager;
      const path = gm.getSaveFilePath();
      gm.FS.writeFile(path, toU8(data));
      gm.loadSaveFiles();
      return true;
    } catch (err) {
      log().warn('load-save.failed', { error: err?.message });
      return false;
    }
  }

  /** Restart the ROM from power-on (used by the reset / start-over hotspot). */
  function restart() {
    if (!ready) return false;
    try {
      instance.gameManager.restart();
      return true;
    } catch (err) {
      log().warn('restart.failed', { error: err?.message });
      return false;
    }
  }

  // saveMode-aware resume helpers so callers don't branch on mode themselves.
  function captureResume(saveMode) {
    if (saveMode === 'battery') return captureSave();
    if (saveMode === 'state') return captureState();
    return null;
  }
  function loadResume(saveMode, data) {
    if (saveMode === 'battery') return loadSave(data);
    if (saveMode === 'state') return loadState(data);
    return false;
  }

  function toU8(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(data);
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
      // Full single-instance teardown: removes the loader script AND resets the
      // module-level load memo, so the NEXT game boots clean instead of being
      // handed this game's stale instance.
      resetEmulatorJSLoader(win);
    } catch (err) {
      log().warn('destroy.loader-reset-failed', { error: err?.message });
    }
    instance = null;
    ready = false;
    bootPromise = null;
    log().info('destroy', {});
  }

  return {
    boot,
    isReady,
    confirmFirstFrame,
    pause,
    resume,
    setVolume,
    getHeap,
    setCheat,
    resetCheat,
    getFrameNum,
    waitFrames,
    captureState,
    loadState,
    captureSave,
    loadSave,
    captureResume,
    loadResume,
    restart,
    destroy,
  };
}
