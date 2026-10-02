import { describe, it, expect } from 'vitest';
import { summarize } from './ai-wire-ab.lib.mjs';

const row = (text, path, run, kcal, itemCount, extra = {}) => ({ text, path, run, ms: path === 'toon' ? 900 : 2000, replyChars: path === 'toon' ? 300 : 900, itemCount, kcal, fallback: false, ...extra });

describe('summarize', () => {
  it('passes when TOON stays inside the JSON run-to-run spread', () => {
    const results = [
      row('a', 'json', 1, 500, 2), row('a', 'json', 2, 540, 2), row('a', 'toon', 1, 520, 2),
      row('b', 'json', 1, 100, 1), row('b', 'json', 2, 110, 1), row('b', 'toon', 1, 105, 1),
    ];
    const { verdict, perPath } = summarize(results);
    expect(verdict.pass).toBe(true);
    expect(perPath.toon.meanMs).toBe(900);
    expect(perPath.json.meanReplyChars).toBe(900);
  });

  it('fails on fallbacks above 5% or item-count / kcal drift', () => {
    const results = [
      row('a', 'json', 1, 500, 2), row('a', 'json', 2, 500, 2), row('a', 'toon', 1, 900, 4, { fallback: true }),
    ];
    const { verdict } = summarize(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/fallback/);
    expect(verdict.reasons.join(' ')).toMatch(/item count|kcal/);
  });
});
