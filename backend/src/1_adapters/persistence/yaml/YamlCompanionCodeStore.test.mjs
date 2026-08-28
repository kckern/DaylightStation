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
import { YamlCompanionCodeStore, COMPANION_CODE_SCHEMA } from '#adapters/persistence/yaml/YamlCompanionCodeStore.mjs';

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
  schema: COMPANION_CODE_SCHEMA,
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

  it('refuses to mint over a record it cannot read, rather than replacing a printed code', async () => {
    // The header's headline argument. A corrupt file may still be a code that is
    // on paper in a child's hand; minting a fresh one over it would make that
    // sheet unpassable, and silently.
    const store = storeAt(dir);
    const key = store.keyFor(SCOPE);
    await fs.mkdir(path.join(dir, RECORDS), { recursive: true });
    await fs.writeFile(path.join(dir, RECORDS, `${key}.yml`), 'code: [A, C\nid: "oops\n', 'utf8');
    let mints = 0;

    await expect(store.findOrCreate({
      key,
      create: () => { mints += 1; return recordFor(key); },
    })).rejects.toThrow(/unreadable/i);
    expect(mints).toBe(0);
  });

  it('will not file a record under an id that is not its key', async () => {
    // Such a record is invisible to every later get(key) — including the one
    // that would notice it and repair it.
    const store = storeAt(dir);
    const key = store.keyFor(SCOPE);

    await expect(store.findOrCreate({
      key,
      create: () => recordFor(key, { id: store.keyFor({ ...SCOPE, lessonDay: '2026-08-27' }) }),
    })).rejects.toThrow(/does not match its key/i);
  });

  it('treats a file that parses but is not a record as unreadable, not as an existing code', async () => {
    // `- A\n- C\n` is valid YAML. Accepted as a record it would hand the print
    // task `code === undefined` and print a BLANK gate row — the exact failure
    // 04442a53c was written to prevent, arriving through the back door.
    const store = storeAt(dir);
    const key = store.keyFor(SCOPE);
    await fs.mkdir(path.join(dir, RECORDS), { recursive: true });
    await fs.writeFile(path.join(dir, RECORDS, `${key}.yml`), '- A\n- C\n', 'utf8');

    expect(await store.get(key)).toBeNull();
    await expect(store.findOrCreate({ key, create: () => recordFor(key) })).rejects.toThrow(/unreadable/i);
  });

  it('throws on a mutator that returns its assignment instead of the record, and changes nothing', async () => {
    // `(r) => r.satisfiedAt = ts` is the concise arrow a caller will reach for,
    // and it evaluates to a STRING. Writing that would leave the file holding a
    // bare scalar, after which the record can never be read OR repaired and the
    // whole scope's gate is bricked for every child on the lesson.
    const store = storeAt(dir);
    const key = store.keyFor(SCOPE);
    await store.findOrCreate({ key, create: () => recordFor(key) });

    await expect(store.update(key, (r) => { r.satisfiedAt = 'ts'; return r.satisfiedAt; }))
      .rejects.toThrow(/not the record/i);
    await expect(store.update(key, () => false)).rejects.toThrow(/not the record/i);

    expect((await store.get(key)).code).toEqual(['A', 'C', 'E']);
  });

  it('honours a mutator that edits its draft in place and returns nothing', async () => {
    const store = storeAt(dir);
    const key = store.keyFor(SCOPE);
    await store.findOrCreate({ key, create: () => recordFor(key) });

    await store.update(key, (r) => { r.coverage['part-1'] = { duration: 60 }; });

    expect((await store.get(key)).coverage['part-1']).toEqual({ duration: 60 });
  });

  it('keys the same whether or not the scope arrives with stray whitespace', () => {
    // This codebase has a standing YAML gotcha where `app: webcam` parses with a
    // leading space; an untrimmed part would split one lesson across two codes.
    const store = storeAt(dir);
    expect(store.keyFor({ ...SCOPE, lessonId: ` ${SCOPE.lessonId} ` })).toBe(store.keyFor(SCOPE));
  });

  it('refuses an uppercase-hex id, which is a second file for one scope on Linux', async () => {
    // keyFor never mints uppercase. A case variant is the same file on macOS and
    // a DIFFERENT one in the Linux container — it would pass in dev and split the
    // household's code in production.
    const store = storeAt(dir);
    const upper = `cmc_${store.keyFor(SCOPE).slice(4).toUpperCase()}`;

    await expect(store.get(upper)).rejects.toThrow(/unsafe/i);
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
