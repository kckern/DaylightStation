const normalize = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
/** A roster id that can be governed: not a supervisor, not exempt. (Guests are excluded by callers.) */
export function isGovernedChildId(id, { supervisorIds = [], exemptIds = [] } = {}) {
  const key = normalize(typeof id === 'number' ? String(id) : id);
  if (!key) return false;
  return !supervisorIds.some(v => normalize(v) === key) && !exemptIds.some(v => normalize(v) === key);
}
export function classifySupervision({ participantIds = [], supervisorIds = [] } = {}) {
  const supervisors = new Set(supervisorIds.map(normalize).filter(Boolean));
  const present = [...new Set(participantIds.map(normalize).filter(id => supervisors.has(id)))];
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
