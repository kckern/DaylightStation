/**
 * contentfilter worker — the filter worker's loop (runs in the Debian worker container, which has
 * refine's Python stack). Claims the oldest queued run from the shared run state, runs it with a
 * heartbeat, and marks runs whose worker died interrupted. The app only queues and reports.
 * ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md
 */
export const WORKER_POLL_MS = 5000;

/**
 * @param {{ jobs: object, owner: string, pollMs?: number, sleep?: (ms: number) => Promise<void>,
 *   log?: (event: string, data?: object) => void, ticks?: number }} p - ticks: stop after N (tests)
 */
export async function runWorker({ jobs, owner, pollMs = WORKER_POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {}, ticks = Infinity }) {
  log('content-filter.worker.started', { owner });
  for (let i = 0; i < ticks; i++) {
    try {
      const reaped = await jobs.reapStale();
      if (reaped) log('content-filter.worker.reaped', { owner, runs: reaped });
      const rk = await jobs.claimNext(owner);
      if (rk) { await jobs.runNext(rk, { owner }); continue; }
    } catch (e) {
      log('content-filter.worker.error', { owner, error: e.message });
    }
    await sleep(pollMs);
  }
}
