// Guest is the dismiss-outcome identity — NEVER a roster entry / pick option.
export const GUEST_PROFILE = { id: 'guest', name: 'Guest' };

/** Resolve the active profile: roster match, or the synthetic Guest for 'guest', else null. */
export function resolveProfile(users, currentUser) {
  if (currentUser === GUEST_PROFILE.id) return GUEST_PROFILE;
  if (!currentUser) return null;
  return (users || []).find((u) => u.id === currentUser) || null;
}

/**
 * True only for an identity whose data persists server-side: a real roster id.
 * Guest (and "no user yet") must never hit the per-user endpoints — the backend
 * 400s them (only MIDI history accepts guest). This is THE gate every per-user
 * fetch/save runs through.
 */
export const isPersistentUser = (id) => !!id && id !== GUEST_PROFILE.id;
