import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Reduced-motion guard: every SCSS file under widgets/CycleGame that declares an
// animation, a transition or @keyframes also honours prefers-reduced-motion, via
// the cg-reduced-motion mixin from _cgTokens.scss (or a raw media block).
const here = path.dirname(fileURLToPath(import.meta.url));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.scss') ? [p] : []);
  });
}
const scssFiles = walk(here);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** True when the file animates or transitions but has no reduced-motion handling. */
export function lacksReducedMotion(text) {
  const src = stripComments(text);
  const animates = /(animation|transition)\s*:|@keyframes/.test(src);
  const honours = /cg-reduced-motion|prefers-reduced-motion/.test(src);
  return animates && !honours;
}

describe('reduced-motion guard', () => {
  for (const file of scssFiles.filter((f) => !f.endsWith('_cgTokens.scss'))) {
    it(`${path.relative(here, file)} honours prefers-reduced-motion if it animates`, () => {
      expect(lacksReducedMotion(fs.readFileSync(file, 'utf8'))).toBe(false);
    });
  }
  it('the token file provides the cg-reduced-motion mixin', () => {
    expect(fs.readFileSync(path.join(here, '_cgTokens.scss'), 'utf8'))
      .toMatch(/@mixin cg-reduced-motion\s*\{\s*@media \(prefers-reduced-motion: reduce\)\s*\{\s*@content;/);
  });
  it('flags an animating file without handling, passes one with it', () => {
    expect(lacksReducedMotion('.a { animation: x 1s; }')).toBe(true);
    expect(lacksReducedMotion('@keyframes x { to { opacity: 1 } }')).toBe(true);
    expect(lacksReducedMotion('.a { transition: opacity 1s; }')).toBe(true);
    expect(lacksReducedMotion('.a { color: red; }')).toBe(false);
    expect(lacksReducedMotion('.a { animation: x 1s; } @include cg.cg-reduced-motion { .a { animation: none; } }')).toBe(false);
    expect(lacksReducedMotion('.a { animation: x 1s; } @media (prefers-reduced-motion: reduce) { .a { animation: none; } }')).toBe(false);
  });
});
