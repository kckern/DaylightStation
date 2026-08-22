/**
 * YamlPrintDocumentRepository — flat-directory YAML store for print-ready
 * documents (v1 or v2 envelope), mirroring `YamlSurfaceProfileRepository`'s
 * directory-walk conventions. Raw content only: validation is
 * `RenderPrintDocument`'s job, not this repository's.
 */
import { describe, it, expect } from 'vitest';
import { YamlPrintDocumentRepository } from './YamlPrintDocumentRepository.mjs';

/** In-memory `io` fake — no filesystem needed to prove the directory-walk contract. */
function fakeIo(filesById) {
  const files = Object.keys(filesById).sort();
  return {
    list: () => files,
    load: (fullPath) => {
      const relative = fullPath.split('/').pop();
      return filesById[relative] ?? null;
    },
  };
}

/**
 * A full in-memory filesystem fake keyed by absolute basePath (no extension),
 * supporting `list`/`load`/`save`/`stat` per directory — enough to exercise
 * `getPublished`/`getDerivedBank`/`writePublished` without touching disk.
 * `mtimes` lets a test control which of several `<id>@rev` entries is "latest".
 */
function fakeStore({ mtimes = {} } = {}) {
  const store = new Map(); // basePath -> content
  let nextMtime = 1;
  return {
    store,
    io: {
      list: (dir, { recursive = false } = {}) => [...store.keys()]
        .filter((p) => p.startsWith(`${dir}/`))
        .map((p) => p.slice(dir.length + 1))
        .filter((relative) => recursive || !relative.includes('/')),
      load: (basePath) => (store.has(basePath) ? store.get(basePath) : null),
      save: (basePath, content) => { store.set(basePath, content); },
      stat: (basePath) => (store.has(basePath)
        ? { mtimeMs: mtimes[basePath] ?? (nextMtime += 1) }
        : null),
    },
  };
}

/**
 * Two-root `io` fake: `list`/`load` keyed by ABSOLUTE path, so a test can put
 * different files under the source root and the artifact root and prove which
 * one `list()` actually walks.
 */
function fakeRoots(byAbsolutePath) {
  return {
    list: (dir, { recursive } = {}) => {
      const prefix = `${dir}/`;
      return Object.keys(byAbsolutePath)
        .filter((p) => p.startsWith(prefix))
        .map((p) => p.slice(prefix.length))
        .filter((rel) => recursive || !rel.includes('/'));
    },
    load: (fullPath) => byAbsolutePath[fullPath] ?? null,
  };
}

const SOURCE = 'school.document-source/v1';
const PUBLISHED_V2 = 'school.document/v2';
const LEARNING = 'school.learning-document/v1';

describe('constructor', () => {
  it('requires a non-empty directory', () => {
    expect(() => new YamlPrintDocumentRepository({})).toThrow(/directory/);
    expect(() => new YamlPrintDocumentRepository({ directory: '' })).toThrow(/directory/);
  });

  it('rejects a present-but-empty sourceDirectory rather than silently ignoring it', () => {
    expect(() => new YamlPrintDocumentRepository({ directory: '/docs', sourceDirectory: '' }))
      .toThrow(/sourceDirectory/);
    expect(() => new YamlPrintDocumentRepository({ directory: '/docs', sourceDirectory: 42 }))
      .toThrow(/sourceDirectory/);
  });
});

