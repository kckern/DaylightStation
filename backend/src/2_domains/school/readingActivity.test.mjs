import { describe, expect, it } from 'vitest';
import { projectReadingActivity } from './readingActivity.mjs';

const dayOf = (iso) => String(iso ?? '').slice(0, 10);
const project = (items, studyDay = '2026-09-07') => projectReadingActivity(items, { studyDay, dayOf });

describe('projectReadingActivity', () => {
  it.each([
    ['page progress', { kind: 'progress', at: '2026-09-07T15:00:00Z', page: 21 }],
    ['check-in', { kind: 'progress', at: '2026-09-07T15:00:00Z' }],
    ['finish', { kind: 'finished', at: '2026-09-07T15:00:00Z' }],
  ])('acknowledges unenrolled %s without a catalog or enrollment lookup', (_label, event) => {
    expect(project([{ itemId: 'kid:unknown:open-1', bookId: 'unknown', events: [event] }])).toEqual({
      studyDay: '2026-09-07',
      hasActivity: true,
      progressCount: event.kind === 'progress' ? 1 : 0,
      finishedCount: event.kind === 'finished' ? 1 : 0,
      bookCount: 1,
    });
  });

  it('does not count a started-only shelf item as reading', () => {
    expect(project([{ itemId: 'kid:b:open-1', bookId: 'b', events: [
      { kind: 'started', at: '2026-09-07T15:00:00Z', entryId: 'open-1' },
    ] }])).toEqual({
      studyDay: '2026-09-07', hasActivity: false, progressCount: 0, finishedCount: 0, bookCount: 0,
    });
  });

  it('counts writes while collapsing several writes for one shelf item to one active book', () => {
    expect(project([{ itemId: 'kid:b:open-1', bookId: 'b', events: [
      { kind: 'progress', at: '2026-09-07T15:00:00Z', page: 10, entryId: 'p-1' },
      { kind: 'progress', at: '2026-09-07T16:00:00Z', page: 20, entryId: 'p-2' },
      { kind: 'finished', at: '2026-09-07T17:00:00Z', entryId: 'f-1' },
    ] }])).toEqual({
      studyDay: '2026-09-07', hasActivity: true, progressCount: 2, finishedCount: 1, bookCount: 1,
    });
  });

  it('uses only the injected study-day boundary for selecting evidence', () => {
    const pacificStudyDay = (iso) => String(iso).endsWith('10:30:00Z') ? '2026-09-06' : '2026-09-07';
    const result = projectReadingActivity([{ itemId: 'kid:b:open-1', events: [
      { kind: 'progress', at: '2026-09-07T10:30:00Z', page: 10 },
      { kind: 'progress', at: '2026-09-07T12:30:00Z', page: 20 },
    ] }], { studyDay: '2026-09-07', dayOf: pacificStudyDay });
    expect(result).toEqual({
      studyDay: '2026-09-07', hasActivity: true, progressCount: 1, finishedCount: 0, bookCount: 1,
    });
  });

  it('attributes a backdated finish by its effective at day, not its later recording time', () => {
    const items = [{ itemId: 'kid:b:open-1', events: [
      { kind: 'finished', at: '2026-09-05T12:00:00Z', recordedAt: '2026-09-07T18:00:00Z', entryId: 'f-1' },
    ] }];
    expect(project(items, '2026-09-05')).toMatchObject({ hasActivity: true, finishedCount: 1, bookCount: 1 });
    expect(project(items, '2026-09-07')).toMatchObject({ hasActivity: false, finishedCount: 0, bookCount: 0 });
  });

  it('uses append order to remove a finish followed by reopened even when the finish date sorts earlier', () => {
    expect(project([{ itemId: 'kid:b:open-1', bookId: 'b', events: [
      { kind: 'started', at: '2026-09-07T15:00:00Z' },
      { kind: 'finished', at: '2026-09-07T12:00:00Z' },
      { kind: 'reopened', at: '2026-09-08T15:00:00Z' },
    ] }])).toEqual({
      studyDay: '2026-09-07', hasActivity: false, progressCount: 0, finishedCount: 0, bookCount: 0,
    });
  });

  it('keeps independent progress when a later reopened event undoes the finish', () => {
    expect(project([{ itemId: 'kid:b:open-1', events: [
      { kind: 'progress', at: '2026-09-07T11:00:00Z', page: 80 },
      { kind: 'finished', at: '2026-09-07T12:00:00Z' },
      { kind: 'reopened', at: '2026-09-08T15:00:00Z' },
    ] }])).toEqual({
      studyDay: '2026-09-07', hasActivity: true, progressCount: 1, finishedCount: 0, bookCount: 1,
    });
  });

  it('does not let set-aside erase a legitimate finish', () => {
    expect(project([{ itemId: 'kid:b:open-1', events: [
      { kind: 'finished', at: '2026-09-07T12:00:00Z', entryId: 'f-1' },
      { kind: 'set-aside', at: '2026-09-08T15:00:00Z', entryId: 's-1' },
    ] }])).toMatchObject({ hasActivity: true, finishedCount: 1, bookCount: 1 });
  });

  it('deduplicates identified retries within an item and preserves distinct reread items', () => {
    const progress = { kind: 'progress', at: '2026-09-07T11:00:00Z', page: 40, entryId: 'p-1' };
    expect(project([
      { itemId: 'kid:b:open-1', bookId: 'b', events: [progress, { ...progress }] },
      { itemId: 'kid:b:open-2', bookId: 'b', events: [{ ...progress }] },
    ])).toEqual({
      studyDay: '2026-09-07', hasActivity: true, progressCount: 2, finishedCount: 0, bookCount: 2,
    });
  });

  it('accepts legacy records with no recording time or event identity', () => {
    expect(project([{ bookId: 'legacy', events: [
      { kind: 'progress', at: '2026-09-07T11:00:00Z', minutes: 15 },
      { kind: 'progress', at: '2026-09-07T12:00:00Z', minutes: 10 },
    ] }])).toEqual({
      studyDay: '2026-09-07', hasActivity: true, progressCount: 2, finishedCount: 0, bookCount: 1,
    });
  });
});


