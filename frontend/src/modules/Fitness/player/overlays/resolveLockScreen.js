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
 *   variety: 'none'|'governance'|'cycle-lock'|'cycle-fail',
 *   showGovernanceOverlay: boolean,
 *   showCycleOverlay: boolean,
 *   promoteCycle: boolean,
 *   audioTrack: null|'init'|'locked',
 *   videoLocked: boolean
 * }}
 */
export function resolveLockScreen({ activeChallenge = null, governanceDisplay = null } = {}) {
  const isCycle = activeChallenge?.type === 'cycle';
  const cycleLocked = isCycle && activeChallenge?.cycleState === 'locked';
  const cycleFailed = isCycle && (activeChallenge?.status === 'failed' || activeChallenge?.status === 'abandoned');

  // A cycle challenge owns its own presentation in EVERY state. The generic
  // governance panel is never shown while a cycle challenge is active — it has
  // no cycle-aware content and previously rendered as a blank box for non-health
  // locks (and lingered after recovery). Promote the cycle overlay as a centered
  // lock stage for any lock reason and on terminal fail.
  if (isCycle) {
    const promote = cycleLocked || cycleFailed;
    return {
      variety: promote ? (cycleFailed ? 'cycle-fail' : 'cycle-lock') : 'none',
      showGovernanceOverlay: false,
      showCycleOverlay: true,
      promoteCycle: promote,
      audioTrack: promote ? 'locked' : null,
      videoLocked: promote
    };
  }

  // Non-cycle governance lock/pending/warning: defer to governanceDisplay.
  if (governanceDisplay?.show) {
    return {
      variety: 'governance',
      showGovernanceOverlay: true,
      showCycleOverlay: false,
      promoteCycle: false,
      audioTrack: null,
      videoLocked: Boolean(governanceDisplay?.videoLocked)
    };
  }

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
