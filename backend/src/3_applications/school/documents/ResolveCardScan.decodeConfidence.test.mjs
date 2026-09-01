/**
 * ResolveCardScan — decode confidence measurement (Task 4, 2026-09-01).
 *
 * MEASUREMENT ONLY. `execute()`'s resolved object gains a `decode` record
 * (`{pattern, cardId, inferred, missingDigits}`) on every scan, clean or
 * inferred, so "how often does the reader produce a partial read?" becomes
 * answerable. This suite changes no grading/decision behavior — it only
 * asserts the new field's shape. Fixtures mirror `ResolveCardScan.test.mjs`
 * (`sourceDoc`/`mcQuestion`/`fakeRepository`/`fakeAllocationStore`/
 * `publishAndAllocate`, same `context: { cardId }` explicit-card-id pattern
 * used by that file's own User_4-regression fixtures for these exact two card
 * ids, '8424408' and '8684155').
 */
import { describe, it, expect } from 'vitest';
import { PublishPrintDocument } from './PublishPrintDocument.mjs';
import { RenderPrintDocument } from './RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { ResolveCardScan } from './ResolveCardScan.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({
  rendering: createPrintDocumentRendering(), ...deps,
});

const richText = (md) => ({ type: 'rich_text', md });

const mcQuestion = (itemId, number, { choices, answer, points } = {}) => ({
  type: 'question',
  itemId,
  number,
  blocks: [richText(`Prompt for ${itemId}`)],
  choices,
  answer,
  ...(points !== undefined ? { points } : {}),
});

const sourceDoc = (id, blocks, over = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA,
  id,
  seed: 12345,
  variant: 0,
  target: ['letter'],
  archetype: 'quiz',
  title: id,
  blocks,
  ...over,
});

/** In-memory `YamlPrintDocumentRepository`-shaped fake — mirrors ResolveCardScan.test.mjs's own. */
function fakeRepository() {
  const published = new Map();
  const banks = new Map();
  const latestRevById = new Map();
  return {
    async writePublished({ document, bank, rev }) {
      const key = `${document.id}@${rev}`;
      published.set(key, document);
      if (bank) banks.set(key, bank);
      latestRevById.set(document.id, rev);
      return {
        document: { written: true, alreadyPublished: false },
        bank: bank ? { written: true, alreadyPublished: false } : null,
      };
    },
    async getPublished(id, rev) {
      const resolvedRev = rev ?? latestRevById.get(id);
      if (!resolvedRev) return null;
      return published.get(`${id}@${resolvedRev}`) ?? null;
    },
    async getDerivedBank(id, rev) {
      return banks.get(`${id}@${rev}`) ?? null;
    },
  };
}

/** Fresh in-memory `YamlAllocationStore` — no filesystem (mirrors ResolveCardScan.test.mjs's own fake). */
function fakeAllocationStore(over = {}) {
  const map = new Map();
  const io = {
    load: (filePath) => (map.has(filePath) ? structuredClone(map.get(filePath)) : null),
    save: (filePath, content) => { map.set(filePath, structuredClone(content)); },
    list: (dir) => [...map.keys()]
      .filter((p) => p.startsWith(`${dir}/`))
      .map((p) => p.slice(dir.length + 1).replace(/\.yml$/, '')),
  };
  return new YamlAllocationStore({
    directory: '/docs', io, now: () => '2026-09-01T00:00:00.000Z', rng: () => 0.42, ...over,
  });
}

async function publishAndAllocate({
  repository, allocationStore, source, context,
}) {
  const publisher = new PublishPrintDocument({ repository });
  const { id, rev } = await publisher.execute({ source });
  const published = await repository.getPublished(id, rev);
  const renderer = createRenderPrintDocument({ repository, allocationStore });
  const result = await renderer.execute({ document: published, context });
  return { allocation: result.allocation, published };
}

/**
 * Publishes+renders one single-question quiz onto EXACTLY `cardId` (explicit
 * card-id context, same as `ResolveCardScan.test.mjs`'s User_4-regression
 * fixtures), returning `{repository, allocationStore}` ready for
 * `new ResolveCardScan({ allocationStore, repository })`, per `cards: [...]`.
 */
async function makeResolver({ cards }) {
  const repository = fakeRepository();
  const allocationStore = fakeAllocationStore();
  for (const cardId of cards) {
    const source = sourceDoc(`doc-${cardId}`, [
      mcQuestion(`${cardId}-q1`, 1, { choices: ['A', 'B'], answer: 'A' }),
    ]);
    // eslint-disable-next-line no-await-in-loop
    await publishAndAllocate({
      repository, allocationStore, source, context: { cardId, startRow: 1 },
    });
  }
  return new ResolveCardScan({ allocationStore, repository });
}

describe('decode confidence', () => {
  it('records a clean decode with zero missing digits', async () => {
    const resolver = await makeResolver({ cards: ['8424408'] });
    const result = await resolver.execute({ testId: '8424408', answers: { 1: 'A' } });
    expect(result.decode).toEqual({
      pattern: '8424408', cardId: '8424408', inferred: false, missingDigits: 0,
    });
  });

  it('records an inferred decode with the count of unread digits', async () => {
    const resolver = await makeResolver({ cards: ['8424408', '8684155'] });
    const result = await resolver.execute({ testId: '84?????', answers: { 1: 'A' } });
    expect(result.decode).toEqual({
      pattern: '84?????', cardId: '8424408', inferred: true, missingDigits: 5,
    });
  });
});
