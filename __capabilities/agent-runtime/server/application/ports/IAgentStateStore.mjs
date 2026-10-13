/** Owner-scoped durable dispatch and interaction state. The update callback is
 * synchronous and must not perform external I/O. Implementations commit atomically.
 */
export class IAgentStateStore {
  load(_userId) { throw new Error('IAgentStateStore.load not implemented'); }
  update(_userId, _change) { throw new Error('IAgentStateStore.update not implemented'); }
}
