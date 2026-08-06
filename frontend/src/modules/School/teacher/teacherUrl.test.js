import { describe, it, expect } from 'vitest';
import { TABS, parseTeacherPath, teacherPathFor } from './teacherUrl.js';

describe('teacherUrl', () => {
  it('exposes the four tabs in display order', () => {
    expect(TABS).toEqual(['today', 'planning', 'records', 'repair']);
  });

  it('root parses to the Today tab with no learner', () => {
    expect(parseTeacherPath('/school/teacher')).toEqual({ tab: 'today', learnerId: null });
    expect(parseTeacherPath('/school/teacher/')).toEqual({ tab: 'today', learnerId: null });
  });

  it('tab and learner round-trip', () => {
    expect(parseTeacherPath('/school/teacher/records/felix')).toEqual({ tab: 'records', learnerId: 'felix' });
    expect(teacherPathFor('records', 'felix')).toBe('/school/teacher/records/felix');
    expect(parseTeacherPath(teacherPathFor('planning', 'milo'))).toEqual({ tab: 'planning', learnerId: 'milo' });
  });

  it('a tab alone round-trips without a learner segment', () => {
    expect(teacherPathFor('planning')).toBe('/school/teacher/planning');
    expect(parseTeacherPath('/school/teacher/planning')).toEqual({ tab: 'planning', learnerId: null });
  });

  it('an unknown tab normalizes to today', () => {
    expect(parseTeacherPath('/school/teacher/nonsense')).toEqual({ tab: 'today', learnerId: null });
    expect(parseTeacherPath('/school/teacher/nonsense/felix')).toEqual({ tab: 'today', learnerId: null });
  });

  it('learner ids are URI-encoded and decoded', () => {
    expect(teacherPathFor('records', 'a b')).toBe('/school/teacher/records/a%20b');
    expect(parseTeacherPath('/school/teacher/records/a%20b')).toEqual({ tab: 'records', learnerId: 'a b' });
  });
});
