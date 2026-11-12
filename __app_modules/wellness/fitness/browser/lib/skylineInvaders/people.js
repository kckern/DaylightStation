// Who can be the shooter: the people already in the fitness session (they are
// wearing the heart-rate straps that set the shot tier), then everyone else
// the household has configured. Pure.

const idOf = (person) => (typeof person === 'string' ? person : person?.id || person?.userId || person?.profileId || null);
const nameOf = (person) => (typeof person === 'string'
  ? null
  : person?.displayLabel || person?.group_label || person?.groupLabel || person?.displayName || person?.name || null);

/** @returns {{ id: string, name: string }[]} session participants first; anonymous straps and the guest left out */
export function listInvadersPeople(ctx) {
  const configured = [
    ...(ctx?.users || []),
    ...(ctx?.userCollections?.all || []),
    ...Object.values(ctx?.usersConfig || {}).flatMap((group) => (Array.isArray(group) ? group : [])),
  ];
  const people = new Map();
  for (const person of [...(ctx?.participantRoster || []), ...configured]) {
    const id = idOf(person);
    if (!id || id === 'guest' || String(id).startsWith('device:')) continue;
    const name = nameOf(person);
    // A bare id or a nameless entry never replaces a fuller one for the same person.
    if (!people.has(id) || (people.get(id).name === id && name)) people.set(id, { id: String(id), name: name || String(id) });
  }
  return [...people.values()];
}
