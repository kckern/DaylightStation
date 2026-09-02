import { describe, it, expect } from 'vitest';
import { scanSource } from './audit-ui-tokens.mjs';

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
