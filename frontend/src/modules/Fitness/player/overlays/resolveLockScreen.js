/**
 * Single source of truth for which fitness lock UI is active and how it presents.
 * Pure — no React. Replaces the three independent booleans (cycle overlay visibility,
 * governance overlay visibility, audio host) that previously raced via the engine's
 * 200ms state cache + microtask render, producing blank/vanishing lock screens.
 *
 * @param {Object} args
 * @param {Object|null} args.activeChallenge - governanceState.challenge snapshot
 * @param {Object|null} args.governanceDisplay - result of useGovernanceDisplay
 * @returns {{
 *   variety: 'none'|'governance'|'cycle-health',
 *   showGovernanceOverlay: boolean,
 *   showCycleOverlay: boolean,
 *   promoteCycle: boolean,
 *   audioTrack: null|'init'|'locked',
 *   videoLocked: boolean
 * }}
 */
export function resolveLockScreen({ activeChallenge = null, governanceDisplay = null } = {}) {
  const isCycle = activeChallenge?.type === 'cycle';
  const isCycleHealthLock = isCycle
    && activeChallenge?.cycleState === 'locked'
    && activeChallenge?.lockReason === 'health';

  // Cycle health-lock wins outright: the cycle overlay becomes the promoted lock,
  // the generic governance panel is suppressed, lock music plays. This precedence
  // holds even if governance momentarily reports a non-unlocked status (the race
  // that previously produced a blank panel).
  if (isCycleHealthLock) {
    return {
      variety: 'cycle-health',
      showGovernanceOverlay: false,
      showCycleOverlay: true,
      promoteCycle: true,
      audioTrack: 'locked',
      videoLocked: true
    };
  }

  // Governance lock/pending/warning: defer to the existing governanceDisplay decision.
  if (governanceDisplay?.show) {
    return {
      variety: 'governance',
      showGovernanceOverlay: true,
      showCycleOverlay: false,
      promoteCycle: false,
      audioTrack: null, // GovernanceStateOverlay owns its own audio track selection
      videoLocked: Boolean(governanceDisplay?.videoLocked)
    };
  }

  // No lock screen active.
  return {
    variety: 'none',
    showGovernanceOverlay: false,
    showCycleOverlay: false,
    promoteCycle: false,
    audioTrack: null,
    videoLocked: Boolean(governanceDisplay?.videoLocked)
  };
}

export default resolveLockScreen;
