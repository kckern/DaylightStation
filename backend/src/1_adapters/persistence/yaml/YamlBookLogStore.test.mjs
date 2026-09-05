import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BookLogShelfUnreadableError, YamlBookLogStore } from './YamlBookLogStore.mjs';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

let root;
const configService = { getHouseholdPath: (suffix) => path.join(root, suffix) };
const store = () => new YamlBookLogStore({ configService, logger: silentLogger });

const opened = (overrides = {}) => ({
  learnerId: 'kid', bookId: '9780064400558', progressMode: 'page', pageCount: 184,
  openedAt: '2026-08-01T10:00:00.000Z', entryId: 'e1', ...overrides,
});

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'booklog-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('YamlBookLogStore', () => {
  it('requires a configService, because a default path would write somewhere wrong', () => {
    expect(() => new YamlBookLogStore({ logger: silentLogger })).toThrow(/configService/);
  });

  it('opens a shelf item and reads it back', async () => {
    const subject = store();
    const item = await subject.openItem(opened());

    const items = await subject.listForLearner('kid');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      itemId: item.itemId, bookId: '9780064400558', progressMode: 'page', pageCount: 184,
    });
    expect(items[0].events).toEqual([expect.objectContaining({ kind: 'started' })]);
  });

  it('writes under records/, per learner', async () => {
    await store().openItem(opened());
    const file = path.join(root, 'school/records/books', 'kid.yml');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('is idempotent on entryId — a retried open is not a second copy', async () => {
    const subject = store();
    const first = await subject.openItem(opened());
    const again = await subject.openItem(opened());
    expect(again.itemId).toBe(first.itemId);
    expect(await subject.listForLearner('kid')).toHaveLength(1);
  });

  it('opens a NEW item for a re-read after finishing — two reads are two reads', async () => {
    const subject = store();
    const first = await subject.openItem(opened());
    await subject.appendEvent({ itemId: first.itemId, kind: 'finished', at: '2026-08-09T10:00:00.000Z', entryId: 'f1' });

    const second = await subject.openItem(opened({ entryId: 'e2', openedAt: '2026-09-01T10:00:00.000Z' }));

    expect(second.itemId).not.toBe(first.itemId);
    expect(await subject.listForLearner('kid')).toHaveLength(2);
  });

  it('appends progress events in order', async () => {
    const subject = store();
    const item = await subject.openItem(opened());
    await subject.appendEvent({ itemId: item.itemId, kind: 'progress', at: '2026-08-03T10:00:00.000Z', page: 40, entryId: 'p1' });
    await subject.appendEvent({ itemId: item.itemId, kind: 'progress', at: '2026-08-04T10:00:00.000Z', page: 84, entryId: 'p2' });

    const [stored] = await subject.listForLearner('kid');
    expect(stored.events.map((e) => e.page)).toEqual([undefined, 40, 84]);
  });

  it('is idempotent on a repeated finish — a duplicate is a duplicate BOOK', async () => {
    const subject = store();
    const item = await subject.openItem(opened());
    const event = { itemId: item.itemId, kind: 'finished', at: '2026-08-09T10:00:00.000Z', entryId: 'f1' };
    await subject.appendEvent(event);
    await subject.appendEvent(event);

    const [stored] = await subject.listForLearner('kid');
    expect(stored.events.filter((e) => e.kind === 'finished')).toHaveLength(1);
  });

  it('carries source and externalId, so an Audiobookshelf session dedupes', async () => {
    const subject = store();
    const item = await subject.openItem(opened({ progressMode: 'minutes' }));
    await subject.appendEvent({
      itemId: item.itemId, kind: 'progress', at: '2026-08-03T10:00:00.000Z',
      minutes: 25, source: 'abs', externalId: 'session-77', entryId: 'a1',
    });
    const [stored] = await subject.listForLearner('kid');
    expect(stored.events.at(-1)).toMatchObject({ source: 'abs', externalId: 'session-77' });
  });

  it('refuses an event for an item that does not exist', async () => {
    await expect(store().appendEvent({ itemId: 'nope', kind: 'progress', at: '2026-08-03T10:00:00.000Z', entryId: 'x' }))
      .rejects.toThrow(/itemId/);
  });

  it('refuses an unsafe learner id rather than writing outside the tree', async () => {
    await expect(store().openItem(opened({ learnerId: '../escape' }))).rejects.toThrow(/learnerId/);
  });

  it('answers an empty shelf for a learner with no file — never throws on read', async () => {
    expect(await store().listForLearner('nobody')).toEqual([]);
  });

  it('names a corrupt shelf instead of pretending the learner has no books', async () => {
    const dir = path.join(root, 'school/records/books');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'kid.yml'), 'this: [is: not: valid');
    await expect(store().listForLearner('kid')).rejects.toBeInstanceOf(BookLogShelfUnreadableError);
  });

  it('refuses to replace a corrupt shelf and leaves its evidence byte-for-byte intact', async () => {
    const dir = path.join(root, 'school/records/books');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'kid.yml');
    const original = 'this: [is: not: valid';
    fs.writeFileSync(file, original);

    await expect(store().openItem(opened())).rejects.toBeInstanceOf(BookLogShelfUnreadableError);
    expect(fs.readFileSync(file, 'utf8')).toBe(original);
    expect(fs.readdirSync(dir)).toEqual(['kid.yml']);
  });

  it('treats valid YAML with the wrong root shape as damaged data', async () => {
    const dir = path.join(root, 'school/records/books');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'kid.yml'), 'learner: kid\n');
    await expect(store().listForLearner('kid')).rejects.toMatchObject({
      code: 'BOOK_LOG_SHELF_UNREADABLE', status: 'corrupt', learnerId: 'kid',
    });
  });
  it('gives two opens of the same book on the same day different itemIds', async () => {
    const subject = store();
    const a = await subject.openItem(opened({ entryId: 'e1', openedAt: '2026-08-25T10:00:00.000Z' }));
    await subject.appendEvent({ itemId: a.itemId, kind: 'finished', at: '2026-08-25T11:00:00.000Z', entryId: 'f1' });
    const b = await subject.openItem(opened({ entryId: 'e2', openedAt: '2026-08-25T10:00:00.000Z' }));
    expect(b.itemId).not.toBe(a.itemId);
    const items = await subject.listForLearner('kid');
    expect(items.map((i) => i.events.map((e) => e.kind))).toEqual([['started', 'finished'], ['started']]);
  });

  it('itemId is derived from the started entryId, so it never depends on openedAt', async () => {
    const item = await store().openItem(opened({ entryId: 'e-abc' }));
    expect(item.itemId).toBe('kid:9780064400558:e-abc');
  });

  it('switches progressMode without touching a single event', async () => {
    const subject = store();
    const item = await subject.openItem(opened());
    await subject.appendEvent({ itemId: item.itemId, kind: 'progress', at: '2026-08-03T10:00:00.000Z', page: 40, entryId: 'p1' });
    const updated = await subject.setProgressMode({ itemId: item.itemId, progressMode: 'check' });
    expect(updated.progressMode).toBe('check');
    const [stored] = await subject.listForLearner('kid');
    expect(stored.progressMode).toBe('check');
    expect(stored.events.map((e) => e.page)).toEqual([undefined, 40]);
  });

  it('refuses an unknown progressMode', async () => {
    const subject = store();
    const item = await subject.openItem(opened());
    await expect(subject.setProgressMode({ itemId: item.itemId, progressMode: 'chapters' })).rejects.toThrow(/progressMode/);
  });

  it('refuses to reuse an entryId for a different book, but still dedupes the same book', async () => {
    const subject = store();
    const first = await subject.openItem(opened({ bookId: '9780064400558', entryId: 'e-shared' }));
    await expect(subject.openItem(opened({ bookId: '9780027746723', entryId: 'e-shared' }))).rejects.toThrow(/different book/);
    const again = await subject.openItem(opened({ bookId: '9780064400558', entryId: 'e-shared' }));
    expect(again.itemId).toBe(first.itemId);
  });
});
