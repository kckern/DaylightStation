/**
 * GovernanceGate — pure-JS governance adapters for the Emulator Console.
 *
 * These are framework primitives: dependency-free, no React, no network.
 * Each factory returns an object exposing a small uniform surface so the
 * consumer can treat governance modes interchangeably.
 */

const NOOP_UNSUBSCRIBE = () => {};

/**
 * Open mode: playback is never gated.
 * @returns {{ mode: 'open', isPlayable: () => boolean, getStatus: () => { state: string }, onChange: (cb: Function) => Function }}
 */
export function createOpenGate() {
  return {
    mode: 'open',
    isPlayable: () => true,
    getStatus: () => ({ state: 'playing' }),
    onChange: () => NOOP_UNSUBSCRIBE,
  };
}

/**
 * Gate mode: playability is driven by an externally-supplied phase.
 * @param {{ getPhase: () => ('unlocked'|'warning'|'pending'|'locked'|undefined) }} deps
 */
export function createGateAdapter({ getPhase }) {
  const statusForPhase = (phase) => {
    switch (phase) {
      case 'unlocked':
        return { state: 'playing' };
      case 'warning':
        return { state: 'warning' };
      default:
        // pending, locked, undefined, anything else
        return { state: 'paused' };
    }
  };

  return {
    mode: 'gate',
    isPlayable: () => getPhase() === 'unlocked',
    getStatus: () => statusForPhase(getPhase()),
    // Phase polling is the consumer's responsibility; keep this simple.
    onChange: () => NOOP_UNSUBSCRIBE,
  };
}

/**
 * Credit mode: accumulates "credit seconds" while in-zone and spends them
 * while playing. Earn first (clamped to max), then spend (clamped to >= 0).
 * @param {{ earnRate: number, maxCredit: number }} deps
 */
export function createCreditAccumulator({ earnRate, maxCredit }) {
  let creditSeconds = 0;

  return {
    get creditSeconds() {
      return creditSeconds;
    },
    /**
     * Advance the accumulator by dtSec.
     * @param {number} dtSec elapsed seconds
     * @param {boolean} inZone whether the rider is in the required zone
     */
    tick(dtSec, inZone) {
      // 1. Earn while in-zone, clamp to max.
      if (inZone) {
        creditSeconds += earnRate * dtSec;
        if (creditSeconds > maxCredit) creditSeconds = maxCredit;
      }
      // 2. Spend (time passes while playing), clamp to >= 0.
      creditSeconds -= dtSec;
      if (creditSeconds < 0) creditSeconds = 0;
    },
    isPlayable: () => creditSeconds > 0,
  };
}
