import { describe, it, expect } from 'vitest';
import { resolvePassingPercent } from "./passBar.mjs";

const unit = { unitId: 'u1', courseId: 'c1', passing: { percent: 80 } };
const assignments = (courses) => ({ get: async () => ({ courses }) });

describe('resolvePassingPercent', () => {
  it('prefers a per-lesson override', async () => {
    expect(await resolvePassingPercent({ passOverrides: { percentFor: () => 60 },
      assignments: assignments([{ courseId: 'c1', passing: 90 }]), learnerId: 'k', unit })).toBe(60);
  });
  it('then the learner’s enrollment for the unit’s course', async () => {
    expect(await resolvePassingPercent({ passOverrides: { percentFor: () => null },
      assignments: assignments([{ courseId: 'c1', passing: 90 }]), learnerId: 'k', unit })).toBe(90);
  });
  it('finds the enrollment by lesson order when its course id differs, as the issuers do', async () => {
    const byOrder = [{ courseId: 'renamed', passing: 70, enrollment: { lessonOrder: { m1: ['u0', 'u1'] } } }];
    expect(await resolvePassingPercent({ assignments: assignments(byOrder), learnerId: 'k', unit })).toBe(70);
    // An exact course match wins over a lesson-order one.
    expect(await resolvePassingPercent({ assignments: assignments([...byOrder, { courseId: 'c1', passing: 90 }]), learnerId: 'k', unit })).toBe(90);
  });
  it('then the unit’s own bar', async () => {
    expect(await resolvePassingPercent({ assignments: assignments([{ courseId: 'other', passing: 90 }]), learnerId: 'k', unit })).toBe(80);
    expect(await resolvePassingPercent({ assignments: assignments(['c1']), learnerId: 'k', unit })).toBe(80);
    expect(await resolvePassingPercent({ unit })).toBe(80);
  });
  it('ignores a non-integer enrollment bar and a failed read', async () => {
    expect(await resolvePassingPercent({ assignments: assignments([{ courseId: 'c1', passing: null }]), learnerId: 'k', unit })).toBe(80);
    expect(await resolvePassingPercent({ assignments: { get: async () => { throw new Error('io'); } }, learnerId: 'k', unit })).toBe(80);
  });
  it('answers undefined when nothing sets a bar', async () => {
    expect(await resolvePassingPercent({ unit: { unitId: 'u2' } })).toBeUndefined();
  });
});
