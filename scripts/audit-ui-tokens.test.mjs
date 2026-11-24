import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { scanSource, ROOTS, compareToBaseline, planBaselineWrite, bucketCounts } from './audit-ui-tokens.mjs';

describe('audit-ui-tokens rules', () => {
  it('flags raw hex colors', () => {
    const hits = scanSource('a.scss', '.x { color: #ff0000; }');
    expect(hits.some(h => h.rule === 'raw-color')).toBe(true);
  });

  it('passes var(--ds-*) usage and data-color annotations', () => {
    expect(scanSource('a.scss', '.x { color: var(--ds-danger); }')).toEqual([]);
    expect(scanSource('a.scss', '.x { color: #ff0000; /* data-color */ }')).toEqual([]);
  });

  it('flags literal motion durations and keyframes', () => {
    const hits = scanSource('a.scss', '.x { transition: all 0.3s; } @keyframes spin {}');
    expect(hits.filter(h => h.rule === 'raw-motion').length).toBe(2);
  });

  it('passes motion via tokens', () => {
    expect(scanSource('a.scss', '.x { transition: opacity var(--ds-motion-base); }')).toEqual([]);
  });

  it('flags ad-hoc keydown listeners in app code', () => {
    const hits = scanSource('frontend/src/modules/Health/X.jsx', "document.addEventListener('keydown', fn)");
    expect(hits.some(h => h.rule === 'raw-keydown')).toBe(true);
  });

  it('flags undefined --ds-* tokens, passes defined ones', () => {
    expect(scanSource('a.scss', '.x { color: var(--ds-surfce); }')
      .some(h => h.rule === 'undefined-token')).toBe(true);
    expect(scanSource('a.scss', '.x { color: var(--ds-surface); }')).toEqual([]);
  });
});

describe('audit-ui-tokens roots', () => {
  it('every root exists on disk', () => {
    for (const root of ROOTS) expect(fs.existsSync(root), root).toBe(true);
  });

  it('covers the seven web apps', () => {
    for (const part of ['modules/Admin', 'household/home', 'wellness/health', 'household/auto',
      'personal/life', 'media/feed', 'media/media']) {
      expect(ROOTS.some(r => r.includes(part)), part).toBe(true);
    }
  });
});

describe('undefined-token reads names whole', () => {
  it('passes a defined name and flags a digit-suffixed undefined one', () => {
    expect(scanSource('a.scss', '.x { gap: var(--ds-space-md); }')).toEqual([]);
    const hits = scanSource('a.scss', '.x { gap: var(--ds-space-9x); }');
    expect(hits).toHaveLength(1);
    expect(hits[0].token).toBe('--ds-space-9x');
  });
  it('reports --ds-space-2 whole', () => {
    expect(scanSource('a.scss', '.x { gap: var(--ds-space-2); }')[0].token).toBe('--ds-space-2');
  });
});

const zero = { 'raw-color': 0, 'raw-motion': 0, 'raw-keydown': 0, 'native-control': 0, 'undefined-token': 0 };
describe('compareToBaseline', () => {
  it('fails above baseline', () => {
    const r = compareToBaseline({ a: { ...zero, 'raw-color': 3 } }, { a: { ...zero, 'raw-color': 2 } });
    expect(r.failed).toBe(true);
  });
  it('passes at baseline', () => {
    const r = compareToBaseline({ a: { ...zero, 'raw-color': 2 } }, { a: { ...zero, 'raw-color': 2 } });
    expect(r.failed).toBe(false);
    expect(r.lines.join('\n')).not.toMatch(/ratchet/);
  });
  it('passes below baseline and says it can ratchet down', () => {
    const r = compareToBaseline({ a: { ...zero, 'raw-color': 1 } }, { a: { ...zero, 'raw-color': 2 } });
    expect(r.failed).toBe(false);
    expect(r.lines.join('\n')).toMatch(/can ratchet down/);
  });
  it('treats roots absent from the baseline as 0', () => {
    expect(compareToBaseline({ b: { ...zero, 'raw-motion': 1 } }, {}).failed).toBe(true);
  });
});

