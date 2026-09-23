/**
 * Owner-scoped durable artwork remediation queue (design 2026-09-23 §5).
 * `load` returns `{ version, items: { [key]: item } }`. The `update` callback is
 * synchronous, must not perform external I/O, and its result is returned;
 * implementations commit atomically.
 */
export class IArtworkQueueStore {
  load(_userId) { throw new Error('IArtworkQueueStore.load not implemented'); }
  update(_userId, _change) { throw new Error('IArtworkQueueStore.update not implemented'); }
}
