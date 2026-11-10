/**
 * Test double for ParticipantRoster.getActiveParticipantState(): the canonical
 * participant state the engine's pulse path reads.
 */
export function canonicalState(roster) {
  const participants = [];
  const zoneMap = {};
  for (const entry of roster) {
    if (!entry?.isActive) continue;
    participants.push(entry.id);
    if (entry.zoneId) zoneMap[entry.id] = String(entry.zoneId).toLowerCase();
  }
  return { participants, zoneMap, totalCount: participants.length };
}
