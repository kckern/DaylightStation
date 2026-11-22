// tests/isolated/domain/weekly-review/schoolShowcasePolicy.test.mjs
import { describe, it, expect } from 'vitest';
import {
  buildShowcases,
  plainBullets,
  activityBullet,
  showcaseItemsHash,
} from '../../../../__app_modules/personal/weekly-review/server/domain/schoolShowcasePolicy.mjs';

const DATES = ['2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30'];

function item(overrides) {
  const studyDay = overrides.studyDay || '2026-03-24';
  return {
    learnerId: 'kid-a',
    learnerName: 'Robin',
    kind: 'course',
    verb: 'worked',
    title: 'Course',
    subtitle: null,
    at: `${studyDay}T10:00:00.000Z`,
    studyDay,
    imageUrl: null,
    groupKey: 'course:c1',
    weight: 1,
    subject: null,
    ...overrides,
  };
}

const activity = (id, subtitle, extra = {}) => item({
  kind: 'activity', verb: 'completed', title: subtitle ? subtitle.split(' · ')[0] : 'A printed page',
  subtitle, groupKey: `activity:${id}`, imageUrl: `/img/activity/${id}`, ...extra,
});

describe('activityBullet', () => {
  it('names one page with an article', () => {
    expect(activityBullet([activity('1', 'Maze · level 2')])).toBe('1 printed page: a maze');
  });

  it('pluralises repeated kinds and joins kinds naturally', () => {
    expect(activityBullet([
      activity('1', 'Maze · level 2'),
      activity('2', 'Maze · level 3'),
      activity('3', 'Sudoku'),
    ])).toBe('3 printed pages: mazes and a sudoku');
    expect(activityBullet([
      activity('1', 'Maze'), activity('2', 'Maze'), activity('3', 'Sudoku'), activity('4', 'Sudoku'),
    ])).toBe('4 printed pages: mazes and sudoku');
  });

  it('lists three kinds with commas and handles -ing, -ch and vowel kinds', () => {
    expect(activityBullet([
      activity('1', 'Coloring'),
      activity('2', 'Word search'), activity('3', 'Word search'),
      activity('4', 'Owl puzzle'),
    ])).toBe('4 printed pages: coloring, word searches and an owl puzzle');
  });

  it('falls back to a bare count when no page has a kind', () => {
    expect(activityBullet([activity('1', null), activity('2', null)])).toBe('2 printed pages');
  });
});

describe('plainBullets', () => {
  it('orders by priority and phrases each kind', () => {
    const bullets = plainBullets([
      item({ kind: 'program', verb: 'worked', title: 'Korean', subtitle: '5 words · 3 days this week', groupKey: 'program:card-ladder:ko', weight: 14 }),
      item({ kind: 'course', verb: 'worked', title: 'Math 2', subtitle: 'Fractions · 4 sessions this week', groupKey: 'course:math', weight: 4 }),
      activity('1', 'Maze · level 1'),
      item({ kind: 'book', verb: 'finished', title: 'Frog and Toad', subtitle: 'Arnold Lobel', groupKey: 'book:r1:finished' }),
      item({ kind: 'course', verb: 'completed', title: 'Science', subtitle: 'Plants', groupKey: 'course:sci' }),
    ]);
    expect(bullets).toEqual([
      'Finished Frog and Toad',
      'Science: Plants',
      '1 printed page: a maze',
      'Math 2 · 4 sessions',
      'Korean · 14 words',
    ]);
  });

  it('caps at five bullets', () => {
    const many = Array.from({ length: 8 }, (_, i) => item({ title: `Course ${i}`, groupKey: `course:${i}` }));
    expect(plainBullets(many)).toHaveLength(5);
  });

  it('says only "Finished" for a book started and finished in the same week', () => {
    expect(plainBullets([
      item({ kind: 'book', verb: 'started', title: 'Holes', groupKey: 'book:r9:started' }),
      item({ kind: 'book', verb: 'finished', title: 'Holes', groupKey: 'book:r9:finished' }),
      item({ kind: 'book', verb: 'started', title: 'Matilda', groupKey: 'book:r10:started' }),
    ])).toEqual(['Finished Holes', 'Started Matilda']);
  });

  it('keeps a lone course plain and singular words singular', () => {
    expect(plainBullets([
      item({ title: 'Art', subtitle: null, groupKey: 'course:art' }),
      item({ kind: 'program', title: 'Korean', subtitle: '1 word', groupKey: 'program:ko', weight: 1 }),
    ])).toEqual(['Art', 'Korean · 1 word']);
  });

  it('never carries a percent, grade or score-like number', () => {
    const bullets = plainBullets([
      item({ kind: 'course', verb: 'completed', title: 'Math', subtitle: 'Unit 3', groupKey: 'course:m' }),
      activity('1', 'Sudoku · level 4'),
    ]);
    for (const b of bullets) {
      expect(b).not.toMatch(/%|\/\d|score|grade|level/i);
    }
  });
});

