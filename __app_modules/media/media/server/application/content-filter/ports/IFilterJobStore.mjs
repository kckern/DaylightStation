/**
 * Run state for content-filter pipeline runs, one record per film:
 * { ratingKey, runs: [{ id, kind: 'make'|'send-back'|'stage', cues?, stage?, status:
 *   'queued'|'running'|'done'|'failed'|'interrupted', step, steps: [{ name, status, startedAt,
 *   endedAt, error }], requestedBy, queuedAt, startedAt, endedAt, log, worker? }],
 *   audit: { ok, at, digest, level, rows, failures } }
 * Shared by the app (queues, reports) and the filter worker (claims, runs).
 */
export class IFilterJobStore {
  /** @returns {Promise<object|null>} */
  async load(_ratingKey) { throw new Error('IFilterJobStore.load not implemented'); }
  async save(_ratingKey, _record) { throw new Error('IFilterJobStore.save not implemented'); }
  /** Claim one run for a worker; true for exactly one caller across processes. */
  async claim(_ratingKey, _runId, _owner) { throw new Error('IFilterJobStore.claim not implemented'); }
  /** @returns {Promise<object[]>} every record */
  async list() { throw new Error('IFilterJobStore.list not implemented'); }
}
