const pending = (r, now) => ['prepared', 'quarantined'].includes(r.status) && r.expiresAt > now;
const acknowledged = r => Number.isFinite(r.deliveredAt) && ['delivered', 'responded'].includes(r.status);
/** Coalesce the same delivery across the Work reservation and KB receipt stores. */
export function mergeAttentionHistory(records, history = {}) {
  const merged = new Map();
  for (const row of [...records, ...(history.reservations ?? []), ...(history.deliveries ?? [])]) {
    const id = row.reservationId ?? row.id;
    if (typeof id !== 'string' || !id) continue;
    const old = merged.get(id);
    merged.set(id, !old ? {
      ...row,
      id
    } : acknowledged(row) ? {
      ...old,
      ...row,
      id
    } : acknowledged(old) ? {
      ...row,
      ...old,
      id
    } : {
      ...row,
      ...old,
      id
    });
  }
  return [...merged.values()];
}
export function attentionEligibility({
  records,
  policy,
  day,
  asOf,
  channel,
  questionUnits,
  refKey = null,
  flowType = null
}) {
  const proactive = r => !['direct_request', 'echo', 'quiz'].includes(r.channel);
  const exposedUnits = records.filter(r => r.day === day && proactive(r) && acknowledged(r)).reduce((n, r) => n + r.questionUnits, 0);
  const reservedUnits = records.filter(r => r.day === day && proactive(r) && pending(r, asOf)).reduce((n, r) => n + r.questionUnits, 0);
  const result = (allowed, reason) => ({
    allowed,
    reason,
    exposedUnits,
    reservedUnits
  });
  if (['direct_request', 'echo', 'quiz'].includes(channel) || questionUnits === 0) return result(true, null);
  if (exposedUnits + reservedUnits + questionUnits > Math.min(2, policy.maxProactiveUnitsPerDay)) return result(false, 'daily_budget');
  if (channel === 'housekeeping' || flowType === 'housekeeping') {
    const housekeeping = records.filter(r => r.channel === 'housekeeping' || r.flowType === 'housekeeping');
    if (housekeeping.some(r => pending(r, asOf))) return result(false, 'pending_housekeeping');
    if (housekeeping.filter(r => acknowledged(r) && asOf - r.deliveredAt < 7 * 86400000).length >= policy.maxHousekeepingPer7Days) return result(false, 'weekly_housekeeping');
    if (refKey && housekeeping.some(r => r.refKey === refKey && acknowledged(r) && asOf - r.deliveredAt < policy.itemCooldownDays * 86400000)) return result(false, 'item_cooldown');
  }
  return result(true, null);
}
