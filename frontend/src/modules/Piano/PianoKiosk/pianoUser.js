// Guest is the dismiss-outcome identity — NEVER a roster entry / pick option.
export const GUEST_PROFILE = { id: 'guest', name: 'Guest' };

/** Resolve the active profile: roster match, or the synthetic Guest for 'guest', else null. */
export function resolveProfile(users, currentUser) {
  if (currentUser === GUEST_PROFILE.id) return GUEST_PROFILE;
  if (!currentUser) return null;
  return (users || []).find((u) => u.id === currentUser) || null;
}
