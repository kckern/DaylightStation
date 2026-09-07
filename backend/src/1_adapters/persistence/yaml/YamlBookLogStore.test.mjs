import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { BookLogShelfUnreadableError, YamlBookLogStore } from './YamlBookLogStore.mjs';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

let root;
const configService = { getHouseholdPath: (suffix) => path.join(root, suffix) };
const store = (over = {}) => new YamlBookLogStore({ configService, logger: silentLogger, ...over });

const dir = () => path.join(root, 'school/records/books');
const fileFor = (learnerId) => path.join(dir(), `${learnerId}.yml`);
const write = (learnerId, text) => {
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(fileFor(learnerId), text);
};
const read = (learnerId) => yaml.load(fs.readFileSync(fileFor(learnerId), 'utf8'));

const opened = (overrides = {}) => ({
  learnerId: 'learner_a', isbn: '9780064400558', progressMode: 'page', pageCount: 184,
  openedOn: '2026-08-01', idempotencyKey: 'e1', ...overrides,
});

/** A v1 file, the shape every real shelf is in until the migration runs. */
const LEGACY_FILE = `items:
  - itemId: learner_a:9780064400558:e1
    bookId: '9780064400558'
    progressMode: page
    pageCount: 184
    openedAt: '2026-08-01T10:00:00.000Z'
    events:
      - kind: started
        at: '2026-08-01T10:00:00.000Z'
        entryId: e1
      - kind: progress
        at: '2026-08-03T10:00:00.000Z'
        page: 84
        entryId: p1
`;

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'booklog-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('YamlBookLogStore', () => {
  it('requires a configService, because a default path would write somewhere wrong', () => {
    expect(() => new YamlBookLogStore({ logger: silentLogger })).toThrow(/configService/);
  });

  it('opens a reading and reads it back, keyed by an opaque id', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());

    expect(reading.id).toMatch(/^rdg_/);
    // The id names NOTHING. Not the learner, not the book, not an entry.
    expect(reading.id).not.toContain('learner_a');
    expect(reading.id).not.toContain('9780064400558');

    const readings = await subject.listForLearner('learner_a');
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({
      id: reading.id, learnerId: 'learner_a',
      book: { isbn: '9780064400558', pageCount: 184 },
      progressMode: 'page', status: 'reading', openedOn: '2026-08-01', finishedOn: null,
      entries: [], revisions: [],
    });
  });

  it('writes the v2 schema under records/, per learner', async () => {
    await store().openReading(opened());
    expect(fs.existsSync(fileFor('learner_a'))).toBe(true);
    expect(read('learner_a').schema).toBe('school.book-log/v2');
    expect(Array.isArray(read('learner_a').readings)).toBe(true);
  });

  it('is idempotent on the open key — a retried open is not a second reading', async () => {
    const subject = store();
    const first = await subject.openReading(opened());
    const again = await subject.openReading(opened());
    expect(again.id).toBe(first.id);
    expect(await subject.listForLearner('learner_a')).toHaveLength(1);
  });

  it('opens a SECOND reading of the same book — two passes are two records', async () => {
    const subject = store();
    const first = await subject.openReading(opened());
    await subject.updateReading({
      learnerId: 'learner_a', readingId: first.id,
      patch: { status: 'finished', finishedOn: '2026-08-09' },
    });
    const second = await subject.openReading(opened({ idempotencyKey: 'e2', openedOn: '2026-09-01' }));

    expect(second.id).not.toBe(first.id);
    const readings = await subject.listForLearner('learner_a');
    expect(readings).toHaveLength(2);
    // Same book, two histories — the case the old key could only express by accident.
    expect(readings.map((r) => r.book.isbn)).toEqual(['9780064400558', '9780064400558']);
  });

  it('refuses to reuse an open key for a different book, and still dedupes the same one', async () => {
    const subject = store();
    const first = await subject.openReading(opened());
    await expect(subject.openReading(opened({ isbn: '9780027746723' }))).rejects.toThrow(/different book/);
    expect((await subject.openReading(opened())).id).toBe(first.id);
  });

  it('appends an addressable entry, and dedupes a retried one', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());
    const entry = await subject.appendEntry({
      learnerId: 'learner_a', readingId: reading.id,
      on: '2026-08-03', at: '2026-08-03T10:00:00.000Z', page: 84, source: 'panel', idempotencyKey: 'p1',
    });
    expect(entry.id).toMatch(/^ent_/);

    const again = await subject.appendEntry({
      learnerId: 'learner_a', readingId: reading.id,
      on: '2026-08-03', at: '2026-08-03T11:00:00.000Z', page: 90, idempotencyKey: 'p1',
    });
    expect(again.id).toBe(entry.id);
    const [stored] = await subject.listForLearner('learner_a');
    expect(stored.entries).toHaveLength(1);
    expect(stored.entries[0]).toMatchObject({ on: '2026-08-03', at: '2026-08-03T10:00:00.000Z', page: 84 });
  });

  it('gives every entry its own id, so two check-ins on one day are two rows', async () => {
    const subject = store();
    const reading = await subject.openReading(opened({ progressMode: 'check', pageCount: null }));
    const a = await subject.appendEntry({ learnerId: 'learner_a', readingId: reading.id, on: '2026-08-03', idempotencyKey: 'c1' });
    const b = await subject.appendEntry({ learnerId: 'learner_a', readingId: reading.id, on: '2026-08-03', idempotencyKey: 'c2' });
    expect(a.id).not.toBe(b.id);
  });

  it('sets a state instead of appending an event that implies one', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());
    const updated = await subject.updateReading({
      learnerId: 'learner_a', readingId: reading.id,
      patch: { status: 'set-aside' },
      revision: { id: 'rev_1', by: 'test-user', at: '2026-08-10T10:00:00.000Z', verb: 'set-aside', toldChild: false },
    });
    expect(updated.status).toBe('set-aside');
    const [stored] = await subject.listForLearner('learner_a');
    expect(stored.status).toBe('set-aside');
    expect(stored.revisions).toHaveLength(1);
    expect(stored.revisions[0]).toMatchObject({ verb: 'set-aside', by: 'test-user' });
  });

  it('corrects the book on a reading without touching its identity', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());
    const updated = await subject.updateReading({
      learnerId: 'learner_a', readingId: reading.id, patch: { book: { isbn: '9780027746723', pageCount: 320 } },
    });
    expect(updated.id).toBe(reading.id);
    expect(updated.book).toEqual({ isbn: '9780027746723', pageCount: 320 });
  });

  it('refuses a patch that would rewrite identity or evidence wholesale', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());
    for (const patch of [{ id: 'rdg_other' }, { learnerId: 'learner_b' }, { entries: [] }, { revisions: [] }]) {
      await expect(subject.updateReading({ learnerId: 'learner_a', readingId: reading.id, patch }))
        .rejects.toThrow(/patch/);
    }
  });

  it('edits and removes one entry by its id', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());
    const keep = await subject.appendEntry({ learnerId: 'learner_a', readingId: reading.id, on: '2026-08-03', page: 40, idempotencyKey: 'p1' });
    const typo = await subject.appendEntry({ learnerId: 'learner_a', readingId: reading.id, on: '2026-08-04', page: 250, idempotencyKey: 'p2' });

    await subject.updateEntry({ learnerId: 'learner_a', readingId: reading.id, entryId: keep.id, patch: { page: 45 } });
    await subject.deleteEntry({ learnerId: 'learner_a', readingId: reading.id, entryId: typo.id });

    const [stored] = await subject.listForLearner('learner_a');
    expect(stored.entries.map((entry) => entry.page)).toEqual([45]);
  });

  it('deletes a whole reading', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());
    await subject.deleteReading({ learnerId: 'learner_a', readingId: reading.id });
    expect(await subject.listForLearner('learner_a')).toEqual([]);
  });

  it('moves a reading to the sibling who actually read it', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());
    await subject.appendEntry({ learnerId: 'learner_a', readingId: reading.id, on: '2026-08-03', page: 40, idempotencyKey: 'p1' });

    const moved = await subject.moveReading({ learnerId: 'learner_a', readingId: reading.id, toLearnerId: 'learner_b' });

    expect(moved.learnerId).toBe('learner_b');
    // The id survives the move: it never named the learner in the first place.
    expect(moved.id).toBe(reading.id);
    expect(await subject.listForLearner('learner_a')).toEqual([]);
    const [arrived] = await subject.listForLearner('learner_b');
    expect(arrived).toMatchObject({ id: reading.id, learnerId: 'learner_b' });
    expect(arrived.entries).toHaveLength(1);
  });

  it('refuses a move into a damaged destination rather than half-completing it', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());
    write('learner_b', 'this: [is: not: valid');

    await expect(subject.moveReading({ learnerId: 'learner_a', readingId: reading.id, toLearnerId: 'learner_b' }))
      .rejects.toBeInstanceOf(BookLogShelfUnreadableError);

    // The source still holds it. A reading that lands nowhere is worse than one
    // that did not move.
    expect(await subject.listForLearner('learner_a')).toHaveLength(1);
    expect(fs.readFileSync(fileFor('learner_b'), 'utf8')).toBe('this: [is: not: valid');
  });

  it('every write names its learner — no id is ever parsed for one', async () => {
    const subject = store();
    const reading = await subject.openReading(opened());
    // An id that names nothing still writes to the right file, because the
    // caller says which learner. Parsing the id was the defect.
    await subject.appendEntry({ learnerId: 'learner_a', readingId: reading.id, on: '2026-08-03', page: 12, idempotencyKey: 'p1' });
    expect((await subject.listForLearner('learner_a'))[0].entries).toHaveLength(1);

    await expect(subject.appendEntry({ readingId: reading.id, on: '2026-08-03', idempotencyKey: 'p9' }))
      .rejects.toThrow(/learnerId/);
  });

  it('refuses an unsafe learner id rather than writing outside the tree', async () => {
    await expect(store().openReading(opened({ learnerId: '../escape' }))).rejects.toThrow(/learnerId/);
  });

  it('answers an empty shelf for a learner with no file — never throws on read', async () => {
    expect(await store().listForLearner('nobody')).toEqual([]);
  });

  describe('a v1 file', () => {
    it('reads as v2 without being rewritten', async () => {
      write('learner_a', LEGACY_FILE);
      const readings = await store().listForLearner('learner_a');

      expect(readings).toHaveLength(1);
      expect(readings[0]).toMatchObject({
        id: 'learner_a:9780064400558:e1', learnerId: 'learner_a',
        book: { isbn: '9780064400558', pageCount: 184 },
        progressMode: 'page', status: 'reading', openedOn: '2026-08-01', idempotencyKey: 'e1',
      });
      expect(readings[0].entries).toHaveLength(1);
      expect(readings[0].entries[0]).toMatchObject({ on: '2026-08-03', page: 84, idempotencyKey: 'p1' });

      // Reads do not mutate. A grown-up looking at a shelf must not migrate it.
      expect(fs.readFileSync(fileFor('learner_a'), 'utf8')).toBe(LEGACY_FILE);
    });

    it('maps its instants through the household day rule, not a UTC slice', async () => {
      write('learner_a', LEGACY_FILE.replace("at: '2026-08-03T10:00:00.000Z'", "at: '2026-08-04T02:00:00.000Z'"));
      const pacificDay = (iso) => new Date(Date.parse(iso) - 11 * 3_600_000).toISOString().slice(0, 10);
      const [reading] = await store({ dayOf: pacificDay }).listForLearner('learner_a');
      expect(reading.entries[0].on).toBe('2026-08-03');
    });

    it('keeps a copy of the bytes when a write finally converts it', async () => {
      write('learner_a', LEGACY_FILE);
      const subject = store();
      const [before] = await subject.listForLearner('learner_a');
      await subject.appendEntry({ learnerId: 'learner_a', readingId: before.id, on: '2026-08-05', page: 120, idempotencyKey: 'p2' });

      expect(read('learner_a').schema).toBe('school.book-log/v2');
      expect(fs.readFileSync(path.join(dir(), 'learner_a.v1.bak'), 'utf8')).toBe(LEGACY_FILE);
      const [after] = await subject.listForLearner('learner_a');
      expect(after.entries.map((entry) => entry.page)).toEqual([84, 120]);
    });
  });

  describe('damaged is loud', () => {
    it('names a corrupt shelf instead of pretending the learner has no books', async () => {
      write('learner_a', 'this: [is: not: valid');
      await expect(store().listForLearner('learner_a')).rejects.toBeInstanceOf(BookLogShelfUnreadableError);
    });

    it('refuses to replace a corrupt shelf and leaves its evidence byte-for-byte intact', async () => {
      const original = 'this: [is: not: valid';
      write('learner_a', original);

      await expect(store().openReading(opened())).rejects.toBeInstanceOf(BookLogShelfUnreadableError);
      expect(fs.readFileSync(fileFor('learner_a'), 'utf8')).toBe(original);
      expect(fs.readdirSync(dir())).toEqual(['learner_a.yml']);
    });

    it('treats valid YAML with the wrong root shape as damaged data', async () => {
      write('learner_a', 'learner: learner_a\n');
      await expect(store().listForLearner('learner_a')).rejects.toMatchObject({
        code: 'BOOK_LOG_SHELF_UNREADABLE', status: 'corrupt', learnerId: 'learner_a',
      });
    });

    it('treats a v2 file whose readings are not a list as damaged data', async () => {
      write('learner_a', 'schema: school.book-log/v2\nreadings: nope\n');
      await expect(store().listForLearner('learner_a')).rejects.toBeInstanceOf(BookLogShelfUnreadableError);
    });
  });
});
