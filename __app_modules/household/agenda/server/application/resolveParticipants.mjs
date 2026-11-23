const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const fail = (field, message) => { throw Object.assign(new Error(message), {code:'invalid_participant_context', field}); };
/** Resolve references. A named person's name and photo come from the household directory
 * (the single source of truth); the plan's saved display is only for anonymous slots. */
export async function resolveParticipants({ plan, directory }) {
  const seen = new Set();
  const result = [];
  for (let [index, entry] of plan.participants.entries()) {
    const field = `participants.${index}`;
    let runtimeId;
    if (entry.person) {
      if (!['user', 'guest'].includes(entry.person.kind)) fail(`${field}.person.kind`, 'Unknown person kind');
      const identity = await directory.resolve({ householdId: plan.household_id, person: entry.person });
      if (!identity) fail(`${field}.person`, `Unknown person: ${entry.person.id}`);
      entry = { ...entry, display: identity.display };
      runtimeId = entry.person.kind === 'guest' ? `guest:${entry.person.id}` : entry.person.id;
    } else if (entry.anonymous === true) {
      if (typeof plan.plan_id !== 'string' || typeof entry.id !== 'string' || plan.plan_id.includes(':') || entry.id.includes(':')) fail(`${field}.id`, 'Ambiguous anonymous participant ID');
      runtimeId = `anon:${plan.plan_id}:${entry.id}`;
    }
    else fail(field, 'Unknown participant');
    if (typeof runtimeId !== 'string' || !ID.test(runtimeId)) fail(entry.person ? `${field}.person.id` : `${field}.id`, 'Invalid runtime participant ID');
    if (seen.has(runtimeId)) fail(entry.person ? `${field}.person` : `${field}.id`, 'Runtime participant ID collision');
    seen.add(runtimeId);
    result.push({ ...entry, display: { ...entry.display, avatar: entry.display?.avatar ?? null }, runtimeId });
  }
  return result;
}
