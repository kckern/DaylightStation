import { describe, it, expect } from 'vitest';
import {
  isSubcourseShow, floorOf, roomOf, keyOf, splitCoursePrefix,
  deriveCourseLabel, partitionCourses, partitionSeasons, progressOf, courseGate,
} from './subcourses.js';

const ep = (parentId, itemIndex, title, extra = {}) => ({
  id: `plex:${itemIndex}`, plex: String(itemIndex), parentId: String(parentId), itemIndex, title, ...extra,
});

describe('isSubcourseShow', () => {
  it('is true when labels contain subcourses (case-insensitive)', () => {
    expect(isSubcourseShow({ labels: ['Subcourses'] })).toBe(true);
    expect(isSubcourseShow({ labels: ['sequential'] })).toBe(false);
    expect(isSubcourseShow({})).toBe(false);
    expect(isSubcourseShow(null)).toBe(false);
  });
});

describe('floorOf / roomOf / keyOf', () => {
  it('splits CNN into floor and room', () => {
    expect(floorOf({ itemIndex: 205 })).toBe(2);
    expect(roomOf({ itemIndex: 205 })).toBe(5);
    expect(floorOf({ itemIndex: 3 })).toBe(null); // <100 = not a floor
  });
  it('keyOf prefers plex then id', () => {
    expect(keyOf({ plex: '9', id: 'plex:9' })).toBe('9');
    expect(keyOf({ id: 'plex:7' })).toBe('plex:7');
  });
});

describe('splitCoursePrefix / deriveCourseLabel', () => {
  it('takes the text before the en-dash', () => {
    expect(splitCoursePrefix('Pop Soloing – Pop Chords')).toBe('Pop Soloing');
    expect(splitCoursePrefix('Episode 101')).toBe(null);
  });
  it('labels a course by its shared prefix', () => {
    const lessons = [ep(1, 101, 'Pop Soloing – A'), ep(1, 102, 'Pop Soloing – B')];
    expect(deriveCourseLabel(lessons, 1)).toBe('Pop Soloing');
  });
  it('falls back to Course N when there is no shared prefix', () => {
    const lessons = [ep(1, 101, 'Episode 101'), ep(1, 102, 'Episode 102')];
    expect(deriveCourseLabel(lessons, 4)).toBe('Course 4');
  });
});

describe('partitionCourses', () => {
  it('groups a season into floors, ordered, lessons by room', () => {
    const items = [
      ep(1, 102, 'X – two'), ep(1, 101, 'X – one'),
      ep(1, 201, 'Y – one'), ep(1, 203, 'Y – three'), ep(1, 202, 'Y – two'),
    ];
    const courses = partitionCourses(items);
    expect(courses.map((c) => c.floor)).toEqual([1, 2]);
    expect(courses[0].label).toBe('X');
    expect(courses[0].lessons.map((l) => l.itemIndex)).toEqual([101, 102]);
    expect(courses[1].lessons.map((l) => l.itemIndex)).toEqual([201, 202, 203]);
  });
});

describe('partitionSeasons', () => {
  it('orders seasons by index and nests their courses', () => {
    const items = [ep(676507, 101, 'X – one'), ep(676540, 101, 'Z – one')];
    const parents = {
      676507: { index: 1, title: 'Season 1', thumbnail: '/t1' },
      676540: { index: 0, title: 'Specials', thumbnail: '/t0' },
    };
    const seasons = partitionSeasons(items, parents);
    expect(seasons.map((s) => s.title)).toEqual(['Specials', 'Season 1']);
    expect(seasons[0].courses.length).toBe(1);
    expect(seasons[1].courses[0].label).toBe('X');
  });
});

describe('progressOf', () => {
  it('counts watched lessons for the current user', () => {
    const items = [ep(1, 101, 'A', { userWatched: true }), ep(1, 102, 'B', { userWatched: false })];
    expect(progressOf(items)).toEqual({ watched: 1, total: 2 });
  });
});

describe('courseGate', () => {
  it('locks every lesson after the first unwatched one; marks it current', () => {
    const lessons = [
      ep(1, 101, 'A', { userWatched: true }),
      ep(1, 102, 'B', { userWatched: false }),
      ep(1, 103, 'C', { userWatched: false }),
    ];
    const { lockedIds, currentId } = courseGate(lessons);
    expect(currentId).toBe('102');
    expect(lockedIds.has('103')).toBe(true);
    expect(lockedIds.has('102')).toBe(false);
    expect(lockedIds.has('101')).toBe(false);
  });
});

// ── redesign helpers ─────────────────────────────────────────────────────────
import {
  sharedPrefix, courseStats, seasonStats, programStats, continueTarget,
  categoryOf, collectFacets, filterByFacets,
} from './subcourses.js';

const L = (parentId, itemIndex, title, watched = false) => ({
  id: `plex:${itemIndex}`, plex: String(itemIndex), parentId: String(parentId),
  itemIndex, title, label: title, userWatched: watched,
});

