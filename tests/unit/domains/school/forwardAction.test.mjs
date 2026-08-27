import { describe, it, expect } from 'vitest';
import { chooseForwardAction } from '#domains/school/documents/forwardAction.mjs';

const section = (subject, over = {}) => ({
  subject, servedToday: false, next: null, ...over,
});
const curriculumNext = (unitId, title) => ({ unitId, title, program: null });
const programNext = (unitId, title) => ({ unitId, title, program: 'piano' });

describe('chooseForwardAction', () => {
  it('offers the first unserved curriculum subject (tier 1)', () => {
    const out = chooseForwardAction({
      sections: [
        section('scripture', { servedToday: true }),
        section('civilization', { next: curriculumNext('atlas-p100', 'South Dakota') }),
      ],
      subject: 'scripture',
      backlog: null,
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: {} },
    });
    expect(out.tier).toBe(1);
    expect(out.subject).toBe('civilization');
    expect(out.continueToday).toBe(false);
    expect(out.eyebrow).toBe('Next up');
    expect(out.title).toBe('South Dakota');
  });

  it('never offers a program subject in tier 1', () => {
    const out = chooseForwardAction({
      sections: [
        section('scripture', { servedToday: true }),
        section('arts', { next: programNext('piano-course', 'Piano') }),
      ],
      subject: 'scripture',
      backlog: null,
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: {} },
    });
    expect(out.tier).toBe(3);
    expect(out.subject).toBe('scripture');
  });

  it('falls to backlog in this subject when every subject is served (tier 2)', () => {
    const out = chooseForwardAction({
      sections: [section('scripture', { servedToday: true })],
      subject: 'scripture',
      backlog: { unitId: 'cfm-d2', title: 'Psalms 62-69' },
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: {} },
    });
    expect(out.tier).toBe(2);
    expect(out.subject).toBe('scripture');
    expect(out.continueToday).toBe(true);
    expect(out.eyebrow).toBe('Catch up');
    expect(out.title).toBe('Psalms 62-69');
  });

  it('fires tier 2 even when nothing is unlocked (the Friday-d5 case)', () => {
    const out = chooseForwardAction({
      sections: [section('scripture', { servedToday: true })],
      subject: 'scripture',
      backlog: { unitId: 'cfm-d2', title: 'Psalms 62-69' },
      unlocked: null,
    });
    expect(out.tier).toBe(2);
  });

  it('offers one more in this subject only when nothing else applies (tier 3)', () => {
    const out = chooseForwardAction({
      sections: [section('scripture', { servedToday: true })],
      subject: 'scripture',
      backlog: null,
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: { course: 'CFM' } },
    });
    expect(out.tier).toBe(3);
    expect(out.eyebrow).toBe('One more?');
    expect(out.description).toBe('Today is already complete. Scan only if you want one more.');
    expect(out.taxonomy).toEqual({ course: 'CFM' });
  });

  it('offers nothing when the day is done and there is no backlog or next lesson', () => {
    expect(chooseForwardAction({
      sections: [section('scripture', { servedToday: true })],
      subject: 'scripture',
      backlog: null,
      unlocked: null,
    })).toBeNull();
  });

  it('ignores a section that is unserved but has no next action', () => {
    const out = chooseForwardAction({
      sections: [
        section('scripture', { servedToday: true }),
        section('civilization', { next: null }),
      ],
      subject: 'scripture',
      backlog: null,
      unlocked: { unitId: 'cfm-d4', title: 'Psalm 78', taxonomy: {} },
    });
    expect(out.tier).toBe(3);
  });

  it('does not offer the subject just passed as its own tier 1', () => {
    const out = chooseForwardAction({
      sections: [section('scripture', { servedToday: false, next: curriculumNext('cfm-d3', 'Psalms 70-77') })],
      subject: 'scripture',
      backlog: null,
      unlocked: null,
    });
    expect(out).toBeNull();
  });
});
