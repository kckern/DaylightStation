import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlReadingLogStore } from '#adapters/persistence/yaml/YamlReadingLogStore.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
let dir;
const makeStore = () => new YamlReadingLogStore({
  configService: { getHouseholdPath: () => dir }, logger: silent,
});

const recordingLogger = () => {
  const calls = { warn: [], error: [], info: [], debug: [] };
  return {
    calls,
    warn: (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
    info: (...a) => calls.info.push(a),
    debug: (...a) => calls.debug.push(a),
  };
};

const FROZEN = '2026-08-26T18:04:00.000Z';
const STAMP = '2026-08-26T18-04-00-000Z';

const seed = async (learnerId, studyDay, text) => {
  await mkdir(path.join(dir, learnerId), { recursive: true });
  const file = path.join(dir, learnerId, `${studyDay}.yml`);
  await writeFile(file, text, 'utf8');
  return file;
};

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

  describe('corrupt shard', () => {
    const CORRUPT = 'reads: [ unterminated\n  - broken: :\n';

    it('preserves the corrupt bytes alongside and starts a fresh shard on append', async () => {
      const logger = recordingLogger();
      const file = await seed('learner-c', '2026-08-26', CORRUPT);
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir },
        logger,
        clock: () => new Date(FROZEN),
      });

      await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:9', title: 'Fresh' });

      const sideFile = `${file}.corrupt-${STAMP}`;
      expect(await readFile(sideFile, 'utf8')).toBe(CORRUPT);

      const rows = await store.listForDay('learner-c', '2026-08-26');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ contentId: 'plex:9', title: 'Fresh' });

      const errors = logger.calls.error.map(([event]) => event);
      expect(errors).toContain('school.reading-log.corrupt-side-filed');
      const [, payload] = logger.calls.error.find(([event]) => event === 'school.reading-log.corrupt-side-filed');
      expect(payload).toMatchObject({ learnerId: 'learner-c', studyDay: '2026-08-26', preservedAt: sideFile });
    });

    it('side-files a structurally wrong document too', async () => {
      const file = await seed('learner-c', '2026-08-26', 'learnerId: learner-c\nstudyDay: 2026-08-26\n');
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir }, logger: silent, clock: () => new Date(FROZEN),
      });
      await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:9' });
      expect(await readFile(`${file}.corrupt-${STAMP}`, 'utf8')).toBe('learnerId: learner-c\nstudyDay: 2026-08-26\n');
      expect(await store.listForDay('learner-c', '2026-08-26')).toHaveLength(1);
    });

    it('listForDay still answers [] and leaves no side-file — reads have no side effects', async () => {
      await seed('learner-c', '2026-08-26', CORRUPT);
      const store = makeStore();
      expect(await store.listForDay('learner-c', '2026-08-26')).toEqual([]);
      expect(await store.listForDay('learner-c', '2026-08-26')).toEqual([]);
      expect(await readdir(path.join(dir, 'learner-c'))).toEqual(['2026-08-26.yml']);
    });

    it('two appends racing after a corrupt read produce one side-file, not two', async () => {
      await seed('learner-c', '2026-08-26', CORRUPT);
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir }, logger: silent, clock: () => new Date(FROZEN),
      });
      await Promise.all([
        store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:1', title: 'One' }),
        store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:2', title: 'Two' }),
      ]);
      const entries = (await readdir(path.join(dir, 'learner-c'))).sort();
      expect(entries.filter((n) => n.includes('.corrupt-'))).toHaveLength(1);
      expect((await store.listForDay('learner-c', '2026-08-26')).map((r) => r.title)).toEqual(['One', 'Two']);
    });
  });

  it('does not treat a missing file as corrupt — no side-file, no error log', async () => {
    const logger = recordingLogger();
    const store = new YamlReadingLogStore({
      configService: { getHouseholdPath: () => dir }, logger, clock: () => new Date(FROZEN),
    });
    expect(await store.listForDay('learner-c', '2026-08-26')).toEqual([]);
    await store.append({ learnerId: 'learner-c', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:1' });
    expect(await readdir(path.join(dir, 'learner-c'))).toEqual(['2026-08-26.yml']);
    expect(logger.calls.error).toEqual([]);
    expect(logger.calls.warn).toEqual([]);
  });
});