describe('v2 reading evidence', () => {
  it('uses effective entry days, finish markers and retry identities', () => {
    const finish = { id: 'ent_finish', kind: 'finished', on: '2026-09-05', at: '2026-09-07T18:00:00Z' };
    const reading = { id: 'rdg_one', status: 'finished', finishedOn: '2026-09-05', entries: [
      finish, { ...finish }, { id: 'ent_check', kind: 'progress', on: '2026-09-05' },
    ] };
    expect(project([reading], '2026-09-05')).toMatchObject({ bookCount: 1, progressCount: 1, finishedCount: 1 });
    expect(project([reading])).toMatchObject({ hasActivity: false });
  });
  it('supports stored v2 finish state with no marker and never credits an empty open', () => {
    expect(project([{ status: 'finished', finishedOn: '2026-09-07', entries: [] },
      { status: 'reading', openedOn: '2026-09-07', entries: [] }]))
      .toMatchObject({ bookCount: 1, progressCount: 0, finishedCount: 1 });
  });
});


it('uses authoritative v2 finish state after teacher redate or withdrawal', () => {
  const reading = { status: 'finished', finishedOn: '2026-09-06', entries: [
    { id: 'finish', kind: 'finished', on: '2026-09-05' },
    { id: 'check', kind: 'progress', on: '2026-09-05' },
  ] };
  expect(project([reading], '2026-09-05')).toMatchObject({ progressCount: 1, finishedCount: 0, bookCount: 1 });
  expect(project([reading], '2026-09-06')).toMatchObject({ progressCount: 0, finishedCount: 1, bookCount: 1 });
  expect(project([{ ...reading, status: 'reading', finishedOn: null }], '2026-09-05'))
    .toMatchObject({ progressCount: 1, finishedCount: 0, bookCount: 1 });
});
