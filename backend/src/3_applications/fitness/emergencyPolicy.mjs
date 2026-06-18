// backend/src/3_applications/fitness/emergencyPolicy.mjs
import { resolveCandidateUuids } from './unlockPolicy.mjs';

/**
 * The lock name whose authorized users are the admins permitted to trigger /
 * release an emergency lockdown. Configured under `locks.emergency` in fitness
 * config.
 */
export const EMERGENCY_LOCK = 'emergency';

/**
 * Build the candidate fingerprint UUIDs for the emergency lock from config +
 * live user profiles. Mirrors the normal unlock candidate resolution, scoped to
 * the emergency lock.
 *
 * @param {object} args
 * @param {object} args.fitnessConfig - raw fitness config (with a `locks` map)
 * @param {{ getProfile?: (username: string) => object }} args.userService
 * @returns {Array<{ uuid: string, username: string }>}
 */
export function resolveEmergencyCandidates({ fitnessConfig, userService } = {}) {
  const authorized = fitnessConfig?.locks?.[EMERGENCY_LOCK];
  if (!Array.isArray(authorized) || authorized.length === 0) return [];
  const profilesByUser = {};
  for (const username of authorized) {
    const profile = userService?.getProfile?.(username);
    if (profile) profilesByUser[username] = profile;
  }
  return resolveCandidateUuids(fitnessConfig, profilesByUser, EMERGENCY_LOCK);
}
