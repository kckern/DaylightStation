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

describe('constructor', () => {
  it('requires a non-empty directory', () => {
    expect(() => new YamlPrintDocumentRepository({})).toThrow(/directory/);
    expect(() => new YamlPrintDocumentRepository({ directory: '' })).toThrow(/directory/);
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
