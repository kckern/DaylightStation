/**
 * DisplayNameResolver — back-compat shim.
 *
 * The display-name SSOT moved to core (`frontend/src/lib/userDisplayName.js`)
 * because it's reused well beyond Fitness (piano "Who's playing?", momentum, …).
 * This file re-exports everything so existing Fitness imports keep working.
 * Prefer importing from `@/lib/userDisplayName.js` in new code.
 */
export {
  resolveUserDisplayName,
  hasFamilyContext,
  shouldPreferGroupLabels,
  countActiveHrDevices,
  buildDisplayNameContext,
  resolveDisplayName,
  resolveAllDisplayNames,
  getPriorityChain,
} from '@/lib/userDisplayName.js';
