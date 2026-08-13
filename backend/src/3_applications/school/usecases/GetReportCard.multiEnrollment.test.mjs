import { describe, expect, it } from 'vitest';
import { detectMultiEnrollment } from './GetReportCard.mjs';

const PERIOD = { startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-12-31T00:00:00.000Z' };

describe('detectMultiEnrollment', () => {
  it('flags a course enrolled under two syllabi inside the period', () => {
    const history = [
      { recordedAt: '2026-09-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'elements-p1-2' }] },
      { recordedAt: '2026-11-02T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'elements-p3-4' }] },
    ];
    expect(detectMultiEnrollment(history, PERIOD)).toEqual([
      { courseId: 'elements', syllabusIds: ['elements-p1-2', 'elements-p3-4'] },
    ]);
  });

  it('does not flag the same syllabus recorded twice', () => {
    const history = [
      { recordedAt: '2026-09-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'elements-p1-2' }] },
      { recordedAt: '2026-10-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'elements-p1-2' }] },
    ];
    expect(detectMultiEnrollment(history, PERIOD)).toEqual([]);
  });

  it('ignores records outside the period', () => {
    const history = [
      { recordedAt: '2026-09-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'a' }] },
      { recordedAt: '2027-02-08T00:00:00.000Z', courses: [{ courseId: 'elements', syllabusId: 'b' }] },
    ];
    expect(detectMultiEnrollment(history, PERIOD)).toEqual([]);
  });

  it('ignores bare-string and unmanaged entries', () => {
    const history = [
      { recordedAt: '2026-09-08T00:00:00.000Z', courses: ['elements', { courseId: 'atlas' }] },
    ];
    expect(detectMultiEnrollment(history, PERIOD)).toEqual([]);
  });
});