describe('sharedPrefix', () => {
  it('splits a common leading phrase from the distinguishing tail', () => {
    const { prefix, tails } = sharedPrefix([
      'Pop Soloing with Chord Tone Targets',
      'Pop Soloing with 3rds and 6ths',
      'Pop Soloing with Slip Notes',
    ]);
    expect(prefix).toBe('Pop Soloing with');
    expect(tails).toEqual(['Chord Tone Targets', '3rds and 6ths', 'Slip Notes']);
  });
  it('returns empty prefix when there is no ≥2-word commonality', () => {
    const { prefix, tails } = sharedPrefix(['Course 1', 'Course 2']);
    expect(prefix).toBe('');
    expect(tails).toEqual(['Course 1', 'Course 2']);
  });
  it('never eats a whole title (keeps a non-empty tail for all)', () => {
    const { prefix, tails } = sharedPrefix(['Blues Scales', 'Blues Scales Advanced']);
    expect(tails.every((t) => t.length > 0)).toBe(true);
    expect(prefix).not.toBe('Blues Scales');
  });
});

describe('reference marking + stats', () => {
  const items = [
    L(700, 101, 'Practice – A', true), L(700, 102, 'Practice – B', true),        // reference season 700
    L(701, 101, 'Solo with X – 1', true), L(701, 102, 'Solo with X – 2', true),   // course 1 complete
    L(701, 201, 'Solo with Y – 1', true), L(701, 202, 'Solo with Y – 2', false),  // course 2 in progress
  ];
  const parents = { 700: { index: 0, title: 'Practice Essentials' }, 701: { index: 1, title: 'Season 1' } };
  const seasons = partitionSeasons(items, parents, ['700']);

  it('flags the reference season and its courses', () => {
    const ref = seasons.find((s) => s.id === '700');
    expect(ref.reference).toBe(true);
    expect(ref.courses.every((c) => c.reference)).toBe(true);
  });
  it('courseStats reports completion', () => {
    const s1 = seasons.find((s) => s.id === '701');
    expect(courseStats(s1.courses[0])).toMatchObject({ watched: 2, total: 2, complete: true });
    expect(courseStats(s1.courses[1])).toMatchObject({ watched: 1, total: 2, complete: false });
  });
  it('seasonStats counts complete courses; reference season is exempt', () => {
    expect(seasonStats(seasons.find((s) => s.id === '701'))).toMatchObject({ reference: false, completeCourses: 1, totalCourses: 2 });
    expect(seasonStats(seasons.find((s) => s.id === '700'))).toMatchObject({ reference: true });
  });
  it('programStats excludes the reference season from the denominator', () => {
    expect(programStats(seasons)).toMatchObject({ completeCourses: 1, totalCourses: 2 });
  });
  it('continueTarget points at the first unwatched lesson in linear order (skipping reference)', () => {
    const t = continueTarget(seasons);
    expect(t).toMatchObject({ seasonId: '701', floor: 2 });
    expect(t.lesson.plex).toBe('202');
  });
});

// ── piano.course grouping + category/facet helpers ────────────────────────────

describe('partitionCourses with piano.course grouping', () => {
  it('groups by piano.course, ordered by first-appearance itemIndex, lessons sorted by itemIndex', () => {
    const items = [
      { itemIndex: 1, piano: { course: 'A' }, id: 'a1' },
      { itemIndex: 2, piano: { course: 'A' }, id: 'a2' },
      { itemIndex: 3, piano: { course: 'B' }, id: 'b1' },
    ];
    const courses = partitionCourses(items);
    expect(courses).toHaveLength(2);
    expect(courses.map((c) => c.label)).toEqual(['A', 'B']);
    expect(courses.map((c) => c.floor)).toEqual([1, 2]);
    expect(courses[0].lessons.map((l) => l.itemIndex)).toEqual([1, 2]);
    expect(courses[1].lessons.map((l) => l.itemIndex)).toEqual([3]);
  });

  it('falls back to splitCoursePrefix when piano.course is absent', () => {
    const items = [
      { itemIndex: 1, title: 'Scales – A', id: 'a1' },
      { itemIndex: 2, title: 'Scales – B', id: 'a2' },
      { itemIndex: 3, title: 'Chords – A', id: 'c1' },
    ];
    const courses = partitionCourses(items);
    expect(courses).toHaveLength(2);
    expect(courses.map((c) => c.label)).toEqual(['Scales', 'Chords']);
  });

  it('uses Course as fallback when no piano.course and no title prefix', () => {
    const items = [
      { itemIndex: 1, title: 'Lesson One', id: 'l1' },
      { itemIndex: 2, title: 'Lesson Two', id: 'l2' },
    ];
    const courses = partitionCourses(items);
    expect(courses).toHaveLength(1);
    expect(courses[0].label).toBe('Course');
  });

  it('preserves insertion order across unordered input items', () => {
    const items = [
      { itemIndex: 5, piano: { course: 'Y' }, id: 'y1' },
      { itemIndex: 2, piano: { course: 'X' }, id: 'x1' },
      { itemIndex: 4, piano: { course: 'Y' }, id: 'y2' },
      { itemIndex: 1, piano: { course: 'X' }, id: 'x2' },
    ];
    const courses = partitionCourses(items);
    expect(courses.map((c) => c.label)).toEqual(['X', 'Y']);
    expect(courses[0].lessons.map((l) => l.itemIndex)).toEqual([1, 2]);
    expect(courses[1].lessons.map((l) => l.itemIndex)).toEqual([4, 5]);
  });
});

