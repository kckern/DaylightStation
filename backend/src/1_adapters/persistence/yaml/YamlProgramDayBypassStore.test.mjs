import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlProgramDayBypassStore } from './YamlProgramDayBypassStore.mjs';

describe('YamlProgramDayBypassStore', () => {
  let dir;
  let configService;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdb-store-'));
    configService = { getHouseholdPath: (p) => path.join(dir, p) };
  });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('list() on a missing file returns empty, not a throw', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    expect(await store.list()).toEqual([]);
  });

  it('append() persists and list() round-trips it', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    const record = {
      schema: 'school.program-day-bypass/v1', operation: 'applied', bypassId: 'pdb_1',
      learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27',
      reason: 'Recital', decidedBy: 'kckern', decidedAt: '2026-08-27T14:00:00-07:00',
    };
    await store.append(record);
    expect(await store.list()).toEqual([record]);
  });

  it('active() excludes a retracted bypassId', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    await store.append({ operation: 'applied', bypassId: 'pdb_1', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' });
    await store.append({ operation: 'retracted', bypassId: 'pdb_1' });
    expect(await store.active()).toEqual([]);
  });

  it('activeFor() matches learnerId + programId + studyDate among active records', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    await store.append({ operation: 'applied', bypassId: 'pdb_1', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' });
    await store.append({ operation: 'applied', bypassId: 'pdb_2', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-26' });
    const hit = await store.activeFor({ learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' });
    expect(hit?.bypassId).toBe('pdb_1');
    const miss = await store.activeFor({ learnerId: 'kid2', programId: 'piano-course', studyDate: '2026-08-27' });
    expect(miss).toBeNull();
  });

  it('two concurrent appends do not clobber each other', async () => {
    const store = new YamlProgramDayBypassStore({ configService });
    await Promise.all([
      store.append({ operation: 'applied', bypassId: 'pdb_a', learnerId: 'kid1', programId: 'piano-course', studyDate: '2026-08-27' }),
      store.append({ operation: 'applied', bypassId: 'pdb_b', learnerId: 'kid2', programId: 'piano-course', studyDate: '2026-08-27' }),
    ]);
    expect((await store.list()).map((r) => r.bypassId).sort()).toEqual(['pdb_a', 'pdb_b']);
  });
});
