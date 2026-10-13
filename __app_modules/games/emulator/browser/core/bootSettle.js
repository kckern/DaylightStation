/**
 * bootSettle — the missing barrier between "EmulatorJS loaded" and "EmulatorJS is
 * ready to be configured", plus read-back verification that our config stuck.
 *
 * THE BUG CLASS THIS EXISTS TO KILL (all observed 2026-08-15):
 *   • gamepad — we claimed pads into `gamepadSelection` before `setupSettingsMenu()`
 *     could reset that array to [], so the claim could be silently wiped.
 *   • volume  — we called setVolume(persisted) at boot.ready, then EJS's own start
 *     chain re-asserted `config.volume` (0.5) over the top. Game came up loud.
 *   • audio   — we probed the audio context before the core's glue existed, so the
 *     field read `null` in 24/24 samples and meant nothing.
 *
 * All three are the same defect: configuration applied at the wrong moment, with
 * nothing checking it took effect.
 *
 * THE BARRIER. EJS sets `started = true` at the very END of its start chain —
 * after the volume re-assert and after setupSettingsMenu() creates
 * gamepadSelection:
 *
 *   …updateGamepadLabels(), this.muted||this.setVolume(this.volume), …
 *   this.game.appendChild(this.canvas), this.handleResize(),
 *   this.started = !0, this.paused = !1, …
 *
 * EJS's own gamepadEvent guards on the same flag (`if(!this.started)return`). So
 * waiting for it is both necessary and sufficient: past that point nothing in EJS
 * clobbers what we set.
 *
 * Every function here takes its dependencies as arguments so the whole module is
 * testable without a browser or a real emulator.
 */

/** Bounded wait for the barrier. Past this we degrade rather than hang forever. */
export const DEFAULT_SETTLE_DEADLINE_MS = 5000;
/** Poll interval while waiting for `started`. */
export const DEFAULT_POLL_MS = 50;

/**
 * Wait until the EmulatorJS instance reports `started === true`.
 *
 * Degrades rather than bricks: on timeout it resolves `{ started: false }` and the
 * caller raises a contract fault. Never rejects.
 *
 * @param {object} args
 * @param {() => boolean} args.isStarted reads instance.started
 * @param {number} [args.deadlineMs]
 * @param {number} [args.pollMs]
 * @param {() => number} [args.now]
 * @param {(fn: Function, ms: number) => *} [args.setTimeoutFn]
 * @returns {Promise<{started: boolean, waitedMs: number}>}
 */
export function waitForStarted({
  isStarted,
  deadlineMs = DEFAULT_SETTLE_DEADLINE_MS,
  pollMs = DEFAULT_POLL_MS,
  now = () => Date.now(),
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  const begin = now();
  return new Promise((resolve) => {
    const tick = () => {
      let started = false;
      try { started = !!isStarted(); } catch { started = false; }
      const waitedMs = now() - begin;
      if (started) return resolve({ started: true, waitedMs });
      if (waitedMs >= deadlineMs) return resolve({ started: false, waitedMs });
      setTimeoutFn(tick, pollMs);
      return undefined;
    };
    tick();
  });
}

/**
 * Apply one setting, then read it back and re-assert once if it did not stick.
 *
 * The re-assert is what makes this robust to a future EJS that clobbers us in some
 * new place; the returned `reasserted` flag is the early-warning signal that such
 * drift is happening, which is precisely what nobody had on 2026-08-15.
 *
 * @param {object} setting
 * @param {string} setting.name
 * @param {() => void} setting.apply
 * @param {() => boolean} setting.verify true when the desired state is in effect
 * @returns {{name: string, ok: boolean, reasserted: boolean, error: string|null}}
 */
export function applyVerified(setting) {
  const { name, apply, verify } = setting;
  try {
    apply();
    if (verify()) return { name, ok: true, reasserted: false, error: null };
    // Did not stick — something re-asserted over us. Try exactly once more.
    apply();
    return { name, ok: !!verify(), reasserted: true, error: null };
  } catch (err) {
    return { name, ok: false, reasserted: false, error: err?.message ?? 'unknown' };
  }
}

/**
 * Run the full settle: wait for the barrier, then apply+verify every setting.
 *
 * Settings are applied even when the barrier times out — a late-starting emulator
 * is still better served by a best-effort config than by none — but the report
 * carries `started:false` so the caller can raise a contract fault.
 *
 * @param {object} args
 * @param {() => boolean} args.isStarted
 * @param {Array<{name:string, apply:Function, verify:Function}>} args.settings
 * @param {number} [args.deadlineMs]
 * @param {number} [args.pollMs]
 * @param {() => number} [args.now]
 * @param {(fn: Function, ms: number) => *} [args.setTimeoutFn]
 * @returns {Promise<{started:boolean, waitedMs:number, results:Array, reasserted:string[], failed:string[]}>}
 */
export async function settleBoot({
  isStarted,
  settings = [],
  deadlineMs = DEFAULT_SETTLE_DEADLINE_MS,
  pollMs = DEFAULT_POLL_MS,
  now = () => Date.now(),
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  const { started, waitedMs } = await waitForStarted({
    isStarted, deadlineMs, pollMs, now, setTimeoutFn,
  });
  const results = settings.map(applyVerified);
  return {
    started,
    waitedMs,
    results,
    reasserted: results.filter((r) => r.reasserted).map((r) => r.name),
    failed: results.filter((r) => !r.ok).map((r) => r.name),
  };
}
