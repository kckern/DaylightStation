/**
 * The scheduler's handle on the stale-session sweep — the missing piece that
 * kept it from ever running (see MarkSessionAbandoned.sweepUntouched).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  SchoolMaintenanceExecutor, SCHOOL_STALE_SWEEP_JOB,
} from '#apps/school/SchoolMaintenanceExecutor.mjs';

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const sweeper = (result = { swept: [], skipped: [] }) => ({ sweepUntouched: vi.fn(async () => result) });
const build = (over = {}) => new SchoolMaintenanceExecutor({
  markSessionAbandoned: sweeper(), logger: silent, ...over,
});

describe('SchoolMaintenanceExecutor', () => {
  it('refuses to construct without the use case it exists to call', () => {
    expect(() => new SchoolMaintenanceExecutor({})).toThrow(/sweepUntouched/);
    expect(() => new SchoolMaintenanceExecutor({ markSessionAbandoned: {} })).toThrow(/sweepUntouched/);
  });

  it('claims its own job and nothing else', () => {
    const executor = build();
    expect(executor.canHandle(SCHOOL_STALE_SWEEP_JOB)).toBe(true);
    expect(executor.canHandle('freshvideo')).toBe(false);
    expect(executor.canHandle(undefined)).toBe(false);
  });

  it('sweeps at 14 days when the job says nothing', async () => {
    const markSessionAbandoned = sweeper();
    await build({ markSessionAbandoned }).execute(SCHOOL_STALE_SWEEP_JOB, {});
    expect(markSessionAbandoned.sweepUntouched).toHaveBeenCalledWith({ olderThanDays: 14, dryRun: false });
  });

  it("honours the job's own override", async () => {
    const markSessionAbandoned = sweeper();
    await build({ markSessionAbandoned }).execute(SCHOOL_STALE_SWEEP_JOB, { olderThanDays: 30 });
    expect(markSessionAbandoned.sweepUntouched).toHaveBeenCalledWith({ olderThanDays: 30, dryRun: false });
  });

  it('ignores a nonsense threshold rather than sweeping on it', async () => {
    // A zero or negative age would sweep TODAY's work — the one outcome this
    // whole feature must never produce.
    for (const olderThanDays of [0, -5, 'soon', 1.5, null]) {
      const markSessionAbandoned = sweeper();
      // eslint-disable-next-line no-await-in-loop
      await build({ markSessionAbandoned }).execute(SCHOOL_STALE_SWEEP_JOB, { olderThanDays });
      expect(markSessionAbandoned.sweepUntouched).toHaveBeenCalledWith({ olderThanDays: 14, dryRun: false });
    }
  });

  it('passes dryRun through so a household can watch before it writes', async () => {
    const markSessionAbandoned = sweeper();
    await build({ markSessionAbandoned }).execute(SCHOOL_STALE_SWEEP_JOB, { dryRun: true });
    expect(markSessionAbandoned.sweepUntouched).toHaveBeenCalledWith({ olderThanDays: 14, dryRun: true });
  });

  it('refuses a job that is not its own rather than sweeping anyway', async () => {
    await expect(build().execute('freshvideo', {})).rejects.toThrow(/cannot handle/);
  });

  it('lets a failing sweep reach the orchestrator, which owns the retry', async () => {
    const markSessionAbandoned = { sweepUntouched: vi.fn(async () => { throw new Error('store offline'); }) };
    await expect(build({ markSessionAbandoned }).execute(SCHOOL_STALE_SWEEP_JOB, {})).rejects.toThrow('store offline');
  });

  it('returns the sweep result so a run is inspectable', async () => {
    const result = { swept: [{ sessionId: 'ses_a' }], skipped: [], olderThanDays: 14, dryRun: false };
    const out = await build({ markSessionAbandoned: sweeper(result) }).execute(SCHOOL_STALE_SWEEP_JOB, {});
    expect(out).toBe(result);
  });
});