describe('list() with a separate sourceDirectory (sources moved to the catalog shelf)', () => {
  /**
   * The guard this whole split exists for. `catalog/documents/` is SHARED with
   * the learning-document system, whose files carry `documentId`, not `id` —
   * under the old negative-space rule they would have been admitted with their
   * file PATH as a fabricated id. Deleting the schema filter fails this test.
   */
  it('IGNORES a co-resident school.learning-document/v1 instead of admitting it under a fake id', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/data/print-documents',
      sourceDirectory: '/data/catalog/documents',
      io: fakeRoots({
        '/data/catalog/documents/arts/pokemon-identification/quiz-1':
          { schema: SOURCE, id: 'arts/pokemon-identification/quiz-1', seed: 1, target: ['letter'], blocks: [] },
        '/data/catalog/documents/starter-math-ten-percent':
          { schema: LEARNING, documentId: 'starter-math-ten-percent', title: 'Ten Percent', blocks: [] },
        '/data/catalog/documents/starter-science-water-cycle':
          { schema: LEARNING, documentId: 'starter-science-water-cycle', title: 'Water Cycle', blocks: [] },
      }),
    });

    expect(repo.list().map((entry) => entry.id)).toEqual(['arts/pokemon-identification/quiz-1']);
    // Neither by its own `documentId` nor by the file-path id the old
    // filename fallback would have fabricated for it.
    expect(repo.get('starter-math-ten-percent')).toBeNull();
    expect(repo.get('starter-science-water-cycle')).toBeNull();
  });

  it('walks the SOURCE root, not the artifact root', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/data/print-documents',
      sourceDirectory: '/data/catalog/documents',
      io: fakeRoots({
        '/data/catalog/documents/quiz-1': { schema: SOURCE, id: 'quiz-1', blocks: [] },
        // Would have been listed under the legacy single-root rule; must not be now.
        '/data/print-documents/stray-legacy-source': { id: 'stray-legacy-source', blocks: [] },
        '/data/print-documents/published/quiz-1@abc': { schema: PUBLISHED_V2, id: 'quiz-1', rev: 'abc' },
      }),
    });

    expect(repo.list().map((entry) => entry.id)).toEqual(['quiz-1']);
  });

  it('admits a hand-authored school.document/v2 class (a legal authored envelope, not only publish output)', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/data/print-documents',
      sourceDirectory: '/data/catalog/documents',
      io: fakeRoots({
        '/data/catalog/documents/authored-v2': { schema: PUBLISHED_V2, id: 'authored-v2', blocks: [] },
      }),
    });

    expect(repo.get('authored-v2')).toEqual({ schema: PUBLISHED_V2, id: 'authored-v2', blocks: [] });
  });

  it('still excludes the artifact subtrees when the source root IS the artifact root', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/docs',
      sourceDirectory: '/docs',
      io: fakeRoots({
        '/docs/quiz-1': { schema: SOURCE, id: 'quiz-1', blocks: [] },
        '/docs/published/quiz-1@abc': { schema: PUBLISHED_V2, id: 'quiz-1', rev: 'abc' },
        '/docs/derived-banks/quiz-1@abc': { id: 'derived/quiz-1@abc', items: [] },
        '/docs/allocations/3302880': [{ cardId: '3302880' }],
      }),
    });

    expect(repo.list().map((entry) => entry.id)).toEqual(['quiz-1']);
  });

  it('keeps the filename fallback for a source-schema file with no `id` (authoring diagnostic)', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/data/print-documents',
      sourceDirectory: '/data/catalog/documents',
      io: fakeRoots({ '/data/catalog/documents/half-written': { schema: SOURCE, blocks: [] } }),
    });

    expect(repo.list()).toEqual([
      { id: 'half-written', file: 'half-written', document: { schema: SOURCE, blocks: [] } },
    ]);
  });

  it('drops an unparsable file (load returns null) rather than fabricating an id for it', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/data/print-documents',
      sourceDirectory: '/data/catalog/documents',
      io: fakeRoots({ '/data/catalog/documents/broken-yaml': null }),
    });

    expect(repo.list()).toEqual([]);
  });
});

describe('list() legacy single-root fallback (backward compatibility)', () => {
  /**
   * An unconfigured/legacy construction — `directory` only, no
   * `sourceDirectory` — must keep finding its documents, including SCHEMA-LESS
   * legacy v1 ones that the positive schema filter would reject. A deployment
   * that has not been reconfigured must not silently discover zero documents.
   */
  it('finds schema-less legacy v1 sources at the artifact root, with no schema filter', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/docs',
      io: fakeRoots({
        '/docs/legacy-v1': { id: 'legacy-v1', seed: 1, target: ['letter'], blocks: [] },
        '/docs/arts/pokemon-identification/quiz-1': { schema: SOURCE, id: 'arts/pokemon-identification/quiz-1', blocks: [] },
        '/docs/published/legacy-v1@abc': { schema: PUBLISHED_V2, id: 'legacy-v1', rev: 'abc' },
      }),
    });

    expect(repo.list().map((entry) => entry.id))
      .toEqual(['arts/pokemon-identification/quiz-1', 'legacy-v1']);
    expect(repo.get('legacy-v1')).toEqual({ id: 'legacy-v1', seed: 1, target: ['letter'], blocks: [] });
  });
});

