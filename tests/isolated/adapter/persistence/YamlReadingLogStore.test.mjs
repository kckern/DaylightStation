import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlReadingLogStore } from '#adapters/persistence/yaml/YamlReadingLogStore.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
let dir;
const makeStore = () => new YamlReadingLogStore({
  configService: { getHouseholdPath: () => dir }, logger: silent,
});

describe('YamlReadingLogStore', () => {
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'readinglog-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('appends a read and reads it back for that study day', async () => {
    const store = makeStore();
    await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: '2026-08-26T18:04:00.000Z', contentId: 'plex:620681', title: 'The Jungle Book', tagUid: '04215172cc2a81', location: 'livingroom' });
    const rows = await store.listForDay('learner-c', '2026-08-26');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contentId: 'plex:620681', title: 'The Jungle Book' });
  });

  it('keeps two reads on the same day in append order', async () => {
    const store = makeStore();
    await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1', title: 'One' });
    await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: '2026-08-26T19:00:00.000Z', contentId: 'plex:2', title: 'Two' });
    expect((await store.listForDay('learner-c', '2026-08-26')).map((r) => r.title)).toEqual(['One', 'Two']);
  });

  it('scopes reads per learner', async () => {
    const store = makeStore();
    await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1' });
    expect(await store.listForDay('learner-d', '2026-08-26')).toEqual([]);
  });

  it('answers an empty list for a day with no file, and never throws', async () => {
    expect(await makeStore().listForDay('learner-c', '2026-01-01')).toEqual([]);
  });

  it('refuses a path-traversing learner id', async () => {
    await expect(makeStore().append({ learnerId: '../../etc', studyDay: '2026-08-26', at: 'x' })).rejects.toThrow();
  });

  it('refuses a malformed study day', async () => {
    await expect(makeStore().append({ learnerId: 'learner-c', studyDay: 'not-a-day', at: 'x' })).rejects.toThrow();
  });
});
