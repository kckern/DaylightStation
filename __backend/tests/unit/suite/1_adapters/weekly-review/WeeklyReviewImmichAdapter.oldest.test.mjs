import { describe, it, expect } from 'vitest';
import { WeeklyReviewImmichAdapter } from "../../../../../../__app_modules/personal/weekly-review/server/adapters/WeeklyReviewImmichAdapter.mjs";

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

describe('WeeklyReviewImmichAdapter NoShow exclusion', () => {
  const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const asset = (id, localDateTime, type = 'IMAGE') => ({ id, type, localDateTime });
  const ALL = [
    asset('keep-1', '2026-10-09T10:00:00.000Z'),
    asset('hide-1', '2026-10-08T09:00:00.000Z'),
    asset('keep-2', '2026-10-10T11:00:00.000Z'),
    asset('hide-2', '2026-10-10T15:00:00.000Z'),
  ];
  const HIDDEN = new Set(['hide-1', 'hide-2']);

  const build = () => {
    const calls = [];
    const client = {
      getTags: async () => [{ id: 'tag-noshow', name: 'NoShow', value: 'NoShow' }, { id: 'tag-other', name: 'Other', value: 'Other' }],
      searchMetadata: async (q) => {
        calls.push(q);
        if (q.tagIds) {
          expect(q.tagIds).toEqual(['tag-noshow']);
          return { items: ALL.filter(a => HIDDEN.has(a.id)), nextPage: null };
        }
        const sorted = q.order === 'asc' ? [...ALL].sort((a, b) => a.localDateTime.localeCompare(b.localDateTime)) : ALL;
        return { items: sorted.slice(0, q.size) };
      },
    };
    return { adapter: new WeeklyReviewImmichAdapter({}, { client, logger: noopLogger }), calls };
  };

  it('drops NoShow-tagged assets from the days', async () => {
    const { adapter } = build();
    const days = await adapter.getPhotosForDateRange('2026-10-08', '2026-10-10');
    const ids = days.flatMap(d => d.photos.map(p => p.id));
    expect(ids.sort()).toEqual(['keep-1', 'keep-2']);
    expect(days.find(d => d.date === '2026-10-08').photoCount).toBe(0);
  });

  it('does not let a NoShow asset be the oldest date', async () => {
    const { adapter, calls } = build();
    expect(await adapter.searchOldest({ startDate: '2026-10-01', endDate: '2026-10-10' })).toBe('2026-10-09');
    expect(calls.find(q => !q.tagIds).size).toBe(HIDDEN.size + 1);
  });
});
