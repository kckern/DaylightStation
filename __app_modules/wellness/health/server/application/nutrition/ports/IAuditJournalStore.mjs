/**
 * Append-only per-user journal of auditor runs and skips (design 2026-09-25).
 *
 * A row is a plain object with a required ISO `at` and either a `runId` (a run;
 * a later row with the same runId supersedes an earlier one, e.g. completed
 * over started) or `skipped` (a skip; never deduped).
 */
export class IAuditJournalStore {
  async append(_userId, _row) { throw new Error('IAuditJournalStore.append not implemented'); }
  /** Rows with `at` in [from, to), newest first. Dates are ISO strings. */
  async list(_userId, _range) { throw new Error('IAuditJournalStore.list not implemented'); }
  /**
   * The latest row for one run, or null. `around` (ISO) is a time near the run's
   * `at`: only the journal around it is read. Without it, months are read newest
   * first and the search stops at the first month that has the run.
   */
  async findRun(_userId, _runId, _options) { throw new Error('IAuditJournalStore.findRun not implemented'); }
}
