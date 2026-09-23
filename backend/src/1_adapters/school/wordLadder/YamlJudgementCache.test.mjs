import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryJudgementCache, YamlJudgementCache } from './YamlJudgementCache.mjs';

describe('judgement caches', () => {
  it('yaml cache round-trips per package', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-'));
    const cache = new YamlJudgementCache({ rootDir });
    expect(cache.get('korean-vocab', 'gawi', '가이')).toBeNull();
    cache.set('korean-vocab', 'gawi', '가이', { score: 6, judge: 'distance', reason: null });
    expect(new YamlJudgementCache({ rootDir }).get('korean-vocab', 'gawi', '가이')).toMatchObject({ score: 6 });
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  it('memory cache', () => {
    const cache = new MemoryJudgementCache();
    cache.set('p', 'w', 'x', { score: 8, judge: 'model', reason: 'r' });
    expect(cache.get('p', 'w', 'x').score).toBe(8);
  });
  it('test mode reads through to the live cache (a grown-up re-grade) and never writes to it', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-'));
    const live = new YamlJudgementCache({ rootDir });
    live.set('korean-vocab', 'gawi', '가이', { score: 6, judge: 'grown-up', reason: 're-graded' });
    const test = new MemoryJudgementCache({ fallback: live });
    expect(test.get('korean-vocab', 'gawi', '가이')).toMatchObject({ score: 6, judge: 'grown-up' });
    expect(test.get('korean-vocab', 'gawi', '가위')).toBeNull();
    // A test-mode verdict (even for the same answer) stays in memory.
    test.set('korean-vocab', 'gawi', '가위', { score: 9, judge: 'model', reason: null });
    test.set('korean-vocab', 'gawi', '가이', { score: 1, judge: 'model', reason: null });
    expect(test.get('korean-vocab', 'gawi', '가이').score).toBe(1);
    const fresh = new YamlJudgementCache({ rootDir });
    expect(fresh.get('korean-vocab', 'gawi', '가위')).toBeNull();
    expect(fresh.get('korean-vocab', 'gawi', '가이')).toMatchObject({ score: 6, judge: 'grown-up' });
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
  it('a live cache that throws reads as a miss in test mode', () => {
    const test = new MemoryJudgementCache({ fallback: { get() { throw new Error('corrupt'); }, set() { throw new Error('no'); } } });
    expect(test.get('p', 'w', 'x')).toBeNull();
  });
});
