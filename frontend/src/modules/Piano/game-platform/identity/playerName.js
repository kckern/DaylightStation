import { resolveUserDisplayName } from '../../../../lib/userDisplayName.js';

/**
 * A player label is presentation, never a database-key dump.
 *
 * The office surface supplies an explicit name resolved from its roster. The
 * kiosk usually supplies a hydrated profile. If neither is available, use a
 * neutral role label rather than exposing a slug such as `learner4-kern`.
 */
export function resolvePianoPlayerName(currentUser, explicitName = null) {
  const explicit = String(explicitName || '').trim();
  if (explicit) return explicit;

  if (currentUser && typeof currentUser === 'object') {
    const resolved = resolveUserDisplayName(currentUser, { familyContext: true });
    if (resolved.source !== 'fallback') return resolved.displayName;
  }

  const id = typeof currentUser === 'string'
    ? currentUser
    : currentUser?.id || currentUser?.user_id || currentUser?.userId || null;
  return !id || id === 'guest' ? 'Guest' : 'Player';
}

