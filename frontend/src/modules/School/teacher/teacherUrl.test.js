import { describe, expect, it } from 'vitest';
import { parseTeacherPath, teacherDayPath, teacherLearnerPath, teacherReadingPath, teacherSessionPath } from './teacherUrl.js';

describe('teacher workspace URL model', () => {
  it('lands roots on the dashboard and rejects malformed paths', () => {
    expect(parseTeacherPath('/school/teacher')).toMatchObject({ kind: 'section', section: 'dashboard' });
    expect(parseTeacherPath('/school/teacher/unknown')).toMatchObject({ kind: 'not-found' });
    expect(parseTeacherPath('/school/teacher/students/user_2/history/not-a-session/ses_1')).toMatchObject({ kind: 'not-found' });
  });

  it('round-trips learner, course, and session routes', () => {
    expect(parseTeacherPath(teacherLearnerPath('a b', 'courses', 'world-history'))).toMatchObject({
      kind: 'learner', section: 'courses', learnerId: 'a b', courseId: 'world-history',
    });
    expect(parseTeacherPath(teacherSessionPath('a b', 'session/1'))).toMatchObject({
      kind: 'session', section: 'history', learnerId: 'a b', sessionId: 'session/1',
    });
  });

  it('rejects removed rollout and legacy aliases', () => {
    expect(parseTeacherPath('/school/teacher-next/queue')).toMatchObject({ kind: 'not-found' });
    expect(parseTeacherPath('/school/teacher/records/user_4')).toMatchObject({ kind: 'not-found' });
    expect(parseTeacherPath('/school/teacher/planning/user_4')).toMatchObject({ kind: 'not-found' });
  });

  it('parses the reading workspace, and builds its path', () => {
    expect(parseTeacherPath('/school/teacher/students/user_4/reading')).toMatchObject({
      kind: 'learner', section: 'reading', learnerId: 'user_4',
    });
    expect(teacherLearnerPath('user_4', 'reading')).toBe('/school/teacher/students/user_4/reading');
    expect(parseTeacherPath(teacherLearnerPath('a b', 'reading'))).toMatchObject({
      kind: 'learner', section: 'reading', learnerId: 'a b',
    });
  });

  it('keeps reading a bare section — no detail id, no deeper path', () => {
    // `courses` is the only learner section that takes a detail segment.
    // A reading path with one is not a route, and must not resolve to the
    // shelf with the extra segment silently dropped.
    expect(parseTeacherPath('/school/teacher/students/user_4/reading/itm_1').kind).toBe('not-found');
    expect(teacherLearnerPath('user_4', 'reading', 'itm_1')).toBe('/school/teacher/students/user_4/reading');
  });

  it('still parses the retired /overview segment instead of 404ing (trim 5.6)', () => {
    // LearnerOverview the component is gone, but the shell redirects this
    // URL rather than 404ing it — which only works if the parser still
    // recognizes the segment as a learner route for it to catch.
    expect(parseTeacherPath('/school/teacher/students/user_4/overview')).toMatchObject({
      kind: 'learner', section: 'overview', learnerId: 'user_4',
    });
  });
});

describe('teacherSessionPath origin', () => {
  it('carries ?from= when the opener says so', async () => {
    const { teacherSessionPath } = await import('./teacherUrl.js');
    expect(teacherSessionPath('user_2', 's1', '/school/teacher', { from: 'today' }))
      .toBe('/school/teacher/students/user_2/history/sessions/s1?from=today');
    expect(teacherSessionPath('user_2', 's1', '/school/teacher', { from: 'day', studyDay: '2026-09-04' }))
      .toBe('/school/teacher/students/user_2/history/sessions/s1?from=day&studyDay=2026-09-04');
    expect(teacherSessionPath('user_2', 's1')).toBe('/school/teacher/students/user_2/history/sessions/s1');
  });
});

describe('learner day route', () => {
  it('parses a dated day route', () => {
    expect(parseTeacherPath('/school/teacher/students/user_4/day/2026-08-25')).toMatchObject({
      kind: 'learner', section: 'day', learnerId: 'user_4', studyDay: '2026-08-25',
    });
  });
  it('parses an undated day route as today-by-default', () => {
    expect(parseTeacherPath('/school/teacher/students/user_4/day')).toMatchObject({
      kind: 'learner', section: 'day', learnerId: 'user_4', studyDay: null,
    });
  });
  it('rejects a malformed study day', () => {
    expect(parseTeacherPath('/school/teacher/students/user_4/day/lastweek').kind).toBe('not-found');
  });
  it('builds a dated day path', () => {
    expect(teacherDayPath('user_4', '2026-08-25')).toBe('/school/teacher/students/user_4/day/2026-08-25');
  });
  it('builds an undated day path', () => {
    expect(teacherDayPath('user_4')).toBe('/school/teacher/students/user_4/day');
  });
  it('falls back to the dashboard without a learner', () => {
    expect(teacherDayPath(null, '2026-08-25')).toBe('/school/teacher/dashboard');
  });
});

describe('teacherReadingPath — the open reading is part of the URL', () => {
  it('is the bare Reading workspace with no reading open', () => {
    expect(teacherReadingPath('learner_a')).toBe('/school/teacher/students/learner_a/reading');
  });

  it('carries the open reading as ?reading=, so a deep link restores it', () => {
    expect(teacherReadingPath('learner_a', 'rd_1'))
      .toBe('/school/teacher/students/learner_a/reading?reading=rd_1');
  });

  it('encodes both, so an id with a slash cannot invent a route', () => {
    expect(teacherReadingPath('learner a', 'rd/1'))
      .toBe('/school/teacher/students/learner%20a/reading?reading=rd%2F1');
  });
});
