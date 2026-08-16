import { describe, it, expect } from 'vitest';
import { WeeklyReviewImmichAdapter } from '#adapters/weekly-review/WeeklyReviewImmichAdapter.mjs';

describe('WeeklyReviewImmichAdapter.searchOldest', () => {
  const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const build = (searchMetadata) => new WeeklyReviewImmichAdapter(
    {},
    { client: { searchMetadata }, logger: noopLogger }
  );

  const asset = (localDateTime, type = 'IMAGE') => ({ id: localDateTime, type, localDateTime });

  it('asks for a single oldest-first asset over the range', async () => {
    const calls = [];
    const adapter = build(async (q) => { calls.push(q); return { items: [asset('2026-07-02T09:00:00.000Z')] }; });

    const oldest = await adapter.searchOldest({ startDate: '2026-04-10', endDate: '2026-08-07' });

    expect(oldest).toBe('2026-07-02');
    expect(calls[0]).toMatchObject({ size: 1, order: 'asc' });
    expect(calls[0].takenAfter).toBe('2026-04-10T00:00:00.000Z');
    // endDate is inclusive, so the ceiling is the following midnight.
    expect(calls[0].takenBefore).toBe('2026-08-08T00:00:00.000Z');
  });

  it('still finds the oldest date when the server ignores `order` and returns a full page', async () => {
    // Unverified against this Immich build: whether /api/search/metadata honors
    // `order`. If it does not, the page comes back in arbitrary order and we
    // must reduce rather than trust items[0].
    const adapter = build(async () => ({
      items: [
        asset('2026-08-01T10:00:00.000Z'),
        asset('2026-06-11T08:30:00.000Z'),
        asset('2026-07-20T22:00:00.000Z'),
      ],
    }));

    expect(await adapter.searchOldest({ startDate: '2026-04-10', endDate: '2026-08-07' })).toBe('2026-06-11');
  });

  it('ignores asset types the review cannot show', async () => {
    const adapter = build(async () => ({
      items: [asset('2026-05-01T10:00:00.000Z', 'OTHER'), asset('2026-06-11T08:30:00.000Z', 'VIDEO')],
    }));

    expect(await adapter.searchOldest({ startDate: '2026-04-10', endDate: '2026-08-07' })).toBe('2026-06-11');
  });

  it('returns null for an empty range', async () => {
    expect(await build(async () => ({ items: [] })).searchOldest({ startDate: '2026-04-10', endDate: '2026-08-07' })).toBeNull();
  });

  it('tolerates the bare-array response shape', async () => {
    const adapter = build(async () => [asset('2026-06-11T08:30:00.000Z')]);
    expect(await adapter.searchOldest({ startDate: '2026-04-10', endDate: '2026-08-07' })).toBe('2026-06-11');
  });
});
