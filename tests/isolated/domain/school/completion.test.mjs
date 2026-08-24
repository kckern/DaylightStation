import { describe, it, expect } from 'vitest';
import { resolveDayCompletion } from '#domains/school/completion.mjs';

const served = (subject) => ({ subject, obligation: { state: 'served', reason: null } });
const obligated = (subject) => ({ subject, obligation: { state: 'obligated', reason: null } });
const excused = (subject, reason) => ({ subject, obligation: { state: 'excused', reason } });

describe('resolveDayCompletion', () => {
  it('any obligated section -> incomplete, even alongside served and excused ones', () => {
    const result = resolveDayCompletion({
      sections: [served('math'), obligated('writing'), excused('art', 'elective_only')],
    });
    expect(result.state).toBe('incomplete');
  });

  it('no obligated, at least one served -> complete', () => {
    const result = resolveDayCompletion({
      sections: [served('math'), excused('art', 'elective_only')],
    });
    expect(result.state).toBe('complete');
  });

  it('nothing obligated, nothing served -> no_work_today', () => {
    const result = resolveDayCompletion({
      sections: [excused('math', 'awaiting_grown_up'), excused('art', 'elective_only')],
    });
    expect(result.state).toBe('no_work_today');
  });

  it('no sections at all -> no_work_today', () => {
    expect(resolveDayCompletion({ sections: [] }).state).toBe('no_work_today');
  });

  it('excused list is always returned, even on a complete day, for teacher-console visibility', () => {
    const result = resolveDayCompletion({
      sections: [served('math'), excused('science', 'awaiting_grown_up')],
    });
    expect(result.state).toBe('complete');
    expect(result.excused).toEqual([{ subject: 'science', reason: 'awaiting_grown_up' }]);
  });

  it('a non-empty planErrors list adds a plan_error pseudo-section to excused, and does not by itself force incomplete', () => {
    const result = resolveDayCompletion({
      sections: [served('math')],
      planErrors: ['orphan-course: assigned but no published units belong to it'],
    });
    expect(result.state).toBe('complete');
    expect(result.excused).toContainEqual({ subject: null, reason: 'plan_error' });
  });

  it('the cram-day case: an obligated urgent focus section plus a suppressed sibling still yields incomplete overall', () => {
    // Regression for the compound bug the design doc's §1 rejects: obligation
    // must not silently drop to zero on a focus day.
    const result = resolveDayCompletion({
      sections: [obligated('math'), excused('science', 'suppressed_by_focus')],
    });
    expect(result.state).toBe('incomplete');
  });

  it('all subjects caught_up -> no_work_today, not complete (the caught-up-forever case)', () => {
    const result = resolveDayCompletion({
      sections: [excused('math', 'caught_up'), excused('writing', 'caught_up')],
    });
    expect(result.state).toBe('no_work_today');
  });
});
