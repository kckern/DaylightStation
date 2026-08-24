import { isPersistentUser } from '../../pianoUser.js';

/** A challenge is never silently reinterpreted as practice for an anonymous user. */
export function resolveExerciseRunAccess(intent, currentUser) {
  const challenge = intent === 'challenge';
  const persistent = isPersistentUser(currentUser);
  return Object.freeze({ challenge, persistent, allowed: !challenge || persistent });
}
