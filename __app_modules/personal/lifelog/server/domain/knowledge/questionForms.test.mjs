import { describe, it, expect } from 'vitest';
import { buildQuestion, lintQuestion } from './questionForms.mjs';
import { resolveDueDate, localDateFor, nextLocalTime } from './calendar.mjs';
import { loop, TZ } from './fixtures.testHelpers.mjs';
describe('literal calendar interpretation', () => {
  it.each([['Monday','2026-11-02','2026-11-09'],['today','2026-11-02','2026-11-02'],['tomorrow','2026-10-31','2026-11-01'],['on Monday','2026-10-31','2026-11-02'],['2026-11-04','2026-11-02','2026-11-04'],['after the holidays','2026-11-02',null]])('%s relative to %s', (text, entryDate, expected) => expect(resolveDueDate({ text, entryDate, timezone: TZ })).toBe(expected));
  it('uses the entry local date and handles DST for the next nightly time', () => {
    expect(localDateFor(Date.parse('2026-11-01T04:38Z'), TZ)).toBe('2026-10-31');
    expect(nextLocalTime({ asOf: Date.parse('2026-11-01T08:00Z'), timezone: TZ, hour: 3, minute: 30 })).toBe(Date.parse('2026-11-01T11:30Z'));
    expect(nextLocalTime({ asOf: Date.parse('2026-03-08T08:00Z'), timezone: TZ, hour: 3, minute: 30 })).toBe(Date.parse('2026-03-08T10:30Z'));
  });
});
describe('factual question forms', () => {
  it.each(['status','outcome','confirm'])('builds a deterministic %s question for a loop', form => {
    const result = buildQuestion({ object: loop(), form }); expect(result.objectId).toBe('loop.application-reply');
    expect(result.text).toContain('Sample reply'); expect(lintQuestion(result)).toEqual({ valid: true, reason: null });
  });
  it.each(['Why did Sample reply?', 'How did you feel about Sample?', 'What drove your decision?', 'Did you choose this or that?'])('rejects the banned frame %s', text => expect(lintQuestion({ text, form: 'status', subjectKind: 'loop' }).valid).toBe(false));
  it('does not build questions whose subject is a concern or a deferred form', () => {
    expect(buildQuestion({ object: { ...loop(), kind: 'concern' }, form: 'status' })).toBeNull();
    expect(buildQuestion({ object: loop(), form: 'identity' })).toBeNull();
  });
});