describe('list()', () => {
  it('returns one entry per file, id resolved from the document’s own `id` field', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/docs',
      io: fakeIo({
        'algebra-1-set-a': { id: 'algebra-1-set-a', seed: 1, target: ['letter'], blocks: [] },
        'states-quiz-3': { id: 'states-quiz-3', seed: 2, target: ['letter'], blocks: [] },
      }),
    });
    expect(repo.list()).toEqual([
      { id: 'algebra-1-set-a', file: 'algebra-1-set-a', document: { id: 'algebra-1-set-a', seed: 1, target: ['letter'], blocks: [] } },
      { id: 'states-quiz-3', file: 'states-quiz-3', document: { id: 'states-quiz-3', seed: 2, target: ['letter'], blocks: [] } },
    ]);
  });

  it('falls back to the filename when the parsed content has no `id` field', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/docs',
      io: fakeIo({ 'malformed-doc': { seed: 1 } }),
    });
    expect(repo.list()).toEqual([{ id: 'malformed-doc', file: 'malformed-doc', document: { seed: 1 } }]);
  });

  it('falls back to the filename when the file failed to parse (load returns null)', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/docs',
      io: fakeIo({ 'broken-yaml': null }),
    });
    expect(repo.list()).toEqual([{ id: 'broken-yaml', file: 'broken-yaml', document: null }]);
  });

  it('returns an empty array for an empty directory', () => {
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io: fakeIo({}) });
    expect(repo.list()).toEqual([]);
  });

  it('walks nested hierarchical-id sources but never the artifact subtrees', () => {
    const byRelative = {
      'arts/pokemon-identification/quiz-1':
        { id: 'arts/pokemon-identification/quiz-1', seed: 1, target: ['letter'], blocks: [] },
      'flat-doc': { id: 'flat-doc', seed: 2, target: ['letter'], blocks: [] },
      'published/arts/pokemon-identification/quiz-1@632002966': { id: 'arts/pokemon-identification/quiz-1' },
      'derived-banks/flat-doc@abcdef123': { id: 'flat-doc' },
      'allocations/3302880': [{ cardId: '3302880' }],
    };
    const repo = new YamlPrintDocumentRepository({
      directory: '/docs',
      io: {
        list: (dir, { recursive } = {}) => (recursive ? Object.keys(byRelative) : []),
        load: (fullPath) => byRelative[fullPath.slice('/docs/'.length)] ?? null,
      },
    });
    expect(repo.list().map((entry) => entry.id))
      .toEqual(['arts/pokemon-identification/quiz-1', 'flat-doc']);
    expect(repo.get('arts/pokemon-identification/quiz-1'))
      .toEqual(byRelative['arts/pokemon-identification/quiz-1']);
  });
});

describe('get(id)', () => {
  it('returns the raw parsed document whose `id` field matches', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/docs',
      io: fakeIo({
        'algebra-1-set-a': { id: 'algebra-1-set-a', seed: 1, target: ['letter'], blocks: [] },
      }),
    });
    expect(repo.get('algebra-1-set-a')).toEqual({ id: 'algebra-1-set-a', seed: 1, target: ['letter'], blocks: [] });
  });

  it('returns null when no document matches', () => {
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io: fakeIo({}) });
    expect(repo.get('nope')).toBeNull();
  });

  it('resolves an id-less document by its filename fallback', () => {
    const repo = new YamlPrintDocumentRepository({
      directory: '/docs',
      io: fakeIo({ 'malformed-doc': { seed: 1 } }),
    });
    expect(repo.get('malformed-doc')).toEqual({ seed: 1 });
  });
});

