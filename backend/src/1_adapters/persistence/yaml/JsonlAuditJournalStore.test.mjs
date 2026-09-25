import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonlAuditJournalStore } from './JsonlAuditJournalStore.mjs';

const makeRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'audit-journal-'));
const makeStore = (root, source = null) => new JsonlAuditJournalStore({
  dataService: { user: { resolveDir: (rel, userId) => path.join(root, userId, rel) } },
  source,
});
const journalDir = (root, userId = 'alice') => path.join(root, userId, 'lifelog/nutrition/auditor-journal');

describe('JsonlAuditJournalStore', () => {
  it('writes month files from `at` and lists a range spanning the boundary, newest first', async () => {
    const root = makeRoot();
    const store = makeStore(root);
    await store.append('alice', { runId: 'r1', at: '2026-08-30T10:00:00.000Z' });
    await store.append('alice', { runId: 'r2', at: '2026-08-31T23:00:00.000Z' });
    await store.append('alice', { runId: 'r3', at: '2026-09-02T08:00:00.000Z' });
    await store.append('alice', { runId: 'r4', at: '2026-09-20T08:00:00.000Z' });
    expect(fs.readdirSync(journalDir(root)).sort()).toEqual(['2026-08.jsonl', '2026-09.jsonl']);

    const rows = await store.list('alice', { from: '2026-08-31', to: '2026-09-03' });
    expect(rows.map((r) => r.runId)).toEqual(['r3', 'r2']);
    expect((await store.list('alice')).map((r) => r.runId)).toEqual(['r4', 'r3', 'r2', 'r1']);
  });

  it('keeps one file per writer and lists every writer', async () => {
    const root = makeRoot();
    const prod = makeStore(root, 'prod');
    const dev = makeStore(root, 'dev/laptop');
    await prod.append('alice', { runId: 'p1', at: '2026-09-10T00:00:00.000Z' });
    await dev.append('alice', { runId: 'd1', at: '2026-09-11T00:00:00.000Z' });
    expect(fs.readdirSync(journalDir(root)).sort()).toEqual(['2026-09.dev-laptop.jsonl', '2026-09.prod.jsonl']);
    expect((await prod.list('alice')).map((r) => r.runId)).toEqual(['d1', 'p1']);
  });

  it('skips malformed lines', async () => {
    const root = makeRoot();
    const store = makeStore(root);
    await store.append('alice', { runId: 'r1', at: '2026-09-10T00:00:00.000Z' });
    fs.appendFileSync(path.join(journalDir(root), '2026-09.jsonl'), '{not json\n{"runId":"x"}\n');
    await store.append('alice', { runId: 'r2', at: '2026-09-11T00:00:00.000Z' });
    expect((await store.list('alice')).map((r) => r.runId)).toEqual(['r2', 'r1']);
  });

  it('dedupes by runId keeping the later line, and never dedupes skip rows', async () => {
    const root = makeRoot();
    const store = makeStore(root);
    const at = '2026-09-10T00:00:00.000Z';
    await store.append('alice', { runId: 'r1', at, status: 'started' });
    await store.append('alice', { skipped: 'no-changes', at: '2026-09-10T01:00:00.000Z' });
    await store.append('alice', { skipped: 'no-changes', at: '2026-09-10T01:00:00.000Z' });
    await store.append('alice', { runId: 'r1', at, status: 'completed', costUsd: 0.01 });
    const rows = await store.list('alice');
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.skipped)).toHaveLength(2);
    expect(rows.find((r) => r.runId === 'r1')).toMatchObject({ status: 'completed', costUsd: 0.01 });
  });

  it('serializes concurrent appends into whole lines', async () => {
    const root = makeRoot();
    const store = makeStore(root);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append('alice', { runId: `r${i}`, at: `2026-09-10T00:00:${String(i).padStart(2, '0')}.000Z` })));
    expect(await store.list('alice')).toHaveLength(20);
  });

  it('returns [] when the user has no journal yet', async () => {
    const store = makeStore(makeRoot());
    expect(await store.list('test-user', { from: '2026-09-01', to: '2026-10-01' })).toEqual([]);
  });

  it('refuses unsafe owners and invalid rows', async () => {
    const store = makeStore(makeRoot());
    await expect(store.list('../etc')).rejects.toThrow(/owner/);
    await expect(store.append('../etc', { runId: 'r', at: '2026-09-10T00:00:00.000Z' })).rejects.toThrow(/owner/);
    await expect(store.append('alice', { runId: 'r' })).rejects.toThrow(/`at`/);
    await expect(store.append('alice', { runId: 'r', at: 'yesterday' })).rejects.toThrow(/`at`/);
    await expect(store.append('alice', { at: '2026-09-10T00:00:00.000Z' })).rejects.toThrow(/runId/);
    await expect(store.list('alice', { from: 'garbage' })).rejects.toThrow(/from/);
  });

  it('rejects on write failure and keeps accepting later appends', async () => {
    const root = makeRoot();
    const store = makeStore(root);
    // A directory where the month file should be makes appendFileSync fail (EISDIR).
    fs.mkdirSync(path.join(journalDir(root), '2026-09.jsonl'), { recursive: true });
    await expect(store.append('alice', { runId: 'r1', at: '2026-09-10T00:00:00.000Z' })).rejects.toThrow();
    await store.append('alice', { runId: 'r2', at: '2026-10-01T00:00:00.000Z' });
    expect(fs.readFileSync(path.join(journalDir(root), '2026-10.jsonl'), 'utf8')).toContain('"r2"');
  });

  it('finds one run near a time hint, or newest month first without one', async () => {
    const root = makeRoot();
    const prod = makeStore(root, 'prod');
    const dev = makeStore(root, 'dev');
    await prod.append('alice', { runId: 'r1', at: '2026-08-31T23:00:00.000Z', status: 'running' });
    await dev.append('alice', { runId: 'r1', at: '2026-08-31T23:00:00.000Z', status: 'completed' });
    await prod.append('alice', { runId: 'r2', at: '2026-09-10T08:00:00.000Z', status: 'completed' });
    await prod.append('alice', { at: '2026-09-10T09:00:00.000Z', skipped: 'cap' });
    expect(await prod.findRun('alice', 'r1', { around: '2026-08-31T23:00:00.000Z' })).toMatchObject({ runId: 'r1' });
    expect(await prod.findRun('alice', 'r2')).toMatchObject({ runId: 'r2', status: 'completed' });
    expect(await prod.findRun('alice', 'r1')).toMatchObject({ runId: 'r1' });
    // a hint far from the run finds nothing in its window
    expect(await prod.findRun('alice', 'r2', { around: '2026-07-01T00:00:00.000Z' })).toBeNull();
    expect(await prod.findRun('alice', 'missing')).toBeNull();
    expect(await makeStore(makeRoot()).findRun('alice', 'r1')).toBeNull();
  });

  it('reads only the newest month when the run is there', async () => {
    const root = makeRoot();
    const store = makeStore(root);
    await store.append('alice', { runId: 'old', at: '2026-08-01T00:00:00.000Z' });
    await store.append('alice', { runId: 'new', at: '2026-09-01T12:00:00.000Z' });
    // An unreadable older month proves the newer month answered on its own.
    const older = path.join(journalDir(root), '2026-08.jsonl');
    fs.chmodSync(older, 0o000);
    try {
      expect(await store.findRun('alice', 'new')).toMatchObject({ runId: 'new' });
      await expect(store.findRun('alice', 'old')).rejects.toThrow();
    } finally { fs.chmodSync(older, 0o644); }
  });
});
