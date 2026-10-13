import { describe, it, expect } from 'vitest';
import { shortIdLower, shortId } from './id.mjs';

const slugify = (value) => String(value ?? '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

describe('shortIdLower — the case fold must be lossless', () => {
  it('emits only lowercase alphanumerics', () => {
    for (let i = 0; i < 2000; i += 1) expect(shortIdLower(10)).toMatch(/^[a-z0-9]{10}$/);
  });
  it('survives slugify unchanged', () => {
    for (let i = 0; i < 5000; i += 1) {
      const id = `ses_${shortIdLower(10)}`;
      expect(slugify(id)).toBe(id.replace(/_/g, '-'));
    }
  });
  it('the mixed-case mint it replaces drifts under the same fold', () => {
    expect(Array.from({ length: 5000 }, () => `ses_${shortId(8)}`)
      .some((id) => slugify(id) !== id.replace(/_/g, '-'))).toBe(true);
  });
  it('keeps more entropy than the mixed-case 8 it replaces', () => {
    expect(10 * Math.log2(36)).toBeGreaterThan(8 * Math.log2(62));
  });
  it('does not collide across a large sample', () => {
    expect(new Set(Array.from({ length: 20000 }, () => shortIdLower(10))).size).toBe(20000);
  });
});
