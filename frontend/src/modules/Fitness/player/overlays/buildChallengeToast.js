/**
 * Map a challenge toast event + governance challenge snapshot to a FitnessToast payload.
 * Pure. Group event (no single rider) → no avatar, uses the 🏆 icon slot.
 *
 * @param {'start'|'end'} event
 * @param {Object} challenge - governanceState.challenge snapshot
 * @returns {{ icon: string, title: string, subtitle?: string, variant: string }}
 */
export function buildChallengeToast(event, challenge) {
  const c = challenge || {};
  const zoneLabel = c.zoneLabel || c.selectionLabel || null;
  const requiredCount = Number.isFinite(c.requiredCount) ? c.requiredCount : null;
  const actualCount = Number.isFinite(c.actualCount) ? c.actualCount : null;
  const riderWord = (n) => (n === 1 ? 'rider' : 'riders');

  if (event === 'start') {
    const subtitle = (requiredCount != null && zoneLabel)
      ? `Get ${requiredCount} ${riderWord(requiredCount)} to ${zoneLabel}`
      : undefined;
    return { icon: '🏆', title: 'Challenge started', subtitle, variant: 'info' };
  }

  // event === 'end' (success)
  const subtitle = (actualCount != null && requiredCount != null && zoneLabel)
    ? `${actualCount} of ${requiredCount} ${riderWord(requiredCount)} reached ${zoneLabel}`
    : undefined;
  return { icon: '🏆', title: 'Challenge complete!', subtitle, variant: 'success' };
}

export default buildChallengeToast;
