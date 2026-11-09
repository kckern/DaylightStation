import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Animating `filter` repaints every frame on the kiosk GPUs; the show screen
// fades its thumbnails in with opacity/transform only.
const scss = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'FitnessShow.scss'), 'utf8');

describe('FitnessShow.scss paint cost', () => {
  it('never transitions or animates filter', () => {
    const offenders = scss.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /^\s*(transition|animation)[^:]*:.*\bfilter\b/.test(line));
    expect(offenders).toEqual([]);
  });

  it('never transitions `all` (which sweeps filter and outline along with it)', () => {
    const offenders = scss.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => /^\s*transition\s*:\s*all\b/.test(line));
    expect(offenders).toEqual([]);
  });
});
