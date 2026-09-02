import { describe, it, expect } from 'vitest';
import { INTERVENTIONS, interventionsFor } from './interventions.js';

describe('interventions registry', () => {
  it('gives every intervention a plain-language "use when"', () => {
    for (const item of INTERVENTIONS) {
      expect(item.id).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.useWhen.length).toBeGreaterThan(15);
      expect(item.label).not.toMatch(/exception|attestation|override/i); // no jargon in the name
    }
  });

  it('has no duplicate ids', () => {
    const ids = INTERVENTIONS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters to a scope', () => {
    const learner = interventionsFor('learner');
    expect(learner.length).toBeGreaterThan(0);
    expect(learner.every((item) => item.scope === 'learner')).toBe(true);
  });

  it('builds learner-scoped hrefs', () => {
    const credit = INTERVENTIONS.find((item) => item.id === 'completion-credit');
    expect(credit.href('user_4')).toBe('/school/teacher/students/user_4/operations');
  });
});
