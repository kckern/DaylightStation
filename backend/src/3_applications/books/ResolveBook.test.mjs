import { describe, expect, it } from 'vitest';
import { createBookRecord } from '#domains/books/BookRecord.mjs';
import { ResolveBook } from './ResolveBook.mjs';

const silentLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const gateway = (id, impl) => ({ id, byIsbn: impl });

const okGateway = (id, fields) => gateway(id, async (isbn13) => createBookRecord({ source: id, isbn13, ...fields }));
const missGateway = (id) => gateway(id, async () => null);
const brokenGateway = (id, message = 'boom') => gateway(id, async () => { throw new Error(message); });

const makeRepo = () => ({
  saved: [], store: new Map(),
  async findByIsbn(isbn13) { return this.store.get(isbn13) ?? null; },
  async save(record) { this.saved.push(record); this.store.set(record.isbn13, record); return record; },
});

const resolverWith = (gateways, extra = {}) => new ResolveBook({
  gateways, repository: makeRepo(), logger: silentLogger, ...extra,
});

describe('ResolveBook', () => {
  it('rejects a malformed identifier without calling any provider', async () => {
    let called = false;
    const resolver = resolverWith([gateway('openlibrary', async () => { called = true; return null; })]);

    const result = await resolver.execute('nonsense');

    expect(result.status).toBe('invalid');
    expect(result.reason).toBe('not-an-identifier');
    expect(called).toBe(false);
  });

  it('names a wrong check digit distinctly from an unrecognised string', async () => {
    const result = await resolverWith([]).execute('9780064400557');
    expect(result).toMatchObject({ status: 'invalid', reason: 'isbn13-checksum' });
  });

  it('merges every provider that answered, by field policy not call order', async () => {
    const resolver = resolverWith([
      okGateway('googlebooks', { title: 'Bundle Edition', pageCount: 196, description: 'A real blurb.' }),
      okGateway('openlibrary', { title: 'Charlotte’s Web', pageCount: 184 }),
    ]);

    const { status, book } = await resolver.execute('9780064400558');

    expect(status).toBe('ok');
    expect(book.title).toBe('Charlotte’s Web');
    expect(book.pageCount).toBe(184);
    expect(book.description).toBe('A real blurb.');
    expect(book.sources).toEqual(expect.arrayContaining(['openlibrary', 'googlebooks']));
  });

  it('a provider that timed out is a failure in the same shape as any other break — never a throw (review M3)', async () => {
    const slow = gateway('openlibrary', () => new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('The operation was aborted')), 5);
    }));
    const result = await resolverWith([slow, missGateway('googlebooks')]).execute('9780064400558');
    expect(result).toEqual({
      status: 'unavailable',
      failures: [{ source: 'openlibrary', error: 'The operation was aborted' }],
    });
  });

  it('converts an ISBN-10 and resolves the canonical 13', async () => {
    const resolver = resolverWith([okGateway('openlibrary', { title: 'Charlotte’s Web' })]);
    const { book } = await resolver.execute('0064400557');
    expect(book.isbn13).toBe('9780064400558');
  });

  it('returns a partial record as a SUCCESS — a book with no cover is still a book', async () => {
    const resolver = resolverWith([
      okGateway('openlibrary', { title: 'Obscure Thing' }),
      missGateway('googlebooks'),
    ]);
    const { status, book } = await resolver.execute('9780064400558');
    expect(status).toBe('ok');
    expect(book.title).toBe('Obscure Thing');
    expect(book.description).toBeNull();
  });

  it('survives a provider that throws, as long as another answered', async () => {
    const resolver = resolverWith([
      brokenGateway('googlebooks', '429 quota'),
      okGateway('openlibrary', { title: 'Still Here' }),
    ]);
    const { status, book, failures } = await resolver.execute('9780064400558');
    expect(status).toBe('ok');
    expect(book.title).toBe('Still Here');
    expect(failures).toEqual([{ source: 'googlebooks', error: '429 quota' }]);
  });

  it('distinguishes "nobody has this book" from "everything was broken"', async () => {
    const allMissed = await resolverWith([missGateway('openlibrary')]).execute('9780064400558');
    expect(allMissed.status).toBe('not-found');

    const allBroke = await resolverWith([brokenGateway('openlibrary')]).execute('9780064400558');
    expect(allBroke.status).toBe('unavailable');
  });

  it('caches a resolved book and serves the next lookup from the repository', async () => {
    let calls = 0;
    const repository = makeRepo();
    const resolver = new ResolveBook({
      repository, logger: silentLogger,
      gateways: [gateway('openlibrary', async (isbn13) => {
        calls += 1; return createBookRecord({ source: 'openlibrary', isbn13, title: 'Cached' });
      })],
    });

    await resolver.execute('9780064400558');
    const second = await resolver.execute('9780064400558');

    expect(calls).toBe(1);
    expect(second.book.title).toBe('Cached');
    expect(second.fromCache).toBe(true);
  });

  it('refetches when asked to, so a thin record can be repaired', async () => {
    let calls = 0;
    const resolver = new ResolveBook({
      repository: makeRepo(), logger: silentLogger,
      gateways: [gateway('openlibrary', async (isbn13) => {
        calls += 1; return createBookRecord({ source: 'openlibrary', isbn13, title: `call ${calls}` });
      })],
    });
    await resolver.execute('9780064400558');
    const again = await resolver.execute('9780064400558', { refresh: true });
    expect(calls).toBe(2);
    expect(again.book.title).toBe('call 2');
  });

  it('resolves a library record id through the library gateway, then by ISBN', async () => {
    const libraryCatalog = { async byRecordId(recordId) {
      expect(recordId).toBe('S82C1482387');
      return { isbn13: '9780385372060' };
    } };
    const resolver = resolverWith(
      [okGateway('openlibrary', { title: "Dr. Seuss's ABC" })],
      { libraryCatalog },
    );

    const { status, book } = await resolver.execute('https://kcls.bibliocommons.com/v2/record/S82C1482387');

    expect(status).toBe('ok');
    expect(book.isbn13).toBe('9780385372060');
    expect(book.libraryRecordId).toBe('S82C1482387');
  });

  it('tells a child to flip the book over when the library cannot place a sticker', async () => {
    const resolver = resolverWith([], { libraryCatalog: { async byRecordId() { return null; } } });
    const result = await resolver.execute('S82C1482387');
    expect(result).toMatchObject({ status: 'not-found', reason: 'library-record-unresolved' });
  });

  it('treats a bare 14-digit sticker as an identifier we cannot use, not as a book', async () => {
    const result = await resolverWith([]).execute('00100123456789');
    expect(result).toMatchObject({ status: 'invalid', reason: 'not-an-identifier' });
  });
});
