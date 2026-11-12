import { isDeepStrictEqual } from 'node:util';

function valid(record) {
  const run = record?.run;
  return record?.schema === 'skyline-invaders-run/v1'
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(run?.id || '')
    && /^[a-z][a-z0-9-]+$/.test(run?.level_id || '')
    && ['completed', 'failed', 'abandoned'].includes(run?.status)
    && Number.isFinite(run?.duration_s)
    && Number.isFinite(Date.parse(run?.started_at))
    && Number.isFinite(Date.parse(run?.ended_at))
    && typeof record?.rider?.user_id === 'string'
    && Number.isInteger(run?.stars) && run.stars >= 0 && run.stars <= 3
    && Number.isFinite(run?.score);
}

export class SkylineInvadersRunService {
  constructor({ datastore, progress = null, logger = console } = {}) {
    if (!datastore) throw new Error('SkylineInvadersRunService requires datastore');
    this.datastore = datastore;
    this.progress = progress;
    this.logger = logger;
  }
  async save(record, householdId) {
    if (!valid(record)) { const error = new Error('invalid Skyline Invaders run'); error.code = 'INVALID_RUN'; throw error; }
    const existing = await this.datastore.findById(record.run.id, householdId);
    if (existing) {
      if (!isDeepStrictEqual(existing, record)) { const error = new Error('run id already exists with different content'); error.code = 'RUN_CONFLICT'; throw error; }
      return { created: false, record: existing };
    }
    const file = await this.datastore.create(record, householdId);
    this.logger.info?.('fitness.skyline_invaders.run.saved', { runId: record.run.id, status: record.run.status });
    // Progress is derived from the run log; a failed update is rebuilt later and
    // must never fail the save that the reward depends on.
    try {
      await this.progress?.recordRun(record, householdId);
    } catch (error) {
      this.logger.warn?.('fitness.skyline_invaders.progress.record_failed', { runId: record.run.id, error: error.message });
    }
    return { created: true, record, file };
  }
  get(runId, householdId) { return this.datastore.findById(runId, householdId); }
  listByDate(date, householdId) { return this.datastore.findByDate(date, householdId); }
  /** Every saved run, in no particular order. */
  listAll(householdId) { return this.datastore.findAll(householdId); }
}
