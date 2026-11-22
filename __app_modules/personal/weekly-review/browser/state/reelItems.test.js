import { describe, it, expect } from 'vitest';
import { reelItemsForDay } from './reelItems.js';

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
