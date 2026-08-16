import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WeeklyReviewService } from '#apps/weekly-review/WeeklyReviewService.mjs';

describe('WeeklyReviewService.getContentExtent', () => {
  let tmpDataPath;
  let tmpMediaPath;
  const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

  // Stands in for WeeklyReviewImmichAdapter. Records the query it was handed so
  // the tests can assert the bounds, and returns whatever the case needs.
  const makeAdapter = (impl) => {
    const calls = [];
    return {
      calls,
      searchOldest: async (query) => { calls.push(query); return impl(query); },
    };
  };

  const build = (immichAdapter) => new WeeklyReviewService(
    { dataPath: tmpDataPath, mediaPath: tmpMediaPath, householdId: 'h' },
    { immichAdapter, logger: noopLogger }
  );

  beforeEach(() => {
    tmpDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-data-'));
    tmpMediaPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-media-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDataPath, { recursive: true, force: true });
    fs.rmSync(tmpMediaPath, { recursive: true, force: true });
  });

  it('returns the oldest content date strictly before the given window', async () => {
    const adapter = makeAdapter(async () => '2026-07-02');
    const result = await build(adapter).getContentExtent({ before: '2026-08-08' });

    expect(result).toEqual({ oldestContentDate: '2026-07-02', hasOlder: true });
  });

  it('bounds the probe to the lookback floor and stops short of the window start', async () => {
    const adapter = makeAdapter(async () => null);
    await build(adapter).getContentExtent({ before: '2026-08-08', lookbackDays: 30 });

    expect(adapter.calls).toHaveLength(1);
    // Floor is `before` minus lookbackDays; the ceiling is the day before
    // `before`, so the current window is never re-reported as "older".
    expect(adapter.calls[0]).toMatchObject({ startDate: '2026-07-09', endDate: '2026-08-07' });
  });

  it('defaults the lookback to 120 days when none is given', async () => {
    const adapter = makeAdapter(async () => null);
    await build(adapter).getContentExtent({ before: '2026-08-08' });

    expect(adapter.calls[0].startDate).toBe('2026-04-10');
  });

  it('reports hasOlder false when the lookback holds no assets', async () => {
    const adapter = makeAdapter(async () => null);
    const result = await build(adapter).getContentExtent({ before: '2026-08-08' });

    expect(result).toEqual({ oldestContentDate: null, hasOlder: false });
  });

  it('degrades to hasOlder false when the adapter throws, rather than propagating', async () => {
    // Jump-to-oldest is a convenience on a live recording session. A failed
    // probe must fall back to ordinary paging, never surface as a 500.
    const adapter = makeAdapter(async () => { throw new Error('immich unreachable'); });
    const result = await build(adapter).getContentExtent({ before: '2026-08-08' });

    expect(result).toEqual({ oldestContentDate: null, hasOlder: false });
  });

  it('rejects a missing or malformed `before` date', async () => {
    const service = build(makeAdapter(async () => null));
    await expect(service.getContentExtent({})).rejects.toThrow(/before/i);
    await expect(service.getContentExtent({ before: '08-08-2026' })).rejects.toThrow(/before/i);
  });
});
