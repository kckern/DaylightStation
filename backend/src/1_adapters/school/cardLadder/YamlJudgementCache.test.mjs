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

describe('YamlJudgementCache — the one-time move out of runtime/word-ladder', () => {
  const seed = () => {
    const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-move-'));
    const legacyRootDir = path.join(runtime, 'word-ladder');
    const rootDir = path.join(runtime, 'card-ladder');
    fs.mkdirSync(path.join(legacyRootDir, 'korean-vocab'), { recursive: true });
    const legacyFile = path.join(legacyRootDir, 'korean-vocab', 'judgements.yml');
    fs.writeFileSync(legacyFile, 'gawi|가이: { score: 6, judge: grown-up, reason: re-graded }\n');
    return { runtime, rootDir, legacyRootDir, legacyFile, legacyBytes: fs.readFileSync(legacyFile, 'utf8') };
  };
  it('copies the package file on first read, reads and writes the copy after, and never touches the old one', () => {
    const { runtime, rootDir, legacyRootDir, legacyFile, legacyBytes } = seed();
    try {
      const cache = new YamlJudgementCache({ rootDir, legacyRootDir });
      expect(cache.get('korean-vocab', 'gawi', '가이')).toMatchObject({ score: 6, judge: 'grown-up' });
      expect(fs.existsSync(path.join(rootDir, 'korean-vocab', 'judgements.yml'))).toBe(true);
      cache.set('korean-vocab', 'pul', '푸', { score: 4, judge: 'distance', reason: null });
      const again = new YamlJudgementCache({ rootDir, legacyRootDir });
      expect(again.get('korean-vocab', 'gawi', '가이')).toMatchObject({ score: 6 });
      expect(again.get('korean-vocab', 'pul', '푸')).toMatchObject({ score: 4 });
      expect(fs.readFileSync(legacyFile, 'utf8')).toBe(legacyBytes);
      expect(fs.readdirSync(path.join(rootDir, 'korean-vocab'))).toEqual(['judgements.yml']);
    } finally { fs.rmSync(runtime, { recursive: true, force: true }); }
  });
  it('test mode (MemoryJudgementCache over the live cache) reads the old file in place and writes neither path', () => {
    const { runtime, rootDir, legacyRootDir, legacyFile, legacyBytes } = seed();
    try {
      const test = new MemoryJudgementCache({ fallback: new YamlJudgementCache({ rootDir, legacyRootDir }) });
      expect(test.get('korean-vocab', 'gawi', '가이')).toMatchObject({ score: 6, judge: 'grown-up' });
      test.set('korean-vocab', 'gawi', '가위', { score: 9, judge: 'model', reason: null });
      expect(fs.existsSync(rootDir)).toBe(false);
      expect(fs.readFileSync(legacyFile, 'utf8')).toBe(legacyBytes);
    } finally { fs.rmSync(runtime, { recursive: true, force: true }); }
  });
});

