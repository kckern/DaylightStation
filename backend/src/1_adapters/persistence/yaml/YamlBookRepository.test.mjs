import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createBookRecord } from '#domains/books/BookRecord.mjs';
import { YamlBookRepository } from './YamlBookRepository.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
let root;
const configService = { getHouseholdPath: (suffix) => path.join(root, suffix) };
const repo = () => new YamlBookRepository({ configService, logger: silent });

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bookrepo-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('YamlBookRepository', () => {
  it('requires a configService, because a default path would write somewhere wrong', () => {
    expect(() => new YamlBookRepository({ logger: silent })).toThrow(/configService/);
  });

  it('saves a record under household/books/<isbn13>.yml and finds it again, frozen and complete', async () => {
    const r = new YamlBookRepository({
      configService, logger: silent, clock: () => new Date('2026-09-03T12:00:00.000Z'),
    });
    const saved = await r.save(createBookRecord({
      source: 'openlibrary', isbn13: '9780064400558', title: "Charlotte's Web", pageCount: 184,
      authors: ['E. B. White'], people: ['Wilbur', 'Charlotte'],
    }));
    expect(saved.isbn13).toBe('9780064400558');
    expect(fs.existsSync(path.join(root, 'books', '9780064400558.yml'))).toBe(true);

    const found = await r.findByIsbn('9780064400558');
    expect(found).toMatchObject({ title: "Charlotte's Web", pageCount: 184, authors: ['E. B. White'], people: ['Wilbur', 'Charlotte'], sources: ['openlibrary'] });
    expect(Object.isFrozen(found)).toBe(true);
    // Every field of the model is present after a round trip, not just the ones written.
    expect(found).toHaveProperty('series');
    expect(found.series).toBeNull();
    expect(await r.findByIsbnEntry('9780064400558')).toMatchObject({
      book: { title: "Charlotte's Web" }, cachedAt: '2026-09-03T12:00:00.000Z',
    });
  });

  it('returns null for a book it has never seen', async () => {
    expect(await repo().findByIsbn('9780000000000')).toBeNull();
  });

  it('returns null, not a throw, for a corrupt file — and says so in the log', async () => {
    const warned = [];
    const r = new YamlBookRepository({ configService, logger: { ...silent, warn: (...a) => warned.push(a) } });
    fs.mkdirSync(path.join(root, 'books'), { recursive: true });
    fs.writeFileSync(path.join(root, 'books', '9780064400558.yml'), 'this: [is: bad');
    expect(await r.findByIsbn('9780064400558')).toBeNull();
    expect(warned[0]?.[0]).toBe('books.repository.corrupt');
  });

  it('overwrites on save — a refresh replaces the record, it does not merge', async () => {
    const r = repo();
    await r.save(createBookRecord({ source: 'openlibrary', isbn13: '9780064400558', title: 'old', description: 'kept?' }));
    await r.save(createBookRecord({ source: 'openlibrary', isbn13: '9780064400558', title: 'new' }));
    const found = await r.findByIsbn('9780064400558');
    expect(found.title).toBe('new');
    expect(found.description).toBeNull();
  });

  it('refuses an isbn that is not thirteen digits as a filename', async () => {
    await expect(repo().save(createBookRecord({ source: 'x', isbn13: '../escape' }))).rejects.toThrow(/isbn/i);
    await expect(repo().save(createBookRecord({ source: 'x', isbn13: null }))).rejects.toThrow(/isbn/i);
    expect(await repo().findByIsbn('../escape')).toBeNull();
  });
});
