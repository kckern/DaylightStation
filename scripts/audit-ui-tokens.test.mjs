import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { scanSource, ROOTS, compareToBaseline, planBaselineWrite } from './audit-ui-tokens.mjs';

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

describe('planBaselineWrite', () => {
  it('refuses increases for an existing root', () => {
    const r = planBaselineWrite({ a: { ...zero, 'raw-color': 3 } }, { a: { ...zero, 'raw-color': 2 } });
    expect(r.ok).toBe(false);
  });
  it('allows decreases', () => {
    expect(planBaselineWrite({ a: { ...zero, 'raw-color': 1 } }, { a: { ...zero, 'raw-color': 2 } }).ok).toBe(true);
  });
  it('allows a one-time migration from the old flat shape', () => {
    const r = planBaselineWrite({ a: { ...zero, 'raw-color': 9 } }, { 'raw-color': 441 });
    expect(r.ok).toBe(true);
    expect(r.migrated).toBe(true);
  });
  it('allows a root not yet in the baseline', () => {
    expect(planBaselineWrite({ b: { ...zero, 'raw-color': 5 } }, { a: zero }).ok).toBe(true);
  });
});
