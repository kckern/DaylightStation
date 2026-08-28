// backend/src/1_adapters/persistence/yaml/YamlCompanionCodeStore.test.mjs
// @vitest-environment node
//
// One record per (household, lesson, day) — and the FIRST print wins it.
//
// The scope deliberately drops the learner: two siblings on the same lesson on
// the same day share one code, so they are two writers on one file. That is the
// same collision that corrupted `ral_h1IAmJ6QEiJi.yml` on 2026-08-26 (see
// YamlLessonCompanionStore's header), except here losing does not merely drop a
// progress sample — it would mint a SECOND code over a code already printed on a
// sibling's worksheet, and that sheet can then never pass its own gate.
//
// A real temp directory, not a mocked fs: the behaviour under test IS the
// filesystem's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { YamlCompanionCodeStore } from '#adapters/persistence/yaml/YamlCompanionCodeStore.mjs';

let dir;
const silentLogger = {
  info() {}, warn() {}, debug() {}, error() {},
};
const storeAt = (root, logger = silentLogger) => new YamlCompanionCodeStore({
  configService: { getHouseholdPath: (rel) => path.join(root, rel) },
  logger,
});
const RECORDS = 'school/records/companion-codes';
const SCOPE = { householdId: 'hh1', lessonId: 'cfm-ot-2026-08-26', lessonDay: '2026-08-26' };
const recordFor = (key, over = {}) => ({
  schema: 'school.companion-code/v1',
  id: key,
  ...SCOPE,
  code: ['A', 'C', 'E'],
  requireParts: 1,
  createdAt: '2026-08-26T17:02:11-07:00',
  satisfiedAt: null,
  satisfiedBy: null,
  satisfiedVia: null,
  coverage: {},
  ...over,
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-code-store-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('YamlCompanionCodeStore', () => {
  it('keys the same scope to the same id, and any change of scope to a different one', () => {
    const store = storeAt(dir);
    const base = store.keyFor(SCOPE);

    expect(store.keyFor(SCOPE)).toBe(base);
    expect(store.keyFor({ ...SCOPE, householdId: 'hh2' })).not.toBe(base);
    expect(store.keyFor({ ...SCOPE, lessonId: 'cfm-ot-2026-09-02' })).not.toBe(base);
    expect(store.keyFor({ ...SCOPE, lessonDay: '2026-08-27' })).not.toBe(base);
  });

  it('writes the created record, and leaves it on disk', async () => {
    const store = storeAt(dir);
    const key = store.keyFor(SCOPE);

    const created = await store.findOrCreate({ key, create: () => recordFor(key) });

    expect(created.code).toEqual(['A', 'C', 'E']);
    const raw = await fs.readFile(path.join(dir, RECORDS, `${key}.yml`), 'utf8');
    expect(yaml.load(raw).code).toEqual(['A', 'C', 'E']);
  });

  it('gives the second caller the FIRST code, and never asks it to mint one', async () => {
    // The sibling race. A second mint would put a different code on the second
    // child's sheet than the one the household will actually earn.
    const store = storeAt(dir);
    const key = store.keyFor(SCOPE);
    let mints = 0;

    const first = await store.findOrCreate({
      key,
      create: () => { mints += 1; return recordFor(key, { code: ['A', 'C', 'E'] }); },
    });
    const second = await store.findOrCreate({
      key,
      create: () => { mints += 1; return recordFor(key, { code: ['B', 'D'] }); },
    });

    expect(mints).toBe(1);
    expect(second.code).toEqual(first.code);
  });

  it('applies an update and the change survives a fresh read', async () => {
    const store = storeAt(dir);
    const key = store.keyFor(SCOPE);
    await store.findOrCreate({ key, create: () => recordFor(key) });

    const updated = await store.update(key, (record) => {
      record.satisfiedAt = '2026-08-26T17:40:00-07:00';
      record.satisfiedBy = 'learner-2';
      return record;
    });

    expect(updated.satisfiedBy).toBe('learner-2');
    expect((await storeAt(dir).get(key)).satisfiedAt).toBe('2026-08-26T17:40:00-07:00');
  });

  it('answers null for a file it cannot parse — and says so at error level', async () => {
    const calls = [];
    const store = storeAt(dir, { ...silentLogger, error: (...args) => calls.push(args) });
    const key = store.keyFor(SCOPE);
    await fs.mkdir(path.join(dir, RECORDS), { recursive: true });
    // The shape of the production corruption: an unterminated quote.
    await fs.writeFile(path.join(dir, RECORDS, `${key}.yml`), 'code: [A, C\nid: "oops\n', 'utf8');

    expect(await store.get(key)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('school.companion-code.unreadable');
    expect(calls[0][1]).toMatchObject({ id: key });
  });

  it('refuses an unsafe id before it resolves a path at all', async () => {
    let resolutions = 0;
    const store = new YamlCompanionCodeStore({
      configService: {
        getHouseholdPath: (rel) => { resolutions += 1; return path.join(dir, rel); },
      },
      logger: silentLogger,
    });

    await expect(store.get('../../etc/passwd')).rejects.toThrow(/unsafe/i);
    expect(resolutions).toBe(0);
    await expect(fs.readdir(path.join(dir, RECORDS))).rejects.toThrow();
  });
});
