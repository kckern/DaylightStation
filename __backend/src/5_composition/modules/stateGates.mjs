/** Installed graph supplied explicitly; the neutral capability owns execution. */
import {createStateGatesModule as createStateGatesRuntime} from '../../../../__capabilities/state-gates/server/composition.mjs';
import {INSTALLED_STATE_GATES_POLICY} from './installedStateGatesPolicy.mjs';
export {stateGatesRetryDelay} from '../../../../__capabilities/state-gates/server/composition.mjs';
export async function createStateGatesModule({
  configService, eventBus, householdId, clock = { now: () => Date.now() }, logger = console,
  roleIds = [], producerPrincipals = {},
  installedPolicy = INSTALLED_STATE_GATES_POLICY,
  // Journal + projection share current.json and every commit rewrites the
  // whole file, so journal size is the cost of every write (JSON since
  // 2026-09-25: about 5 ms for 500 entries). 5000 entries / 30 days
  // let it reach 2.6 MB and never compact; 500 / 7d keeps a commit cheap while
  // still exceeding what replay (limit <= 500) or delivery recovery consumes.
  // Cursors older than compactedThrough get the 410 the design already handles.
  journalRetention = { maxEntries: 500, maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
  retryPolicy: retryPolicyInput = {},
}) {
  return createStateGatesRuntime({configService,eventBus,householdId,clock,logger,roleIds,producerPrincipals,installedPolicy,journalRetention,retryPolicy:retryPolicyInput});
}
export default createStateGatesModule;
