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
