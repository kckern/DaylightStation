const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const has = (list, key) => (list ?? []).some(v => normalize(v) === key);
/**
 * The one governed-child rule, shared by the browser and the budget server:
 * a roster id that is not a supervisor, not exempt, and not a guest assignment.
 */
export function isGovernedChildId(id, { supervisorIds = [], exemptIds = [], guestIds = [] } = {}) {
  const key = normalize(typeof id === 'number' ? String(id) : id);
  if (!key) return false;
  return !has(supervisorIds, key) && !has(exemptIds, key) && !has(guestIds, key);
}
/**
 * A supervisor counts as present only on their own (owned/member) strap —
 * never as a guest assignment, which needs no PIN and would let a child
 * "pick Mom" in the guest picker to stand governance down.
 */
export function classifySupervision({ participantIds = [], supervisorIds = [], guestIds = [] } = {}) {
  const supervisors = new Set(supervisorIds.map(normalize).filter(Boolean));
  const guests = new Set((guestIds ?? []).map(normalize).filter(Boolean));
  const present = [...new Set(participantIds.map(normalize).filter(id => supervisors.has(id) && !guests.has(id)))];
  return { supervised: present.length > 0, supervisorIds: present };
}

/**
 * Supervising adults are a ROLE, not a list: every household profile of
 * type `owner`, plus anyone given `roles: [guardian]`. Replaces the retired
 * fitness `governance.superusers` list.
 */
export function resolveSupervisorIds(profiles, householdId, defaultHouseholdId) {
  const entries = profiles instanceof Map ? [...profiles.entries()] : [...(profiles ?? [])];
  return entries
    .filter(([, p]) => p && (p.household_id ?? defaultHouseholdId) === householdId)
    .filter(([, p]) => p.type === 'owner' || (Array.isArray(p.roles) && p.roles.includes('guardian')))
    .map(([username]) => username)
    .sort();
}
