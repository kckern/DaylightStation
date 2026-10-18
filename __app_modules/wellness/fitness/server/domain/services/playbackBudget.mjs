const RESETS = ['local_day', 'supervisor_join'];
const finiteNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export function normalizePlaybackBudgetPolicies(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new TypeError('playback_budgets must be an array');
  const ids = new Set();
  return raw.map(policy => {
    if (!policy || !/^[a-z0-9][a-z0-9_-]*$/.test(policy.id) || ids.has(policy.id)) throw new TypeError('Invalid or duplicate playback budget id');
    ids.add(policy.id);
    if (policy.match !== 'governed' || policy.when !== 'unattended') throw new TypeError('Unsupported playback budget matcher or condition');
    const minutes = policy.limit_minutes;
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) throw new TypeError('limit_minutes must be positive and finite');
    const resetOn = policy.reset_on ?? RESETS;
    if (!Array.isArray(resetOn) || RESETS.some(key => !resetOn.includes(key)) || resetOn.some(key => !RESETS.includes(key))) throw new TypeError('Playback budget resets must include local_day and supervisor_join');
    return { id: policy.id, match: policy.match, when: policy.when, limitMs: Math.round(minutes * 60000), resetOn: [...RESETS] };
  });
}
export function reconcileBudget(record, policy, { localDate, supervised }) {
  const dayChanged = record && record.localDate !== localDate;
  const joined = record && supervised && !record.supervisorPresent;
  if (!record || dayChanged || joined) {
    return { policyId: policy.id, localDate, generation: (record?.generation ?? 0) + 1, spentMs: 0, reservations: {}, supervisorPresent: supervised };
  }
  return { ...record, supervisorPresent: supervised };
}
export function budgetView(record, policy) {
  const remainingMs = Math.max(0, policy.limitMs - record.spentMs);
  return { id: policy.id, generation: record.generation, limitMs: policy.limitMs, spentMs: record.spentMs, remainingMs, expired: remainingMs === 0 };
}
export function reserveBudget(record, policy, { id, streamId, nowMs, nextResetAtMs }) {
  const ms = Math.max(0, Math.min(5000, budgetView(record, policy).remainingMs, nextResetAtMs - nowMs));
  if (!ms || record.supervisorPresent) return { record, grant: null };
  if (!id || !streamId || record.reservations[id]) throw new TypeError('Invalid playback grant identity');
  const grant = { id, streamId, generation: record.generation, localDate: record.localDate, ms, issuedAt: nowMs, expiresAt: Math.min(nowMs + 15000, nextResetAtMs) };
  return { record: { ...record, spentMs: record.spentMs + ms, reservations: { ...record.reservations, [id]: grant } }, grant };
}
export function settleBudget(record, id, playedMs) {
  const grant = record.reservations?.[id];
  if (!grant || grant.generation !== record.generation) return record;
  if (!finiteNonnegative(playedMs) || playedMs > grant.ms) throw new TypeError('Invalid playback grant settlement');
  const reservations = { ...record.reservations }; delete reservations[id];
  return { ...record, spentMs: Math.max(0, record.spentMs - (grant.ms - playedMs)), reservations };
}
export function assessPlaybackBudget({ policy, record, nowMs, localDate, nextResetAtMs, supervised }) {
  const updated = reconcileBudget(record, policy, { localDate, supervised });
  return { record: updated, ...budgetView(updated, policy), eligible: !supervised, resetReason: !record ? 'initial' : record.localDate !== localDate ? 'local_day' : supervised && !record.supervisorPresent ? 'supervisor_join' : null };
}