describe('categoryOf', () => {
  it('returns season.piano.category if present', () => {
    const season = { piano: { category: 'masterclass' } };
    expect(categoryOf(season)).toBe('masterclass');
  });

  it('returns "reference" when season.reference is true', () => {
    const season = { reference: true };
    expect(categoryOf(season)).toBe('reference');
  });

  it('returns "lesson" by default', () => {
    const season = { title: 'Season 1' };
    expect(categoryOf(season)).toBe('lesson');
  });

  it('prefers piano.category over reference flag', () => {
    const season = { reference: true, piano: { category: 'custom' } };
    expect(categoryOf(season)).toBe('custom');
  });

  it('partitionSeasons carries season.piano; categoryOf reads it', () => {
    const items = [{ parentId: '10', itemIndex: 1, piano: { course: 'A' } }];
    const parents = { '10': { index: 10, title: 'Song Tutorials', piano: { category: 'repertoire', kind: 'tutorial' } } };
    const seasons = partitionSeasons(items, parents);
    expect(seasons[0].piano).toEqual({ category: 'repertoire', kind: 'tutorial' });
    expect(categoryOf(seasons[0])).toBe('repertoire');
  });
});

describe('collectFacets', () => {
  it('collects styles (array), skills, and instructors from item.piano', () => {
    const items = [
      { piano: { styles: ['jazz', 'blues'], skill: 'beginner', instructor: 'Alice' } },
      { piano: { styles: ['blues'], skill: 'beginner', instructor: 'Bob' } },
      { piano: { styles: ['jazz'], skill: 'advanced' } },
    ];
    const facets = collectFacets(items);
    expect(facets.styles).toEqual(['blues', 'jazz']);
    expect(facets.skills).toEqual(['advanced', 'beginner']);
    expect(facets.instructors).toEqual(['Alice', 'Bob']);
  });

  it('deduplicates and sorts results', () => {
    const items = [
      { piano: { styles: ['x', 'a'], skill: 'z' } },
      { piano: { styles: ['a', 'x'], skill: 'a' } },
    ];
    const facets = collectFacets(items);
    expect(facets.styles).toEqual(['a', 'x']);
    expect(facets.skills).toEqual(['a', 'z']);
  });

  it('handles items without piano or missing facet fields', () => {
    const items = [
      { piano: { styles: ['jazz'] } },
      { piano: {} },
      {},
      null,
    ];
    const facets = collectFacets(items);
    expect(facets.styles).toEqual(['jazz']);
    expect(facets.skills).toEqual([]);
    expect(facets.instructors).toEqual([]);
  });
});

describe('filterByFacets', () => {
  const items = [
    { id: '1', piano: { styles: ['jazz', 'blues'], skill: 'beginner', instructor: 'Alice' } },
    { id: '2', piano: { styles: ['classical'], skill: 'advanced', instructor: 'Bob' } },
    { id: '3', piano: { styles: ['jazz'], skill: 'intermediate', instructor: 'Alice' } },
    { id: '4', piano: { styles: ['blues'] } },
  ];

  it('filters by style (membership in array)', () => {
    const result = filterByFacets(items, { style: 'jazz' });
    expect(result.map((x) => x.id)).toEqual(['1', '3']);
  });

  it('filters by skill (exact match)', () => {
    const result = filterByFacets(items, { skill: 'beginner' });
    expect(result.map((x) => x.id)).toEqual(['1']);
  });

  it('filters by instructor (exact match)', () => {
    const result = filterByFacets(items, { instructor: 'Alice' });
    expect(result.map((x) => x.id)).toEqual(['1', '3']);
  });

  it('combines multiple facets (AND logic)', () => {
    const result = filterByFacets(items, { style: 'jazz', instructor: 'Alice' });
    expect(result.map((x) => x.id)).toEqual(['1', '3']);
  });

  it('returns all items when no facets selected', () => {
    const result = filterByFacets(items, {});
    expect(result).toEqual(items);
  });

  it('returns empty when selection matches nothing', () => {
    const result = filterByFacets(items, { style: 'nonexistent' });
    expect(result).toEqual([]);
  });

  it('handles items without piano gracefully', () => {
    const mixedItems = [...items, { id: '5' }];
    const result = filterByFacets(mixedItems, { style: 'jazz' });
    expect(result.map((x) => x.id)).toEqual(['1', '3']);
  });
});

