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
});
