import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { flagFor } from "./flags.js";

const CODES = JSON.parse(readFileSync(new URL('./flag-codes.json', import.meta.url), 'utf8'));
const HINT = 'run `npm run prepare:assets` in frontend/ (prebuild copies the flags from flag-icons)';


describe('flagFor', () => {
  it('resolves a known iso (case-insensitive) to a url', () => {
    expect(flagFor('FR')).toBeTruthy();
    expect(flagFor('fr')).toBe(flagFor('FR'));
  });
  it('returns null for an unknown iso', () => {
    expect(flagFor('ZZ')).toBeNull();
  });
});

describe('flag registry completeness', () => {
  it('lists the 50 flags the geography quiz uses', () => {
    expect(CODES).toHaveLength(50);
  });
  it.each(CODES)('flag %s resolves to a url', (iso) => {
    expect(flagFor(iso), `flag "${iso}" missing: ${HINT}`).toBeTruthy();
  });
});
