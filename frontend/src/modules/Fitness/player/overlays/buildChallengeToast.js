/**
 * Map a challenge toast event + governance challenge snapshot to a FitnessToast payload.
 * Pure. The success toast carries the contributors who earned it (§5B):
 *   - cycle challenge → the single rider
 *   - HR challenge    → every user who reached the target (metUsers)
 * Name resolution is injected so this stays decoupled from FitnessContext.
 *
 * @param {'start'|'end'} event
 * @param {Object} challenge - governanceState.challenge snapshot
 * @param {Object} [opts]
 * @param {(userId:string)=>string|null} [opts.resolveUserName] - resolve a display name
 * @returns {{ icon?: string, title: string, subtitle?: string, variant: string, contributors?: Array<{id:string,name:string,avatarUrl:string}> }}
 */
export function buildChallengeToast(event, challenge, { resolveUserName } = {}) {
  const c = challenge || {};
  const zoneLabel = c.zoneLabel || c.selectionLabel || null;
  const requiredCount = Number.isFinite(c.requiredCount) ? c.requiredCount : null;
  const actualCount = Number.isFinite(c.actualCount) ? c.actualCount : null;
  const peopleWord = (n) => (n === 1 ? 'person' : 'people');

  if (event === 'start') {
    const subtitle = (requiredCount != null && zoneLabel)
      ? `Get ${requiredCount} ${peopleWord(requiredCount)} to ${zoneLabel}`
      : undefined;
    return { icon: '🏆', title: 'Challenge started', subtitle, variant: 'info' };
  }

  // event === 'end' (success)
  const subtitle = (actualCount != null && requiredCount != null && zoneLabel)
    ? `${actualCount} of ${requiredCount} ${peopleWord(requiredCount)} reached ${zoneLabel}`
    : undefined;
  const toast = { icon: '🏆', title: 'Challenge complete!', subtitle, variant: 'success' };

  const contributors = buildContributors(c, resolveUserName);
  if (contributors.length) toast.contributors = contributors;
  return toast;
}

/**
 * Resolve the contributor list for a success toast. Cycle → rider only;
 * HR → all metUsers. Returns [] when no contributor data is present so the
 * caller can omit the key.
 */
function buildContributors(c, resolveUserName) {
  const resolve = (id) => (typeof resolveUserName === 'function' && resolveUserName(id)) || null;
  const toContributor = (id, name) => ({
    id,
    name: name || resolve(id) || id,
    avatarUrl: `/api/v1/static/img/users/${id}`,
  });

  if (c.type === 'cycle') {
    const rider = c.rider;
    return rider && rider.id ? [toContributor(rider.id, rider.name)] : [];
  }

  const metUsers = Array.isArray(c.metUsers) ? c.metUsers : [];
  return metUsers.filter(Boolean).map((id) => toContributor(id));
}

export default buildChallengeToast;
