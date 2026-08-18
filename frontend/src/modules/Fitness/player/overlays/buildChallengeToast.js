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
 * @param {(zoneKey:string)=>string|null} [opts.resolveZoneColor] - resolve a zone hex color
 * @returns {{ icon?: string, title: string, subtitle?: string, variant: string, contributors?: Array<{id:string,name:string,avatarUrl:string}>, zone?: {id:string,label:string,color:string} }}
 */

/**
 * "Felix", "Felix & Milo", "Felix, Milo & Alan" — the way a person would say it.
 * A bare comma-joined list reads like a database row, and this line is meant to
 * be read out loud by whoever is standing there.
 */
export function joinNames(names) {
  const list = (names || []).filter(Boolean);
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} & ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`;
}

/** "45s" / "1:20" — short enough to sit in a subtitle. */
export function formatElapsed(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** How long the challenge actually took, from whichever fields are present. */
export function elapsedSecondsFor(c) {
  if (Number.isFinite(c?.totalSeconds) && Number.isFinite(c?.remainingSeconds)) {
    const used = c.totalSeconds - c.remainingSeconds;
    if (used > 0) return used;
  }
  if (Number.isFinite(c?.completedAt) && Number.isFinite(c?.startedAt)) {
    return (c.completedAt - c.startedAt) / 1000;
  }
  return null;
}

export function buildChallengeToast(event, challenge, { resolveUserName, resolveZoneColor } = {}) {
  const c = challenge || {};
  const zoneLabel = c.zoneLabel || c.selectionLabel || null;
  const requiredCount = Number.isFinite(c.requiredCount) ? c.requiredCount : null;
  const actualCount = Number.isFinite(c.actualCount) ? c.actualCount : null;
  const peopleWord = (n) => (n === 1 ? 'person' : 'people');

  // Attach a colored zone descriptor so the toast can render a zone-hued pill
  // (issue 3). HR challenges only — cycle challenges carry no HR zone. Omitted
  // entirely unless a color resolves, so we never show an uncolored pill.
  const attachZone = (toast) => {
    if (c.type === 'cycle' || !zoneLabel || typeof resolveZoneColor !== 'function') return toast;
    const id = zoneKey(c.zone || c.zoneLabel || c.selectionLabel);
    const color = (id && resolveZoneColor(id)) || resolveZoneColor(zoneKey(zoneLabel)) || null;
    if (!color) return toast;
    toast.zone = { id, label: zoneLabel, color };
    return toast;
  };

  if (event === 'start') {
    if (c.type === 'cycle') {
      return { icon: '🚴', title: 'Cycling challenge started', variant: 'info' };
    }
    const subtitle = (requiredCount != null && zoneLabel)
      ? `Get ${requiredCount} ${peopleWord(requiredCount)} to ${zoneLabel}`
      : undefined;
    return attachZone({ icon: '🏆', title: 'Challenge started', subtitle, variant: 'info' });
  }

  // event === 'end' (success)
  if (c.type === 'cycle') {
    const riderName = (c.rider && (c.rider.name || c.rider.id))
      || (typeof resolveUserName === 'function' && c.rider?.id && resolveUserName(c.rider.id))
      || 'Rider';
    const phases = Number.isFinite(c.totalPhases) ? c.totalPhases : null;
    // The RIDER is the headline. "Challenge complete!" told the room a thing
    // happened; it did not tell them who did it or what it took, which is the
    // whole point of stopping to celebrate.
    const took = formatElapsed(elapsedSecondsFor(c));
    const cycleTitle = phases != null
      ? `${riderName} rode ${phases} phase${phases === 1 ? '' : 's'}`
      : `${riderName} finished the ride`;
    const cycleSubtitle = took ? `in ${took}` : undefined;
    const cycleToast = { icon: '🏆', title: cycleTitle, subtitle: cycleSubtitle, variant: 'success', achievement: true };
    const cycleContributors = buildContributors(c, resolveUserName);
    if (cycleContributors.length) cycleToast.contributors = cycleContributors;
    return cycleToast;
  }

  const contributors = buildContributors(c, resolveUserName);
  const names = joinNames(contributors.map((x) => x.name));
  const took = formatElapsed(elapsedSecondsFor(c));

  // Who did it, and what they did — in that order. It used to lead with
  // "Challenge complete!" and put the achievement in a count ("2 of 2 people
  // reached Hot"), which reads like a tally rather than a result. The people are
  // the reason this moment exists.
  const title = names && zoneLabel ? `${names} reached ${zoneLabel}`
    : names ? `${names} did it`
    : 'Challenge complete!';

  const parts = [];
  if (took) parts.push(`in ${took}`);
  // Keep the count only when it adds something the names do not already say.
  if (actualCount != null && requiredCount != null && actualCount !== contributors.length) {
    parts.push(`${actualCount} of ${requiredCount} ${peopleWord(requiredCount)}`);
  }
  const subtitle = parts.length ? parts.join(' · ') : undefined;

  const toast = { icon: '🏆', title, subtitle, variant: 'success', achievement: true };
  if (contributors.length) toast.contributors = contributors;
  return attachZone(toast);
}

/** Normalize a zone id/label to a lowercase lookup key (e.g. "Warm" → "warm"). */
function zoneKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
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
