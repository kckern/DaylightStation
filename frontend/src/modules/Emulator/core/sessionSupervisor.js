/**
 * sessionSupervisor — watches a running emulator session for the ways it silently
 * stops working, and decides what to do about each.
 *
 * Tonight's failure mode was not a crash: the game rendered perfectly, the pad
 * reported connected, and input simply went nowhere. Nothing in the app noticed,
 * because "healthy" was never defined as an invariant that could be violated.
 * This module defines those invariants and reacts.
 *
 * TIERS
 *   safe  — fixing it costs the player nothing, so fix it silently (re-claim the
 *           pad, resume a suspended audio context). Bounded attempts, always logged.
 *   risky — fixing it means restarting and losing unsaved progress, so never act
 *           unilaterally. Surface a prompt and let a human choose.
 *
 * `no-pad` is deliberately NOT a fault: the keyboard mapping always works, and
 * treating a missing controller as an error would cry wolf.
 *
 * Pure state machine over injected probes — no timers, no DOM, no EJS. The caller
 * drives it by calling observe() on whatever cadence it likes, which makes every
 * transition testable without a browser.
 */

/** Consecutive bad windows before a gap is believed. Debounced so a blip mid-game
 *  never flashes a red alarm at a child. */
export const DEFAULT_GAP_WINDOWS = 3;
/** Consecutive static-frame observations before declaring the core frozen. */
export const DEFAULT_FROZEN_WINDOWS = 3;
/** Per-fault auto-heal budget for a session. Prevents a flapping pad thrashing. */
export const DEFAULT_MAX_HEALS = 3;

export const STATE_OK = 'ok';
export const STATE_NO_PAD = 'no-pad';
export const STATE_HEALING = 'healing';
export const STATE_FAULT = 'fault';

/** Faults we can fix without costing the player anything. */
export const SAFE_FAULTS = ['input-gap', 'audio-suspended'];

/**
 * Classify a single observation into a fault kind, or null when healthy.
 *
 * Note `input-gap` is directional (`pings > 0 && consumes === 0`), never a ratio:
 * the two counters measure different things — browser pings are deduped signature
 * changes, while EJS emits multiple simulateInput calls per event (two per axis
 * change), so consumes routinely exceeds pings in a healthy session.
 *
 * @param {object} obs
 * @param {boolean} obs.contractOk
 * @param {number} obs.padCount
 * @param {number} obs.browserPings
 * @param {number} obs.emulatorConsumes
 * @param {string|null} obs.audioState 'running' | 'suspended' | null
 * @param {boolean} obs.paused
 * @param {boolean} obs.frameAdvanced
 * @returns {string|null} fault kind
 */
export function classify(obs) {
  if (!obs.contractOk) return 'contract-broken';
  if (!obs.paused && obs.frameAdvanced === false) return 'frozen';
  if (obs.padCount > 0 && obs.browserPings > 0 && obs.emulatorConsumes === 0) return 'input-gap';
  if (obs.audioState === 'suspended') return 'audio-suspended';
  return null;
}

/** Is this fault safe to fix silently? */
export function isSafe(kind) {
  return SAFE_FAULTS.includes(kind);
}

/**
 * Create a supervisor.
 *
 * @param {object} args
 * @param {Record<string, () => boolean>} [args.healers] kind -> heal fn returning success
 * @param {number} [args.gapWindows]
 * @param {number} [args.frozenWindows]
 * @param {number} [args.maxHeals]
 * @returns {{observe: Function, getState: Function, reset: Function}}
 */
export function createSessionSupervisor({
  healers = {},
  gapWindows = DEFAULT_GAP_WINDOWS,
  frozenWindows = DEFAULT_FROZEN_WINDOWS,
  maxHeals = DEFAULT_MAX_HEALS,
} = {}) {
  let streakKind = null;
  let streak = 0;
  let state = STATE_OK;
  let activeFault = null;
  const healCounts = {};

  /** Windows a given fault must persist before we believe it. */
  function threshold(kind) {
    if (kind === 'input-gap') return gapWindows;
    if (kind === 'frozen') return frozenWindows;
    return 1; // contract-broken / audio-suspended are unambiguous
  }

  /**
   * Feed one observation. Returns an event describing what changed, or null.
   *
   * @param {object} obs see classify()
   * @returns {{type:string, kind?:string, attempts?:number, tier?:string}|null}
   */
  function observe(obs) {
    const kind = classify(obs);

    if (kind === null) {
      streakKind = null;
      streak = 0;
      const recovered = state === STATE_FAULT || state === STATE_HEALING;
      const next = obs.padCount > 0 ? STATE_OK : STATE_NO_PAD;
      const changed = next !== state;
      state = next;
      if (recovered) {
        const healed = activeFault;
        activeFault = null;
        return { type: 'healed', kind: healed };
      }
      activeFault = null;
      return changed ? { type: 'state', kind: null } : null;
    }

    // Same fault continuing, or a new one resetting the streak.
    if (kind !== streakKind) {
      streakKind = kind;
      streak = 1;
    } else {
      streak += 1;
    }

    if (streak < threshold(kind)) return null;       // still debouncing
    if (state === STATE_FAULT && activeFault === kind) return null; // already reported

    activeFault = kind;

    if (isSafe(kind)) {
      const used = healCounts[kind] || 0;
      if (used < maxHeals) {
        healCounts[kind] = used + 1;
        state = STATE_HEALING;
        let ok = false;
        try { ok = !!healers[kind]?.(); } catch { ok = false; }
        // Reset the streak so the next window judges the post-heal world afresh.
        streak = 0;
        return { type: 'heal-attempted', kind, attempts: healCounts[kind], ok };
      }
      // Budget spent — a "safe" fault we cannot fix is a real one.
      state = STATE_FAULT;
      return { type: 'unrecovered', kind, attempts: used, tier: 'safe-exhausted' };
    }

    state = STATE_FAULT;
    return { type: 'fault', kind, tier: 'risky' };
  }

  return {
    observe,
    getState: () => ({ state, fault: activeFault, heals: { ...healCounts } }),
    reset: () => {
      streakKind = null; streak = 0; state = STATE_OK; activeFault = null;
      Object.keys(healCounts).forEach((k) => delete healCounts[k]);
    },
  };
}
