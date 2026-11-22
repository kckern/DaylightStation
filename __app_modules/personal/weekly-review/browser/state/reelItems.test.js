import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { reelItemsForDay, sortKeyOf, showcaseExtrasByDay } from './reelItems.js';

const work = (over = {}) => ({
  learnerId: 'kid-a', learnerName: 'Mara', kind: 'book', verb: 'finished',
  title: 'Wonder', subtitle: 'R. J. Palacio', at: '2026-04-21T22:00:00Z',
  studyDay: '2026-04-21', imageUrl: null, groupKey: 'book:wonder', weight: 3, subject: 'reading',
  ...over,
});

describe('reelItemsForDay', () => {
  it('returns an empty list for a missing or empty day', () => {
    expect(reelItemsForDay(null)).toEqual([]);
    expect(reelItemsForDay({ photos: [], school: [] })).toEqual([]);
    expect(reelItemsForDay({})).toEqual([]);
  });

  it('turns school work into reel items with a stable id and takenAt', () => {
    const [item] = reelItemsForDay({ photos: [], school: [work()] });
    expect(item.type).toBe('school');
    expect(item.id).toBe('school:kid-a:book:wonder:2026-04-21');
    expect(item.takenAt).toBe('2026-04-21T22:00:00Z');
    expect(item.title).toBe('Wonder');
  });

  it('merges photos and school work by time', () => {
    const day = {
      photos: [
        { id: 'p1', type: 'image', takenAt: '2026-04-21T08:00:00Z' },
        { id: 'p2', type: 'image', takenAt: '2026-04-21T23:00:00Z' },
      ],
      school: [work({ at: '2026-04-21T12:00:00Z' })],
    };
    expect(reelItemsForDay(day).map(i => i.id)).toEqual(['p1', 'school:kid-a:book:wonder:2026-04-21', 'p2']);
  });

  it('keeps equal times in their original order and puts undated items last', () => {
    const day = {
      photos: [
        { id: 'u1', type: 'image' },
        { id: 'a', type: 'image', takenAt: '2026-04-21T10:00:00Z' },
        { id: 'u2', type: 'image' },
        { id: 'b', type: 'image', takenAt: '2026-04-21T10:00:00Z' },
      ],
      school: [],
    };
    expect(reelItemsForDay(day).map(i => i.id)).toEqual(['a', 'b', 'u1', 'u2']);
  });

  it('memoizes per day object so the keymap and the render share one list', () => {
    const day = { photos: [{ id: 'p1', takenAt: '2026-04-21T08:00:00Z' }], school: [work()] };
    expect(reelItemsForDay(day)).toBe(reelItemsForDay(day));
    expect(reelItemsForDay({ ...day })).not.toBe(reelItemsForDay(day));
  });

  it('appends extras after the day items without sorting them in', () => {
    const day = { photos: [{ id: 'p1', takenAt: '2026-04-21T08:00:00Z' }], school: [] };
    const extra = { id: 'x', type: 'showcase', takenAt: '2026-04-21T01:00:00Z' };
    expect(reelItemsForDay(day, [extra]).map(i => i.id)).toEqual(['p1', 'x']);
    expect(reelItemsForDay(day).map(i => i.id)).toEqual(['p1']);
  });
});

describe('reel order on the household clock', () => {
  // Pin the screen's zone: the TV runs in the household zone, and these cases
  // only differ from instant ordering when the zone is not UTC.
  let prevTz;
  beforeAll(() => { prevTz = process.env.TZ; process.env.TZ = 'America/Los_Angeles'; });
  afterAll(() => { if (prevTz === undefined) delete process.env.TZ; else process.env.TZ = prevTz; });

  it('reads an Immich takenAt as wall-clock time despite its Z', () => {
    expect(sortKeyOf({ type: 'image', takenAt: '2026-11-21T16:00:00.000Z' })).toBe('2026-11-21T16:00:00');
    expect(sortKeyOf({ type: 'image', takenAt: '2026-06-22T14:25:13' })).toBe('2026-06-22T14:25:13');
  });

  it('puts work done at 3:30 PM before a 4 PM photo', () => {
    const day = {
      photos: [{ id: 'p4pm', type: 'image', takenAt: '2026-11-21T16:00:00.000Z' }],
      school: [work({ at: '2026-11-21T23:30:00Z', studyDay: '2026-11-21' })], // 15:30 PST
    };
    expect(sortKeyOf(reelItemsForDay(day)[0])).toBe('2026-11-21T15:30:00');
    expect(reelItemsForDay(day).map(i => i.type)).toEqual(['school', 'image']);
  });

  it('sorts the noon-UTC "time unknown" placeholder at local noon', () => {
    const day = {
      photos: [
        { id: 'p11', type: 'image', takenAt: '2026-11-21T11:00:00.000Z' },
        { id: 'p13', type: 'image', takenAt: '2026-11-21T13:00:00.000Z' },
      ],
      school: [work({ at: '2026-11-21T12:00:00.000Z', studyDay: '2026-11-21' })],
    };
    expect(reelItemsForDay(day).map(i => i.id)).toEqual(['p11', 'school:kid-a:book:wonder:2026-11-21', 'p13']);
  });
});

describe('showcaseExtrasByDay', () => {
  const days = [{ date: 'a' }, { date: 'b' }, { date: 'c' }];
  const sc = { learnerId: 'kid-a', learnerName: 'Robin', bullets: ['x'], images: [], source: 'plain' };

  it('puts the showcases only on the last day, as showcase items', () => {
    const extras = showcaseExtrasByDay(days, [sc]);
    expect(Object.keys(extras)).toEqual(['2']);
    expect(extras[2][0]).toMatchObject({ type: 'showcase', id: 'showcase:kid-a', learnerName: 'Robin' });
  });

  it('adds nothing when no child has work', () => {
    expect(showcaseExtrasByDay(days, [])).toEqual({});
    expect(showcaseExtrasByDay(days, undefined)).toEqual({});
    expect(showcaseExtrasByDay([], [sc])).toEqual({});
  });

  it('closes the last day\'s reel after its photos and work', () => {
    const day = { photos: [{ id: 'p1', type: 'image', takenAt: '2026-04-21T08:00:00.000Z' }], school: [] };
    const extras = showcaseExtrasByDay([day], [sc]);
    expect(reelItemsForDay(day, extras[0]).map(i => i.id)).toEqual(['p1', 'showcase:kid-a']);
  });
});
