// fitnessAudience.js
/** The garage's audience during a workout: the active roster (guests unnamed). */
export function rosterAudience(roster) {
  const people = (Array.isArray(roster) ? roster : [])
    .filter((p) => p && p.isActive !== false)
    .map((p) => {
      const id = p.id || p.profileId || null;
      if (!id) return null;
      const guest = p.isGuest === true;
      return { id: String(id), name: guest ? null : (p.name ?? null), role: 'rider', guest };
    })
    .filter(Boolean);
  return people.length ? { activity: 'workout', people } : null;
}
