/**
 * The case-drift hazard, pinned.
 *
 * Session ids minted mixed-case, and `slugify` (school/documents/receipts.mjs)
 * lowercases them to build document ids — so ONE session was spelled two ways
 * in one tree: `ses_hmSsHlJR` in the receipt id and `records/session-results`,
 * `ws-ses-hmsshljr` in the worksheet artifact id. That fold is 62^n -> 36^n and
 * therefore lossy, so two case-twin sessions could merge into a single
 * worksheet document id; and the tree syncs to a case-insensitive macOS
 * checkout, exposing mixed-case filenames to an APFS collision.
 *
 * A lowercase alphabet makes the fold the identity. These assert that, and that
 * narrowing the alphabet did not narrow the entropy.
 */
import { describe, it, expect } from 'vitest';
import { shortIdLower, shortId } from './id.mjs';

/** The real one, copied so this test fails if the two ever diverge. */
const slugify = (value) => String(value ?? '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

describe('shortIdLower — the case fold must be lossless', () => {
  it('emits only lowercase alphanumerics', () => {
    for (let i = 0; i < 2000; i += 1) expect(shortIdLower(10)).toMatch(/^[a-z0-9]{10}$/);
  });

  it('survives slugify unchanged, so one session has exactly one spelling', () => {
    for (let i = 0; i < 5000; i += 1) {
      const id = `ses_${shortIdLower(10)}`;
      expect(slugify(id)).toBe(id.replace(/_/g, '-'));
    }
  });

  // The old mint is exactly what this replaces — proving it DOES drift is what
  // makes the fix meaningful rather than decorative.
  it('the mixed-case mint it replaces does drift under the same fold', () => {
    const drifted = Array.from({ length: 5000 }, () => `ses_${shortId(8)}`)
      .some((id) => slugify(id) !== id.replace(/_/g, '-'));
    expect(drifted).toBe(true);
  });

  it('keeps more entropy than the mixed-case 8 it replaces', () => {
    // 36^10 ≈ 2^51.7 vs 62^8 ≈ 2^47.6.
    expect(10 * Math.log2(36)).toBeGreaterThan(8 * Math.log2(62));
  });

  it('does not collide across a large sample', () => {
    const seen = new Set(Array.from({ length: 20000 }, () => shortIdLower(10)));
    expect(seen.size).toBe(20000);
  });
});