const OLD_FLAT = { 'raw-color': 441, 'raw-motion': 3, 'raw-keydown': 1, 'native-control': 2, 'undefined-token': 0 };
describe('planBaselineWrite', () => {
  const cur = { a: { ...zero, 'raw-color': 1 } };
  it('refuses increases for an existing root', () => {
    const r = planBaselineWrite({ a: { ...zero, 'raw-color': 3 } }, { a: { ...zero, 'raw-color': 2 } });
    expect(r.ok).toBe(false);
  });
  it('allows decreases', () => {
    expect(planBaselineWrite({ a: { ...zero, 'raw-color': 1 } }, { a: { ...zero, 'raw-color': 2 } }).ok).toBe(true);
  });
  it('allows migration from a genuine old flat file', () => {
    const r = planBaselineWrite({ a: { ...zero, 'raw-color': 9 } }, OLD_FLAT);
    expect(r.ok).toBe(true);
    expect(r.migrated).toBe(true);
  });
  it('refuses to migrate an empty baseline', () => {
    const r = planBaselineWrite(cur, {});
    expect(r.ok).toBe(false);
    expect(r.migrated).toBe(false);
    expect(r.errors.join('\n')).toMatch(/--init-baseline/);
  });
  it('refuses to migrate when the file is missing', () => {
    const r = planBaselineWrite(cur, null);
    expect(r.ok).toBe(false);
    expect(r.migrated).toBe(false);
  });
  it('refuses a mixed file (roots plus a stray number)', () => {
    const r = planBaselineWrite(cur, { a: { ...zero, 'raw-color': 5 }, x: 1 });
    expect(r.ok).toBe(false);
    expect(r.migrated).toBe(false);
  });
  it('refuses a flat file with unknown keys', () => {
    const r = planBaselineWrite(cur, { ...OLD_FLAT, bogus: 4 });
    expect(r.ok).toBe(false);
    expect(r.migrated).toBe(false);
  });
  it('refuses an existing new-shape file with one stray number', () => {
    const r = planBaselineWrite({ a: zero }, { a: zero, 'raw-color': 7 });
    expect(r.ok).toBe(false);
    expect(r.migrated).toBe(false);
  });
  it('refuses a root absent from the baseline without --add-root', () => {
    const r = planBaselineWrite({ a: zero, b: { ...zero, 'raw-color': 5 } }, { a: zero });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/--add-root b/);
  });
  it('allows a new root when --add-root names exactly it', () => {
    const r = planBaselineWrite({ a: zero, b: { ...zero, 'raw-color': 5 } }, { a: zero }, { addRoot: 'b' });
    expect(r.ok).toBe(true);
  });
  it('refuses a new root when --add-root names a different root', () => {
    const r = planBaselineWrite({ a: zero, b: zero }, { a: zero }, { addRoot: 'c' });
    expect(r.ok).toBe(false);
  });
  it('--init-baseline writes only when the file is missing', () => {
    expect(planBaselineWrite(cur, null, { initBaseline: true }).ok).toBe(true);
    expect(planBaselineWrite(cur, { a: zero }, { initBaseline: true }).ok).toBe(false);
    expect(planBaselineWrite(cur, {}, { initBaseline: true }).ok).toBe(false);
  });
});

describe('bucketCounts', () => {
  it('buckets hits per root and ignores files under no root', () => {
    const hits = [
      { rule: 'raw-color', file: 'r1/a.scss', line: 1 },
      { rule: 'raw-color', file: 'r1/sub/b.scss', line: 2 },
      { rule: 'raw-motion', file: 'r2/c.scss', line: 3 },
      { rule: 'raw-color', file: 'r1x/d.scss', line: 4 },
      { rule: 'raw-color', file: 'elsewhere/e.scss', line: 5 },
    ];
    const c = bucketCounts(hits, ['r1', 'r2']);
    expect(Object.keys(c)).toEqual(['r1', 'r2']);
    expect(c.r1).toEqual({ ...zero, 'raw-color': 2 });
    expect(c.r2).toEqual({ ...zero, 'raw-motion': 1 });
  });
});
