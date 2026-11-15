const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
/** Resolve references without modifying the plan's explicitly saved display snapshots. */
export async function resolveParticipants({ plan, directory }) {
  const seen = new Set();
  const result = [];
  for (const entry of plan.participants) {
    let runtimeId;
    if (entry.person) {
      if (!['user', 'guest'].includes(entry.person.kind)) throw new Error('Unknown person kind');
      const identity = await directory.resolve({ householdId: plan.household_id, person: entry.person });
      if (!identity) throw new Error(`Unknown person: ${entry.person.id}`);
      runtimeId = entry.person.kind === 'guest' ? `guest:${entry.person.id}` : entry.person.id;
    } else if (entry.anonymous === true) {
      if (typeof plan.plan_id !== 'string' || typeof entry.id !== 'string' || plan.plan_id.includes(':') || entry.id.includes(':')) throw new Error('Ambiguous anonymous participant ID');
      runtimeId = `anon:${plan.plan_id}:${entry.id}`;
    }
    else throw new Error('Unknown participant');
    if (typeof runtimeId !== 'string' || !ID.test(runtimeId)) throw new Error('Invalid runtime participant ID');
    if (seen.has(runtimeId)) throw new Error('Runtime participant ID collision');
    seen.add(runtimeId);
    result.push({ ...entry, display: { ...entry.display, avatar: entry.display?.avatar ?? null }, runtimeId });
  }
  return result;
}
