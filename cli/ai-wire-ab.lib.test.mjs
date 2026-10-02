import { describe, it, expect } from 'vitest';
import { summarize, nameOverlap } from './ai-wire-ab.lib.mjs';

const FOODS = ['rice', 'chicken thigh', 'broccoli', 'iced tea', 'egg'];
const row = (text, path, run, kcal, itemCount, extra = {}) => ({ text, path, run, ms: path === 'toon' ? 900 : 2000, replyChars: path === 'toon' ? 300 : 900, itemCount, kcal, names: FOODS.slice(0, itemCount), fallback: false, success: true, error: null, ...extra });

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

  it('fails when every run on both paths errored', () => {
    const bad = { success: false, error: 'boom', itemCount: 0, kcal: 0 };
    const results = [row('a', 'json', 1, 0, 0, bad), row('a', 'toon', 1, 0, 0, bad)];
    const { verdict } = summarize(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/2 of 2 runs failed/);
  });

  it('fails when the JSON baseline produced 0 items', () => {
    const results = [row('a', 'json', 1, 0, 0), row('a', 'json', 2, 0, 0), row('a', 'toon', 1, 0, 0)];
    const { verdict } = summarize(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/0 items/);
  });

  it('fails on empty results without NaN', () => {
    const { verdict, perPath } = summarize([]);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/no texts measured/);
    expect(JSON.stringify({ perPath, verdict })).not.toMatch(/NaN|null/);
  });

  it('reports texts missing a path separately', () => {
    const results = [row('a', 'json', 1, 500, 2), row('a', 'toon', 1, 500, 2), row('b', 'json', 1, 100, 1)];
    const { verdict } = summarize(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/1 texts missing/);
    expect(verdict.reasons.join(' ')).not.toMatch(/matched for only/);
  });

  it('treats a tied JSON modal count as matching any tied value', () => {
    const results = [row('a', 'json', 1, 500, 1), row('a', 'json', 2, 500, 2), row('a', 'toon', 1, 500, 2)];
    const { verdict } = summarize(results);
    expect(verdict.pass).toBe(true);
  });

  it('passes name overlap when each TOON run shares >= half its names with the JSON union', () => {
    const results = [
      row('a', 'json', 1, 500, 2, { names: ['rice', 'chicken thigh'] }),
      row('a', 'json', 2, 500, 2, { names: ['white rice', 'chicken thigh'] }),
      row('a', 'toon', 1, 500, 2, { names: ['White Rice', 'grilled chicken'] }),
    ];
    const { verdict } = summarize(results);
    expect(verdict.pass).toBe(true);
  });

  it('fails name overlap when TOON logged different foods with the same count and kcal', () => {
    const results = [
      row('a', 'json', 1, 500, 2, { names: ['rice', 'chicken thigh'] }),
      row('a', 'json', 2, 500, 2, { names: ['rice', 'chicken thigh'] }),
      row('a', 'toon', 1, 500, 2, { names: ['pasta', 'beef'] }),
    ];
    const { verdict } = summarize(results);
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/food names overlapped JSON's .* for only 0\/1 texts/);
  });

  it('nameOverlap is the share of TOON names present in the JSON union', () => {
    const union = new Set(['rice', 'egg']);
    expect(nameOverlap(['Rice', 'toast'], union)).toBe(0.5);
    expect(nameOverlap([], union)).toBe(0);
    expect(nameOverlap([], new Set())).toBe(1);
  });
});
