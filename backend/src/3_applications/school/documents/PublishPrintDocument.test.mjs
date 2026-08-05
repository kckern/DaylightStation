/**
 * PublishPrintDocument — the publish use case (spec §3, Task 5). Exercises
 * the REAL domain transform (`publishDocument`) against a fake repository
 * (an in-memory Map, not a filesystem) — the repository's own on-disk
 * append-only contract is `YamlPrintDocumentRepository.test.mjs`'s job; this
 * suite is about the use case's orchestration (lookup → publish → persist →
 * summarize), same division of labor as `RenderPrintDocument.test.mjs`.
 */
import { describe, it, expect } from 'vitest';
import { PublishPrintDocument } from './PublishPrintDocument.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';

const richText = (md) => ({ type: 'rich_text', md });

/** A minimal source with one answer-bearing inline question — mints a derived bank. */
const withBank = (over = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA,
  id: 'states-quiz-3',
  seed: 91242,
  target: ['letter'],
  archetype: 'quiz',
  title: 'U.S. States Quiz',
  blocks: [{
    type: 'question',
    itemId: 'q1',
    number: 1,
    blocks: [richText('What is the capital of Washington?')],
    choices: ['Olympia', 'Salem', 'Boise'],
    answer: 'Olympia',
  }],
  ...over,
});

/** A purely presentational source — publishes clean but mints no bank. */
const noBank = (over = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA,
  id: 'reading-notes-1',
  seed: 5,
  target: ['letter'],
  archetype: 'infopage',
  blocks: [richText('Some teaching prose with no questions.')],
  ...over,
});

/** In-memory fake repository — `get` resolves raw sources by id; `writePublished` persists into `store`. */
function fakeRepository(sourcesById = {}) {
  const store = new Map(); // `${id}@${rev}` -> {document, bank}
  return {
    store,
    get: async (id) => sourcesById[id] ?? null,
    writePublished({ document, bank, rev }) {
      const key = `${document.id}@${rev}`;
      const existing = store.get(key);
      if (existing) {
        return {
          document: { written: false, alreadyPublished: true },
          bank: bank ? { written: false, alreadyPublished: true } : null,
        };
      }
      store.set(key, { document, bank });
      return {
        document: { written: true, alreadyPublished: false },
        bank: bank ? { written: true, alreadyPublished: false } : null,
      };
    },
  };
}

describe('constructor', () => {
  it('requires a repository with writePublished', () => {
    expect(() => new PublishPrintDocument({})).toThrow(/writePublished/);
    expect(() => new PublishPrintDocument({ repository: { get: async () => null } })).toThrow(/writePublished/);
  });
});

describe('execute({source}) — publish + persist', () => {
  it('publishes a valid source, persists both artifacts, and returns id/rev/bankId', async () => {
    const repository = fakeRepository();
    const useCase = new PublishPrintDocument({ repository });
    const result = await useCase.execute({ source: withBank() });

    expect(result.id).toBe('states-quiz-3');
    expect(result.rev).toMatch(/^[0-9a-f]{9}$/);
    expect(result.bankId).toBe(`derived/states-quiz-3@${result.rev}`);
    expect(result.warnings).toEqual([]);

    const stored = repository.store.get(`states-quiz-3@${result.rev}`);
    expect(stored.document.schema).toBe('school.document/v2');
    expect(stored.document.rev).toBe(result.rev);
    expect(stored.document.blocks[0]).not.toHaveProperty('answer');
    expect(stored.bank.items).toHaveLength(1);
    expect(stored.bank.items[0]).toMatchObject({ id: 'q1', type: 'multiple_choice', answer: 'Olympia' });
  });

  it('a purely presentational source publishes with bankId: null and a no-bank warning', async () => {
    const repository = fakeRepository();
    const useCase = new PublishPrintDocument({ repository });
    const result = await useCase.execute({ source: noBank() });

    expect(result.bankId).toBeNull();
    expect(result.warnings).toEqual([expect.stringMatching(/no answer-bearing content/)]);
    const stored = repository.store.get(`reading-notes-1@${result.rev}`);
    expect(stored.bank).toBeNull();
  });

  it('is deterministic: publishing the identical source twice yields the identical rev', async () => {
    const repository = fakeRepository();
    const useCase = new PublishPrintDocument({ repository });
    const first = await useCase.execute({ source: withBank() });
    const second = await useCase.execute({ source: withBank() });
    expect(second.rev).toBe(first.rev);
  });

  it('re-publishing the identical source warns "already published" via the repository', async () => {
    const repository = fakeRepository();
    const useCase = new PublishPrintDocument({ repository });
    await useCase.execute({ source: withBank() });
    const second = await useCase.execute({ source: withBank() });
    expect(second.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/already published/)]));
  });

  it('rejects an invalid source with a structured INVALID_DOCUMENT_SOURCE error, nothing persisted', async () => {
    const repository = fakeRepository();
    const useCase = new PublishPrintDocument({ repository });
    await expect(useCase.execute({ source: withBank({ id: 'BAD ID' }) })).rejects.toMatchObject({
      name: 'ValidationError', code: 'INVALID_DOCUMENT_SOURCE',
    });
    expect(repository.store.size).toBe(0);
  });
});

describe('execute({id}) — repository lookup', () => {
  it('resolves the source through repository.get(id) before publishing', async () => {
    const repository = fakeRepository({ 'states-quiz-3': withBank() });
    const useCase = new PublishPrintDocument({ repository });
    const result = await useCase.execute({ id: 'states-quiz-3' });
    expect(result.id).toBe('states-quiz-3');
  });

  it('rejects a missing id with a structured DOCUMENT_NOT_FOUND error', async () => {
    const repository = fakeRepository();
    const useCase = new PublishPrintDocument({ repository });
    await expect(useCase.execute({ id: 'ghost' })).rejects.toMatchObject({
      name: 'ValidationError', code: 'DOCUMENT_NOT_FOUND',
    });
  });

  it('rejects execute({}) — neither source nor id', async () => {
    const repository = fakeRepository();
    const useCase = new PublishPrintDocument({ repository });
    await expect(useCase.execute({})).rejects.toMatchObject({
      name: 'ValidationError', code: 'MISSING_SOURCE',
    });
  });
});