describe('writePublished / getPublished / getDerivedBank (Task 5, spec §3/§4.3)', () => {
  const document = { id: 'states-quiz-3', schema: 'school.document/v2', rev: 'abc123', blocks: [] };
  const bank = { id: 'derived/states-quiz-3@abc123', title: 'States Quiz', items: [{ id: 'q1' }] };

  it('writes the published document and derived bank under sibling directories', () => {
    const { io, store } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    const result = repo.writePublished({ document, bank, rev: 'abc123' });

    expect(result).toEqual({
      document: { written: true, alreadyPublished: false },
      bank: { written: true, alreadyPublished: false },
    });
    expect(store.get('/docs/documents/states-quiz-3/abc123/document')).toEqual(document);
    expect(store.get('/docs/documents/states-quiz-3/abc123/answers')).toEqual(bank);
  });

  it('writes only the published document when bank is null (no answer-bearing content)', () => {
    const { io, store } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    const result = repo.writePublished({ document, bank: null, rev: 'abc123' });

    expect(result.bank).toBeNull();
    expect(store.has('/docs/documents/states-quiz-3/abc123/answers')).toBe(false);
  });

  it('re-publishing IDENTICAL content at the same rev is an idempotent no-op', () => {
    const { io, store } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    repo.writePublished({ document, bank, rev: 'abc123' });
    const before = store.get('/docs/documents/states-quiz-3/abc123/document');

    const second = repo.writePublished({ document: { ...document }, bank: { ...bank }, rev: 'abc123' });
    expect(second).toEqual({
      document: { written: false, alreadyPublished: true },
      bank: { written: false, alreadyPublished: true },
    });
    expect(store.get('/docs/documents/states-quiz-3/abc123/document')).toBe(before); // untouched, not re-saved
  });

  it('refuses to overwrite an existing rev with DIFFERENT content (append-only)', () => {
    const { io } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    repo.writePublished({ document, bank, rev: 'abc123' });

    expect(() => repo.writePublished({
      document: { ...document, title: 'a different title snuck in' }, bank, rev: 'abc123',
    })).toThrow(/append-only/);
  });

  it('requires document.id and rev', () => {
    const { io } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    expect(() => repo.writePublished({ document: {}, bank: null, rev: 'abc123' })).toThrow(/document\.id/);
    expect(() => repo.writePublished({ document, bank: null, rev: '' })).toThrow(/rev/);
  });

  it('getPublished(id, rev) returns the exact revision', () => {
    const { io } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    repo.writePublished({ document, bank, rev: 'abc123' });
    expect(repo.getPublished('states-quiz-3', 'abc123')).toEqual(document);
  });

  it('getPublished(id, rev) returns null for an unknown revision', () => {
    const { io } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    repo.writePublished({ document, bank, rev: 'abc123' });
    expect(repo.getPublished('states-quiz-3', 'nope')).toBeNull();
  });

  it('getPublished(id) with no rev picks the LATEST (most recently written) revision', () => {
    const { io } = fakeStore({
      mtimes: {
        '/docs/documents/states-quiz-3/rev1/document': 100,
        '/docs/documents/states-quiz-3/rev2/document': 200,
      },
    });
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    repo.writePublished({ document: { ...document, rev: 'rev1' }, bank: null, rev: 'rev1' });
    repo.writePublished({ document: { ...document, rev: 'rev2' }, bank: null, rev: 'rev2' });
    expect(repo.getPublished('states-quiz-3').rev).toBe('rev2');
  });

  it('getPublished(id) with no rev and no published revisions returns null', () => {
    const { io } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    expect(repo.getPublished('nope')).toBeNull();
  });

  it('getDerivedBank(id, rev) returns the bank for that exact revision', () => {
    const { io } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    repo.writePublished({ document, bank, rev: 'abc123' });
    expect(repo.getDerivedBank('states-quiz-3', 'abc123')).toEqual(bank);
  });

  it('getDerivedBank(id, rev) returns null when that revision minted no bank', () => {
    const { io } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    repo.writePublished({ document, bank: null, rev: 'abc123' });
    expect(repo.getDerivedBank('states-quiz-3', 'abc123')).toBeNull();
  });

  it('getDerivedBank requires an explicit rev — no "latest" default', () => {
    const { io } = fakeStore();
    const repo = new YamlPrintDocumentRepository({ directory: '/docs', io });
    expect(() => repo.getDerivedBank('states-quiz-3')).toThrow(/rev/);
  });

  // Regression (Task 6, found via the `school:docs publish` CLI's real
  // filesystem round-trip): `saveYaml`'s `js-yaml.dump` OMITS any key whose
  // value is `undefined` — so a freshly-computed in-memory object that
  // carries an optional field EXPLICITLY set to `undefined` (e.g.
  // `questionBankValidation.mjs`'s `unit`/`readalong`) round-trips through a
  // real save+load cycle WITHOUT that key at all. Comparing the two with
  // `fakeStore`'s in-memory `io` (no serialization step) can never exercise
  // this — it needs the REAL default `io` (`saveYaml`/`loadYaml`) against an
  // actual file.
  it('re-publishing identical content whose object carries explicit `undefined`-valued keys is still an idempotent no-op (real YAML round-trip)', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-print-doc-repo-'));
    try {
      const repo = new YamlPrintDocumentRepository({ directory });
      const bankWithUndefinedKeys = {
        id: 'derived/states-quiz-3@abc123', title: 'States Quiz', items: [{ id: 'q1' }], unit: undefined, readalong: undefined,
      };
      const first = repo.writePublished({ document, bank: bankWithUndefinedKeys, rev: 'abc123' });
      expect(first.bank).toEqual({ written: true, alreadyPublished: false });

      // A SECOND call with a freshly-built object (same undefined-valued
      // keys, new object identity) must recognise it as identical content —
      // not throw "refusing to overwrite ... different content".
      const second = repo.writePublished({
        document: { ...document }, bank: { ...bankWithUndefinedKeys }, rev: 'abc123',
      });
      expect(second.bank).toEqual({ written: false, alreadyPublished: true });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
