// readingAudience.test.js
import { describe, it, expect } from 'vitest';
import { readingAudience } from './readingAudience.js';

describe('readingAudience', () => {
  it("declares the credited child (the pick's learner first) while a session is open", () => {
    expect(readingAudience({ learner: { id: 'learner-a', name: 'Learner A' }, pick: null }))
      .toEqual({ activity: 'story', people: [{ id: 'learner-a', name: 'Learner A', role: 'learner', guest: false }] });
    expect(readingAudience({ learner: { id: 'learner-a', name: 'A' }, pick: { learner: { id: 'learner-b', name: 'B' } } }).people[0].id)
      .toBe('learner-b');
  });
  it('is null with no open session', () => {
    expect(readingAudience({ learner: null, pick: null })).toBeNull();
    expect(readingAudience(null)).toBeNull();
  });
});
