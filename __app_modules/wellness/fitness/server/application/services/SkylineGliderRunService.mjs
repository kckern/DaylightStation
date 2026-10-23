import { isDeepStrictEqual } from 'node:util';

function valid(record) {
  const run = record?.run;
  return record?.schema === 'skyline-glider-run/v1'
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(run?.id || '')
    && /^[a-z][a-z0-9-]+$/.test(run?.course_id || '')
    && ['completed', 'abandoned'].includes(run?.status)
    && Number.isFinite(run?.duration_s)
    && Number.isFinite(Date.parse(run?.started_at))
    && Number.isFinite(Date.parse(run?.ended_at))
    && typeof record?.rider?.user_id === 'string'
    && Array.isArray(record?.collectibles);
}

export class SkylineGliderRunService {
  constructor({ datastore, progress = null, logger = console } = {}) {
    if (!datastore) throw new Error('SkylineGliderRunService requires datastore');
    this.datastore = datastore;
    this.progress = progress;
    this.logger = logger;
  }
  async save(record, householdId) {
    if (!valid(record)) { const error = new Error('invalid Skyline Glider run'); error.code = 'INVALID_RUN'; throw error; }
    const existing = await this.datastore.findById(record.run.id, householdId);
    if (existing) {
      if (!isDeepStrictEqual(existing, record)) { const error = new Error('run id already exists with different content'); error.code = 'RUN_CONFLICT'; throw error; }
      return { created: false, record: existing };
    }
    const file = await this.datastore.create(record, householdId);
    this.logger.info?.('fitness.skyline_glider.run.saved', { runId: record.run.id, status: record.run.status });
    // Progress is derived from the run log; a failed update is rebuilt later and
    // must never fail the save that the reward depends on.
    try {
      await this.progress?.recordRun(record, householdId);
    } catch (error) {
      this.logger.warn?.('fitness.skyline_glider.progress.record_failed', { runId: record.run.id, error: error.message });
    }
    return { created: true, record, file };
  }
  get(runId, householdId) { return this.datastore.findById(runId, householdId); }
  listByDate(date, householdId) { return this.datastore.findByDate(date, householdId); }
}
