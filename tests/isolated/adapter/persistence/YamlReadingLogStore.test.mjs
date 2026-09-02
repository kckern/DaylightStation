import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import yaml from 'js-yaml';
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
    await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T18:04:00.000Z', contentId: 'plex:620681', title: 'The Jungle Book', tagUid: '04215172cc2a81', location: 'livingroom' });
    const rows = await store.listForDay('user_5', '2026-08-26');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contentId: 'plex:620681', title: 'The Jungle Book' });
  });

  it('keeps two reads on the same day in append order', async () => {
    const store = makeStore();
    await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1', title: 'One' });
    await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T19:00:00.000Z', contentId: 'plex:2', title: 'Two' });
    expect((await store.listForDay('user_5', '2026-08-26')).map((r) => r.title)).toEqual(['One', 'Two']);
  });

  it('scopes reads per learner', async () => {
    const store = makeStore();
    await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1' });
    expect(await store.listForDay('user_3', '2026-08-26')).toEqual([]);
  });

  it('answers an empty list for a day with no file, and never throws', async () => {
    expect(await makeStore().listForDay('user_5', '2026-01-01')).toEqual([]);
  });

  it('refuses a path-traversing learner id', async () => {
    await expect(makeStore().append({ learnerId: '../../etc', studyDay: '2026-08-26', at: 'x' })).rejects.toThrow();
  });

  it('refuses a malformed study day', async () => {
    await expect(makeStore().append({ learnerId: 'user_5', studyDay: 'not-a-day', at: 'x' })).rejects.toThrow();
  });

  describe('corrupt shard', () => {
    const CORRUPT = 'reads: [ unterminated\n  - broken: :\n';

    it('preserves the corrupt bytes alongside and starts a fresh shard on append', async () => {
      const logger = recordingLogger();
      const file = await seed('user_5', '2026-08-26', CORRUPT);
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir },
        logger,
        clock: () => new Date(FROZEN),
      });

      await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:9', title: 'Fresh' });

      const sideFile = `${file}.corrupt-${STAMP}`;
      expect(await readFile(sideFile, 'utf8')).toBe(CORRUPT);

      const rows = await store.listForDay('user_5', '2026-08-26');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ contentId: 'plex:9', title: 'Fresh' });

      const errors = logger.calls.error.map(([event]) => event);
      expect(errors).toContain('school.reading-log.corrupt-side-filed');
      const [, payload] = logger.calls.error.find(([event]) => event === 'school.reading-log.corrupt-side-filed');
      expect(payload).toMatchObject({ learnerId: 'user_5', studyDay: '2026-08-26', preservedAt: sideFile });
    });

    it('side-files a structurally wrong document too', async () => {
      const file = await seed('user_5', '2026-08-26', 'learnerId: user_5\nstudyDay: 2026-08-26\n');
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir }, logger: silent, clock: () => new Date(FROZEN),
      });
      await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:9' });
      expect(await readFile(`${file}.corrupt-${STAMP}`, 'utf8')).toBe('learnerId: user_5\nstudyDay: 2026-08-26\n');
      expect(await store.listForDay('user_5', '2026-08-26')).toHaveLength(1);
    });

    it('listForDay still answers [] and leaves no side-file — reads have no side effects', async () => {
      await seed('user_5', '2026-08-26', CORRUPT);
      const store = makeStore();
      expect(await store.listForDay('user_5', '2026-08-26')).toEqual([]);
      expect(await store.listForDay('user_5', '2026-08-26')).toEqual([]);
      expect(await readdir(path.join(dir, 'user_5'))).toEqual(['2026-08-26.yml']);
    });

    it('two appends racing after a corrupt read produce one side-file, not two', async () => {
      await seed('user_5', '2026-08-26', CORRUPT);
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir }, logger: silent, clock: () => new Date(FROZEN),
      });
      await Promise.all([
        store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:1', title: 'One' }),
        store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:2', title: 'Two' }),
      ]);
      const entries = (await readdir(path.join(dir, 'user_5'))).sort();
      expect(entries.filter((n) => n.includes('.corrupt-'))).toHaveLength(1);
      expect((await store.listForDay('user_5', '2026-08-26')).map((r) => r.title)).toEqual(['One', 'Two']);
    });
  });

  describe('partially bad shard — a reads[] holding one entry we do not recognise', () => {
    // The hand-merge `programs.md` tells an operator to perform is exactly how
    // this arises: a salvaged row pasted back as a bare title rather than a map.
    const PARTIAL = [
      'learnerId: user_5',
      'studyDay: 2026-08-26',
      'reads:',
      '  - The Jungle Book',
      "  - at: '2026-08-26T18:00:00.000Z'",
      '    title: Two',
      '',
    ].join('\n');

    it('carries the unrecognised entry through the rewrite instead of deleting it', async () => {
      const logger = recordingLogger();
      const file = await seed('user_5', '2026-08-26', PARTIAL);
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir }, logger, clock: () => new Date(FROZEN),
      });

      await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:3', title: 'Three' });

      const written = yaml.load(await readFile(file, 'utf8'));
      expect(written.reads).toHaveLength(3);
      expect(written.reads[0]).toBe('The Jungle Book');
      expect(written.reads[1]).toMatchObject({ title: 'Two' });
      expect(written.reads[2]).toMatchObject({ title: 'Three' });
    });

    it('logs the unrecognised entry rather than dropping it in silence', async () => {
      const logger = recordingLogger();
      await seed('user_5', '2026-08-26', PARTIAL);
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir }, logger, clock: () => new Date(FROZEN),
      });

      expect((await store.listForDay('user_5', '2026-08-26')).map((r) => r.title)).toEqual(['Two']);
      const warned = logger.calls.warn.find(([event]) => event === 'school.reading-log.unrecognised-entries');
      expect(warned).toBeTruthy();
      expect(warned[1]).toMatchObject({ learnerId: 'user_5', studyDay: '2026-08-26', unrecognised: 1 });
    });

    it('does not side-file it — the document IS a reading log, one row aside', async () => {
      await seed('user_5', '2026-08-26', PARTIAL);
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir }, logger: silent, clock: () => new Date(FROZEN),
      });
      await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:3', title: 'Three' });
      expect(await readdir(path.join(dir, 'user_5'))).toEqual(['2026-08-26.yml']);
    });
  });

  describe('a shard whose bytes cannot be rescued', () => {
    // A directory where the shard should be: `fileExists` says yes, the read
    // fails (EISDIR). Deterministic, and unlike chmod 000 it holds as root.
    const seedUnreadable = async () => {
      await mkdir(path.join(dir, 'user_5', '2026-08-26.yml'), { recursive: true });
    };

    it('append throws rather than replace what it could not read', async () => {
      const logger = recordingLogger();
      await seedUnreadable();
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir }, logger, clock: () => new Date(FROZEN),
      });
      await expect(store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:1' }))
        .rejects.toThrow(/refusing to overwrite/);
      expect(logger.calls.error.map(([event]) => event)).toContain('school.reading-log.unreadable');
    });

    it('listForDay still answers [] and warns', async () => {
      const logger = recordingLogger();
      await seedUnreadable();
      const store = new YamlReadingLogStore({
        configService: { getHouseholdPath: () => dir }, logger, clock: () => new Date(FROZEN),
      });
      expect(await store.listForDay('user_5', '2026-08-26')).toEqual([]);
      expect(logger.calls.warn.map(([event]) => event)).toContain('school.reading-log.read-failed');
    });
  });

  it('never overwrites an earlier rescue — a second side-file de-collides', async () => {
    const CORRUPT_A = 'reads: [ first unterminated\n';
    const CORRUPT_B = 'reads: [ second unterminated\n';
    const file = await seed('user_5', '2026-08-26', CORRUPT_A);
    const store = new YamlReadingLogStore({
      configService: { getHouseholdPath: () => dir }, logger: silent, clock: () => new Date(FROZEN),
    });

    await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:1', title: 'One' });
    // Same frozen instant, a second corruption: the first rescue must survive.
    await writeFile(file, CORRUPT_B, 'utf8');
    await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:2', title: 'Two' });

    expect(await readFile(`${file}.corrupt-${STAMP}`, 'utf8')).toBe(CORRUPT_A);
    expect(await readFile(`${file}.corrupt-${STAMP}-2`, 'utf8')).toBe(CORRUPT_B);
    expect((await store.listForDay('user_5', '2026-08-26')).map((r) => r.title)).toEqual(['Two']);
  });

  it('replaces a zero-byte shard but says so — a truncated file already lost its rows', async () => {
    const logger = recordingLogger();
    await seed('user_5', '2026-08-26', '');
    const store = new YamlReadingLogStore({
      configService: { getHouseholdPath: () => dir }, logger, clock: () => new Date(FROZEN),
    });

    expect(await store.listForDay('user_5', '2026-08-26')).toEqual([]);
    expect(logger.calls.warn.map(([event]) => event)).toContain('school.reading-log.empty');

    await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:1', title: 'One' });
    expect((await store.listForDay('user_5', '2026-08-26')).map((r) => r.title)).toEqual(['One']);
    // Nothing to preserve, so nothing is side-filed.
    expect(await readdir(path.join(dir, 'user_5'))).toEqual(['2026-08-26.yml']);
  });

  describe('pickId — idempotent on one finish', () => {
    // doneToday is `rows.length >= target`, so a duplicate ROW is a duplicate
    // BOOK. A retried POST or a player that remounts and fires `ended` twice
    // must not credit a child twice for one story.
    it('appends once for a repeated pickId and returns the row already on disk', async () => {
      const store = makeStore();
      const first = await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1', title: 'One', pickId: 'pick-1' });
      const again = await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T19:30:00.000Z', contentId: 'plex:1', title: 'One retried', pickId: 'pick-1' });

      const rows = await store.listForDay('user_5', '2026-08-26');
      expect(rows).toHaveLength(1);
      // The EXISTING row, not the incoming one: the caller gets what is on disk.
      expect(again).toMatchObject({ title: 'One', at: '2026-08-26T18:00:00.000Z' });
      expect(again).toEqual(first);
      expect(rows[0]).toMatchObject({ title: 'One', pickId: 'pick-1' });
    });

    it('stores the pickId on the row', async () => {
      const store = makeStore();
      await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1', pickId: 'pick-1' });
      expect((await store.listForDay('user_5', '2026-08-26'))[0]).toMatchObject({ pickId: 'pick-1' });
    });

    it('never dedupes on a null pickId — two hand-recorded reads are two reads', async () => {
      const store = makeStore();
      await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1', title: 'Same book' });
      await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T19:00:00.000Z', contentId: 'plex:1', title: 'Same book' });
      const rows = await store.listForDay('user_5', '2026-08-26');
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.pickId === null)).toBe(true);
    });

    it('is scoped to the day — the same pickId in another shard does not dedupe', async () => {
      const store = makeStore();
      await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1', title: 'One', pickId: 'pick-1' });
      await store.append({ learnerId: 'user_5', studyDay: '2026-08-27', at: '2026-08-27T18:00:00.000Z', contentId: 'plex:1', title: 'One', pickId: 'pick-1' });
      expect(await store.listForDay('user_5', '2026-08-26')).toHaveLength(1);
      expect(await store.listForDay('user_5', '2026-08-27')).toHaveLength(1);
    });

    it('leaves a carried-through unrecognised entry untouched when it dedupes', async () => {
      const file = await seed('user_5', '2026-08-26', [
        'learnerId: user_5',
        'studyDay: 2026-08-26',
        'reads:',
        '  - The Jungle Book',
        "  - at: '2026-08-26T18:00:00.000Z'",
        '    title: Two',
        '    pickId: pick-2',
        '',
      ].join('\n'));
      const store = makeStore();
      const before = await readFile(file, 'utf8');

      const again = await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T20:00:00.000Z', contentId: 'plex:2', title: 'Two retried', pickId: 'pick-2' });

      expect(again).toMatchObject({ title: 'Two' });
      // A repeat writes NOTHING, so the unrecognised entry cannot be disturbed.
      expect(await readFile(file, 'utf8')).toBe(before);
    });

    it('scans only recognised rows for the key — an unparseable entry carries no pickId', async () => {
      const file = await seed('user_5', '2026-08-26', [
        'learnerId: user_5',
        'studyDay: 2026-08-26',
        'reads:',
        '  - pick-1',
        '',
      ].join('\n'));
      const store = makeStore();
      await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: '2026-08-26T18:00:00.000Z', contentId: 'plex:1', title: 'One', pickId: 'pick-1' });

      const written = yaml.load(await readFile(file, 'utf8'));
      expect(written.reads).toHaveLength(2);
      expect(written.reads[0]).toBe('pick-1');
      expect(written.reads[1]).toMatchObject({ title: 'One', pickId: 'pick-1' });
    });
  });

  it('does not treat a missing file as corrupt — no side-file, no error log', async () => {
    const logger = recordingLogger();
    const store = new YamlReadingLogStore({
      configService: { getHouseholdPath: () => dir }, logger, clock: () => new Date(FROZEN),
    });
    expect(await store.listForDay('user_5', '2026-08-26')).toEqual([]);
    await store.append({ learnerId: 'user_5', studyDay: '2026-08-26', at: FROZEN, contentId: 'plex:1' });
    expect(await readdir(path.join(dir, 'user_5'))).toEqual(['2026-08-26.yml']);
    expect(logger.calls.error).toEqual([]);
    expect(logger.calls.warn).toEqual([]);
  });
});
