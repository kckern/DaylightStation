import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guard for the cycle-game type scale: no literal `font-size: <n>px|rem` outside
// _cgTokens.scss (reduced motion has its own guard: reducedMotion.test.js).
const here = path.dirname(fileURLToPath(import.meta.url));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.scss') ? [p] : []);
  });
}
const scssFiles = walk(here);

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** Literal px/rem sizes left in `font-size` (or `font:`) declarations after removing the allowed forms. */
export function fontSizeViolations(text) {
  const bad = [];
  const src = stripComments(text);
  const decl = /(?:^|[;{\s])(font-size|font)\s*:\s*([^;}]+)/g;
  let m;
  while ((m = decl.exec(src))) {
    let value = m[2];
    // Allowed: scale steps and scale tokens (in any namespace), em/%/inherit are not px|rem so they pass.
    value = value.replace(/[\w-]+\.cg-type\(\s*\d+\s*\)/g, '').replace(/\bcg-type\(\s*\d+\s*\)/g, '')
      .replace(/[\w-]+\.\$tv-[\w-]+/g, '').replace(/\$tv-[\w-]+/g, '');
    if (/(^|[^\w.$-])-?\d*\.?\d+\s*(px|rem)\b/.test(value)) bad.push(`${m[1]}: ${m[2].trim()}`);
  }
  return bad;
}

describe('type scale guard', () => {
  it('finds the SCSS files it is guarding', () => {
    expect(scssFiles.length).toBeGreaterThan(20);
  });

  for (const file of scssFiles.filter((f) => !f.endsWith('_cgTokens.scss'))) {
    it(`${path.relative(here, file)} has no literal font-size`, () => {
      expect(fontSizeViolations(fs.readFileSync(file, 'utf8'))).toEqual([]);
    });
  }

  it('the token file defines the seven-step scale and the function', () => {
    const tokens = fs.readFileSync(path.join(here, '_cgTokens.scss'), 'utf8');
    expect(tokens).toMatch(/\$cg-type:\s*\(1: 1rem, 2: 1\.25rem, 3: 1\.6rem, 4: 2\.2rem, 5: 3\.4rem, 6: 6rem, 7: 9rem\)/);
    expect(tokens).toMatch(/@function cg-type\(\$step\)/);
  });

  // Test the test: the detector must fail on planted literals and pass the allowed forms.
  it('flags planted literals', () => {
    expect(fontSizeViolations('.a { font-size: 1.1rem; }')).toHaveLength(1);
    expect(fontSizeViolations('.a { font-size: 17px }')).toHaveLength(1);
    expect(fontSizeViolations('.a { color: red; font-size:.9rem; }')).toHaveLength(1);
    expect(fontSizeViolations('.a { font-size: max(0.6em, 1.1rem); }')).toHaveLength(1);
    expect(fontSizeViolations('.a { font-size: clamp(1rem, 2vw, cg.cg-type(4)); }')).toHaveLength(1);
    expect(fontSizeViolations('.a { font: 700 14px/1.2 sans-serif; }')).toHaveLength(1);
  });
  it('allows scale calls, tokens, em, % and inherit', () => {
    expect(fontSizeViolations('.a { font-size: cg.cg-type(3); }')).toEqual([]);
    expect(fontSizeViolations('.a { font-size: t.cg-type(1) }')).toEqual([]);
    expect(fontSizeViolations('.a { font-size: cg.$tv-micro; }')).toEqual([]);
    expect(fontSizeViolations('.a { font-size: max(0.6em, cg.cg-type(1)); }')).toEqual([]);
    expect(fontSizeViolations('.a { font-size: clamp(cg.cg-type(1), 3vw, cg.cg-type(4)); }')).toEqual([]);
    expect(fontSizeViolations('.a { font-size: 80%; }')).toEqual([]);
    expect(fontSizeViolations('.a { font-size: inherit; }')).toEqual([]);
    expect(fontSizeViolations('.a { /* font-size: 1.1rem */ color: red; }')).toEqual([]);
  });
});

