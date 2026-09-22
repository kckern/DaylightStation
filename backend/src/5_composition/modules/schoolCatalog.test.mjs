import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dump } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { createSchoolCatalog } from './schoolCatalog.mjs';

describe('shared School Catalog composition', () => {
  it('wires a surface-neutral Catalog even when SchoolCalc is absent', async () => {
    const configService = {
      getHouseholdAppConfig: () => ({ catalog: { content: { root: 'mounted/learning' } } }),
      getDataDir: () => '/data',
      getHouseholdPath: (relative) => path.resolve('/data/household', relative),
    };
    const catalog = createSchoolCatalog({ configService });
    expect(catalog).toMatchObject({ wired: true, query: expect.any(Object) });
    expect(catalog.diagnostics.contentRoot).toBe(path.resolve('/data/mounted/learning'));
    await expect(catalog.query.list()).resolves.toEqual({ schema: 'school.catalog-index/v1', catalogs: [] });
  });

  it('may be explicitly disabled without constructing a device product', () => {
    const catalog = createSchoolCatalog({
      configService: {
        getHouseholdAppConfig: () => ({ catalog: { enabled: false } }),
        getDataDir: () => '/data',
        getHouseholdPath: (relative) => path.resolve('/data/household', relative),
      },
    });
    expect(catalog).toMatchObject({ wired: false, query: null });
  });

  it('expands lexicon decks through the catalog content when a media dir is configured', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'school-catalog-lexicon-'));
    try {
      await mkdir(path.join(root, 'data/content/school/learning-catalog/flashcard-decks'), { recursive: true });
      await mkdir(path.join(root, 'media/school/language/korean-vocab'), { recursive: true });
      await writeFile(path.join(root, 'media/school/language/korean-vocab/lexicon.yml'), dump({ schema: 'school.word-lexicon/v2', package: 'korean-vocab', language: { code: 'ko', name: 'Korean' }, gloss: { code: 'en', name: 'English' }, program: { title: 'Korean words' }, entries: [{ id: 'gawi', kind: 'word', group: 'w', term: '가위', gloss: 'Scissors', pronunciation: null, decoys: { term: ['가지', '바위', '가방'], gloss: ['Knife', 'Tape', 'Ruler'] } }] }));
      await writeFile(path.join(root, 'data/content/school/learning-catalog/flashcard-decks/w.yml'), dump({ schema: 'school.flashcard-deck/v1', id: 'language/korean/w', title: 'W', lexicon: 'media:language/korean-vocab/lexicon.yml', words: ['gawi'] }));
      const catalog = createSchoolCatalog({ configService: {
        getHouseholdAppConfig: () => ({ catalog: {} }), getDataDir: () => path.join(root, 'data'), getMediaDir: () => path.join(root, 'media'),
        getHouseholdPath: (relative) => path.join(root, 'data/household', relative),
      } });
      const deck = await catalog.content.getFlashcardDeck('language/korean/w');
      expect(deck.cards[0].cardId).toBe('gawi');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
