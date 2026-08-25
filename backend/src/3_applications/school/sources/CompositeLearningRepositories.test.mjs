import { describe, it, expect } from 'vitest';
import {
  CompositeLearningCatalogRepository,
  CompositeLearningContentRepository,
} from './CompositeLearningRepositories.mjs';

function catalogSource(catalogs) {
  return {
    async listCatalogs() { return catalogs.map(({ catalogId, title }) => ({ catalogId, title })); },
    async getCatalog(id) { return catalogs.find((c) => c.catalogId === id) ?? null; },
  };
}

const throwingCatalogSource = {
  async listCatalogs() { throw new Error('mount unreadable'); },
  async getCatalog() { throw new Error('mount unreadable'); },
};

function recordingLogger() {
  const events = [];
  return { events, error: (event, data) => events.push({ event, data }), warn() {}, info() {} };
}

describe('CompositeLearningCatalogRepository', () => {
  const authored = catalogSource([{ catalogId: 'math', title: 'Math' }]);
  const generated = catalogSource([{ catalogId: 'anatomy', title: 'Anatomy' }]);

  it('lists every source in order', async () => {
    const repo = new CompositeLearningCatalogRepository({ sources: [authored, generated] });
    expect(await repo.listCatalogs()).toEqual([
      { catalogId: 'math', title: 'Math' },
      { catalogId: 'anatomy', title: 'Anatomy' },
    ]);
  });

  it('resolves a catalog from whichever source has it', async () => {
    const repo = new CompositeLearningCatalogRepository({ sources: [authored, generated] });
    expect((await repo.getCatalog('anatomy')).title).toBe('Anatomy');
    expect((await repo.getCatalog('math')).title).toBe('Math');
    expect(await repo.getCatalog('missing')).toBeNull();
  });

  it('lets the FIRST source win a duplicate id, so listing and resolution agree', async () => {
    const override = catalogSource([{ catalogId: 'anatomy', title: 'Hand-authored Anatomy' }]);
    const repo = new CompositeLearningCatalogRepository({ sources: [override, generated] });
    const listed = await repo.listCatalogs();
    expect(listed).toEqual([{ catalogId: 'anatomy', title: 'Hand-authored Anatomy' }]);
    expect((await repo.getCatalog('anatomy')).title).toBe('Hand-authored Anatomy');
  });

  it('skips a throwing source instead of blanking the others', async () => {
    const logger = recordingLogger();
    const repo = new CompositeLearningCatalogRepository({ sources: [throwingCatalogSource, generated], logger });
    expect(await repo.listCatalogs()).toEqual([{ catalogId: 'anatomy', title: 'Anatomy' }]);
    expect((await repo.getCatalog('anatomy')).title).toBe('Anatomy');
    expect(logger.events.map((e) => e.data.op)).toEqual(['listCatalogs', 'getCatalog']);
  });

  it('rejects an empty or malformed source list', () => {
    expect(() => new CompositeLearningCatalogRepository({ sources: [] })).toThrow(/at least one source/);
    expect(() => new CompositeLearningCatalogRepository({ sources: [{}] })).toThrow(/must implement/);
  });
});

describe('CompositeLearningContentRepository', () => {
  const authored = {
    async getDocument(id) { return id === 'authored-doc' ? { documentId: id, from: 'yaml' } : null; },
    async getQuestionBank(id) { return id === 'bank-1' ? { id, from: 'yaml' } : null; },
    async getLearningAction() { return null; },
  };
  const generated = {
    async getDocument(id) { return id === 'anatomy:biceps' ? { documentId: id, from: 'corpus' } : null; },
    async getQuestionBank() { return null; },
    async getLearningAction() { return null; },
  };

  it('falls through to the next source on a miss', async () => {
    const repo = new CompositeLearningContentRepository({ sources: [authored, generated] });
    expect((await repo.getDocument('anatomy:biceps')).from).toBe('corpus');
    expect((await repo.getDocument('authored-doc')).from).toBe('yaml');
    expect(await repo.getDocument('nowhere')).toBeNull();
  });

  it('lets an authored document override a generated one of the same id', async () => {
    const override = { async getDocument(id) { return id === 'anatomy:biceps' ? { documentId: id, from: 'yaml' } : null; } };
    const repo = new CompositeLearningContentRepository({ sources: [override, generated] });
    expect((await repo.getDocument('anatomy:biceps')).from).toBe('yaml');
  });

  it('routes banks and actions past a source that has none', async () => {
    const repo = new CompositeLearningContentRepository({ sources: [generated, authored] });
    expect((await repo.getQuestionBank('bank-1')).from).toBe('yaml');
    expect(await repo.getLearningAction('any')).toBeNull();
  });

  it('lists rich decks with first-source precedence', async () => {
    const repo = new CompositeLearningContentRepository({ sources: [
      { async listFlashcardDecks() { return [{ id: 'cells', title: 'Authored' }]; } },
      { async listFlashcardDecks() { return [{ id: 'cells', title: 'Generated' }, { id: 'atoms', title: 'Atoms' }]; } },
    ] });
    await expect(repo.listFlashcardDecks()).resolves.toEqual([{ id: 'cells', title: 'Authored' }, { id: 'atoms', title: 'Atoms' }]);
  });

  it('skips a source that throws', async () => {
    const logger = recordingLogger();
    const broken = { async getDocument() { throw new Error('disk gone'); } };
    const repo = new CompositeLearningContentRepository({ sources: [broken, generated], logger });
    expect((await repo.getDocument('anatomy:biceps')).from).toBe('corpus');
    expect(logger.events[0].data.error).toBe('disk gone');
  });

  it('tolerates a source that does not implement every method', async () => {
    const partial = { async getDocument() { return null; } }; // no banks, no actions
    const repo = new CompositeLearningContentRepository({ sources: [partial, authored] });
    expect((await repo.getQuestionBank('bank-1')).from).toBe('yaml');
  });
});
