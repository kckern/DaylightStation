import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { YamlFilterJobStore, KEEP_RUNS } from './YamlFilterJobStore.mjs';

describe('YamlFilterJobStore', () => {
  it('round-trips a record, keeps the last runs and lists records', async () => {
    const store = new YamlFilterJobStore({ householdDir: mkdtempSync(path.join(os.tmpdir(), 'cf-jobs-')) });
    const runs = Array.from({ length: KEEP_RUNS + 3 }, (_, i) => ({ id: `r${i}`, status: 'done' }));
    await store.save('42', { runs, audit: { ok: true } });
    const r = await store.load('42');
    expect(r.ratingKey).toBe('42');
    expect(r.runs).toHaveLength(KEEP_RUNS);
    expect(r.runs[0].id).toBe('r3');
    expect((await store.list()).map((x) => x.ratingKey)).toEqual(['42']);
    expect(await store.load('7')).toBeNull();
  });
  it('refuses a non-numeric rating key', async () => {
    const store = new YamlFilterJobStore({ householdDir: os.tmpdir() });
    await expect(store.load('../x')).rejects.toThrow('bad ratingKey');
  });
});

describe('YamlFilterJobStore.claim', () => {
  it('lets exactly one caller claim a run', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cf-claim-'));
    const a = new YamlFilterJobStore({ householdDir: dir }); const b = new YamlFilterJobStore({ householdDir: dir });
    const got = await Promise.all([a.claim('42', 'r-1', 'w1'), b.claim('42', 'r-1', 'w2')]);
    expect(got.filter(Boolean)).toHaveLength(1);
    expect(await a.claim('42', 'r-2', 'w1')).toBe(true);
  });
});

describe('YamlFilterJobStore.update (cross-process)', () => {
  it('serialises read-modify-write across store instances', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cf-upd-'));
    const a = new YamlFilterJobStore({ householdDir: dir }); const b = new YamlFilterJobStore({ householdDir: dir });
    await a.save('9', { runs: [], n: 0 });
    const bump = (s) => s.update('9', async (r) => { const n = r.n; await new Promise((x) => setTimeout(x, 5)); r.n = n + 1; });
    await Promise.all([bump(a), bump(b), bump(a), bump(b)]);
    expect((await a.load('9')).n).toBe(4);
  });
});
