import { describe, it, expect } from 'vitest';
import { RecordStoryRead } from '#apps/school/usecases/RecordStoryRead.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

describe('RecordStoryRead', () => {
  it('appends a read stamped with the current study day', async () => {
    const appended = [];
    const useCase = new RecordStoryRead({
      readingLog: { append: async (row) => { appended.push(row); return row; } },
      // ONE place computes the shard key — the launcher's own `studyDay()`,
      // handed in. See the "two timezones" test below for what injecting a
      // second timezone here used to cost.
      studyDay: () => '2026-08-26',
      clock: () => new Date('2026-08-27T01:30:00.000Z'),
      logger: silent,
    });
    await useCase.execute({ learnerId: 'learner-c', title: 'The Jungle Book', contentId: 'plex:620681', tagUid: '04215172cc2a81', location: 'livingroom' });
    expect(appended[0]).toMatchObject({ learnerId: 'learner-c', studyDay: '2026-08-26', title: 'The Jungle Book' });
  });

  it('refuses a read with no learner', async () => {
    const useCase = new RecordStoryRead({ readingLog: { append: async () => {} }, studyDay: () => '2026-08-26', logger: silent });
    await expect(useCase.execute({ title: 'x' })).rejects.toThrow(/learnerId/);
  });

  it('broadcasts a story-read acknowledgement when a bus is wired', async () => {
    const sent = [];
    const useCase = new RecordStoryRead({
      readingLog: { append: async (r) => r },
      realtime: { storyReadRecorded: (payload) => sent.push({ topic: 'school', payload: { event: 'story-read', ...payload } }) },
      studyDay: () => '2026-08-26', clock: () => new Date('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    await useCase.execute({ learnerId: 'learner-c', title: 'The Jungle Book' });
    expect(sent[0].topic).toBe('school');
    expect(sent[0].payload).toMatchObject({ event: 'story-read', learnerId: 'learner-c', title: 'The Jungle Book' });
  });

  it('still records the read when the broadcast throws', async () => {
    const useCase = new RecordStoryRead({
      readingLog: { append: async (r) => r },
      realtime: { storyReadRecorded: () => { throw new Error('bus down'); } },
      studyDay: () => '2026-08-26', clock: () => new Date('2026-08-26T18:00:00.000Z'), logger: silent,
    });
    await expect(useCase.execute({ learnerId: 'learner-c', title: 'x' })).resolves.toMatchObject({ learnerId: 'learner-c' });
  });
  // Composition wires only the launcher today. When plan 03 wires this use
  // case, an omitted `timezone` would have defaulted to UTC while the launcher
  // stayed local — a 10pm PT finish files under tomorrow, the launcher reads
  // today, the count never rises and NOTHING errors. Requiring the caller to
  // hand in the one `studyDay()` the launcher already exposes removes the
  // second timezone entirely, and refusing to construct without it means the
  // mistake cannot be made silently.
  it('cannot be constructed without the one study-day source', () => {
    expect(() => new RecordStoryRead({ readingLog: { append: async () => {} }, logger: silent }))
      .toThrow(/studyDay/);
  });

  it('stamps the shard key the launcher would ask for, not one of its own', async () => {
    const appended = [];
    await new RecordStoryRead({
      readingLog: { append: async (row) => { appended.push(row); return row; } },
      studyDay: () => '2026-08-26',
      // Deliberately a DIFFERENT instant than the study day implies: the row
      // must carry the key it was handed, never one re-derived from the clock.
      clock: () => new Date('2026-08-27T01:30:00.000Z'), logger: silent,
    }).execute({ learnerId: 'learner-c', title: 'One' });
    expect(appended[0].studyDay).toBe('2026-08-26');
    expect(appended[0].at).toBe('2026-08-27T01:30:00.000Z');
  });

  // Plan 03 sends a client-minted pickId on playback completion so a retried
  // POST or a remounted player cannot double-count. `doneToday` is
  // `rows.length >= target`, so a dropped pickId credits the child twice.
  it('carries a pickId through to the log so a retry cannot double-count', async () => {
    const appended = [];
    await new RecordStoryRead({
      readingLog: { append: async (row) => { appended.push(row); return row; } },
      studyDay: () => '2026-08-26', clock: () => new Date('2026-08-26T18:00:00.000Z'), logger: silent,
    }).execute({ learnerId: 'learner-c', title: 'One', pickId: 'pick_abc123' });
    expect(appended[0].pickId).toBe('pick_abc123');
  });

  it('defaults pickId to null rather than dropping the field', async () => {
    const appended = [];
    await new RecordStoryRead({
      readingLog: { append: async (row) => { appended.push(row); return row; } },
      studyDay: () => '2026-08-26', clock: () => new Date('2026-08-26T18:00:00.000Z'), logger: silent,
    }).execute({ learnerId: 'learner-c', title: 'One' });
    expect(appended[0]).toHaveProperty('pickId', null);
  });
});
