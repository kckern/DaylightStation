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
