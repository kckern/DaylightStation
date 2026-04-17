/**
 * cycleLockPanelData.js
 *
 * Pure helper that maps a cycle challenge snapshot (when locked) to the
 * display data used by `GovernanceStateOverlay`'s cycle-lock panel.
 *
 * The lock panel for a cycle challenge differs from the zone-challenge
 * equivalent: it shows a single row for the current rider with RPM pills
 * (current vs target) plus a progress bar indicating how close the rider
 * is to hitting the recovery threshold.
 *
 * Returns `null` when the challenge isn't a cycle challenge in the
 * `locked` state, letting callers skip the cycle branch entirely.
 */

/**
 * Compute the display data for the cycle-locked lock panel.
 *
 * @param {Object|null} challenge - Cycle challenge snapshot.
 * @param {string} [challenge.type] - Expected to be `'cycle'`.
 * @param {string} [challenge.cycleState] - Expected to be `'locked'`.
 * @param {string} [challenge.lockReason] - One of `'init'|'ramp'|'maintain'`.
 * @param {number} [challenge.currentRpm] - Rider's current RPM.
 * @param {number} [challenge.initMinRpm] - Init-state minimum RPM target.
 * @param {Object} [challenge.currentPhase] - Current phase info.
 * @param {number} [challenge.currentPhase.hiRpm] - High RPM threshold.
 * @param {Object} [challenge.selection] - Selection snapshot (fallback).
 * @param {Object} [challenge.rider] - Current rider info.
 * @param {string} [riderZone] - Rider's current HR zone (defaults to 'cool').
 * @returns {Object|null} Lock panel display data or `null`.
 */
export function computeCycleLockPanelData(challenge, riderZone) {
  if (!challenge || challenge.type !== 'cycle' || challenge.cycleState !== 'locked') {
    return null;
  }

  const lockReason = challenge.lockReason;
  const phase = challenge.currentPhase;
  const currentRpm = Number.isFinite(challenge.currentRpm) ? challenge.currentRpm : 0;

  let targetRpm;
  let instruction;

  if (lockReason === 'init') {
    targetRpm = Number.isFinite(challenge.initMinRpm)
      ? challenge.initMinRpm
      : (Number.isFinite(challenge.selection?.init?.minRpm)
          ? challenge.selection.init.minRpm
          : 30);
    instruction = `Get on the bike — reach ${targetRpm} RPM`;
  } else if (lockReason === 'ramp' || lockReason === 'maintain') {
    targetRpm = Number.isFinite(phase?.hiRpm) ? phase.hiRpm : 0;
    instruction = lockReason === 'ramp'
      ? `Climb to ${targetRpm} RPM`
      : `Reach ${targetRpm} RPM to resume`;
  } else {
    targetRpm = Number.isFinite(phase?.hiRpm) ? phase.hiRpm : 0;
    instruction = `Reach ${targetRpm} RPM to resume`;
  }

  const progress = targetRpm > 0
    ? Math.max(0, Math.min(1, currentRpm / targetRpm))
    : 0;

  return {
    title: 'Cycle Challenge Locked',
    instruction,
    rider: challenge.rider || null,
    zone: riderZone || 'cool',
    currentRpm,
    targetRpm,
    progress
  };
}

export default computeCycleLockPanelData;