describe('showcaseItemsHash', () => {
  it('is order-independent and changes with weight', () => {
    const a = [{ groupKey: 'b', weight: 1 }, { groupKey: 'a', weight: 2 }];
    expect(showcaseItemsHash(a)).toBe('a:2|b:1');
    expect(showcaseItemsHash([...a].reverse())).toBe('a:2|b:1');
    expect(showcaseItemsHash([{ groupKey: 'a', weight: 3 }, { groupKey: 'b', weight: 1 }])).not.toBe('a:2|b:1');
  });
});

describe('buildShowcases', () => {
  it('builds one showcase per child with work in the window, ordered by name', () => {
    const items = [
      item({ learnerId: 'kid-b', learnerName: 'Ada', title: 'Reading', groupKey: 'course:read' }),
      item({ learnerId: 'kid-a', learnerName: 'Robin', title: 'Math', groupKey: 'course:math' }),
      item({ learnerId: 'kid-c', learnerName: 'Zed', studyDay: '2026-03-31', groupKey: 'course:late' }),
    ];
    const result = buildShowcases(items, DATES);
    expect(result.map(s => s.learnerName)).toEqual(['Ada', 'Robin']);
    expect(result[0]).toMatchObject({ learnerId: 'kid-b', source: 'plain', bullets: ['Reading'] });
  });

  it('dedupes groups, sorts by priority then weight and compacts items', () => {
    const items = [
      item({ groupKey: 'course:math', title: 'Math', studyDay: '2026-03-24', imageUrl: '/img/math' }),
      item({ groupKey: 'course:math', title: 'Math', studyDay: '2026-03-25', imageUrl: '/img/math' }),
      item({ groupKey: 'course:art', title: 'Art', imageUrl: '/img/art' }),
      item({ kind: 'book', verb: 'finished', title: 'Holes', groupKey: 'book:r1:finished', imageUrl: '/img/holes' }),
    ];
    const [show] = buildShowcases(items, DATES);
    expect(show.items).toEqual([
      { kind: 'book', verb: 'finished', title: 'Holes', subtitle: null, weight: 1 },
      { kind: 'course', verb: 'worked', title: 'Math', subtitle: '2 sessions this week', weight: 2 },
      { kind: 'course', verb: 'worked', title: 'Art', subtitle: null, weight: 1 },
    ]);
    expect(show.images).toEqual(['/img/holes', '/img/math', '/img/art']);
    expect(show.bullets).toEqual(['Finished Holes', 'Math · 2 sessions', 'Art']);
    expect(show.itemsHash).toBe('book:r1:finished:1|course:art:1|course:math:2');
  });

  it('keeps at most six distinct images and skips missing ones', () => {
    const items = Array.from({ length: 9 }, (_, i) => activity(`p${i}`, 'Maze', { imageUrl: i === 2 ? null : `/img/${i % 8}` }));
    const [show] = buildShowcases(items, DATES);
    expect(show.images).toEqual(['/img/0', '/img/1', '/img/3', '/img/4', '/img/5', '/img/6']);
  });

  it('drops malformed items and returns nothing for an empty week', () => {
    expect(buildShowcases([null, { learnerId: 'x' }, item({ at: 5 })], DATES)).toEqual([]);
    expect(buildShowcases([], DATES)).toEqual([]);
    expect(buildShowcases(undefined, undefined)).toEqual([]);
  });
});
