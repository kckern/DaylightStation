// __app_modules/media/media/browser/surround/themes/christmas.test.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import * as sass from 'sass-embedded';
import { CHRISTMAS_SURROUND_THEME, CHRISTMAS_STILL_SURROUND_THEME } from '../../surround-christmas.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = sass.compile(path.join(__dirname, 'christmas.scss')).css;

describe('christmas theme', () => {
  it('names both looks', () => {
    expect(CHRISTMAS_SURROUND_THEME).toBe('christmas');
    expect(CHRISTMAS_STILL_SURROUND_THEME).toBe('christmas-still');
  });
  it('sets every custom property the reused modules read, on both looks', () => {
    for (const prop of ['--ink', '--ink-soft', '--brass', '--brass-lit', '--bond-ground',
      '--programme', '--programme-edge', '--surround-display', '--surround-body', '--surround-annotation']) {
      expect(css).toContain(`${prop}:`);
    }
    expect(css).toContain('.surround-frame--theme-christmas-still');
  });
  it('snows only on the snowing look, only in the rail and band, and never for reduced motion', () => {
    const snowRules = css.split('}').filter((r) => r.includes('christmas-snow'));
    expect(snowRules.length).toBeGreaterThan(0);
    expect(snowRules.join('}')).not.toContain('christmas-still');
    expect(snowRules.join('}')).not.toContain('__stage');
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*animation:\s*none/);
  });
});
