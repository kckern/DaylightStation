/**
 * Print route INTEGRATION — the seam the unit suites stub away: the real
 * route adopting a real allocation record and driving the REAL
 * RenderPrintDocument + YamlAllocationStore. Exists because the
 * route-adopts-satisfied → store-re-allocates path once 500'd in production
 * (`ALLOCATION_RECORD_ID_CONFLICT`) while both unit suites stayed green —
 * the route tests fake the renderer, the store tests bless the conflict in
 * isolation. Real PDF rendering end to end; no fakes between HTTP and YAML.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createSchoolTestRouter as createSchoolRouter } from '../../../../../tests/_lib/school/schoolRouterTestSupport.mjs';
import { PublishPrintDocument } from '#apps/school/documents/PublishPrintDocument.mjs';
import { RenderPrintDocument } from '#apps/school/documents/RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { YamlPrintDocumentRepository } from '#adapters/school/documents/YamlPrintDocumentRepository.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({
  rendering: createPrintDocumentRendering(), ...deps,
});

const richText = (md) => ({ type: 'rich_text', md });
const mcQuestion = (itemId, number, { choices, answer }) => ({
  type: 'question', itemId, number, blocks: [richText(`Prompt for ${itemId}`)], choices, answer,
});

const SOURCE = {
  schema: DOCUMENT_SOURCE_SCHEMA,
  id: 'arts/integration/quiz-1',
  seed: 4242,
  variant: 0,
  target: ['letter'],
  archetype: 'quiz',
  title: 'Integration Quiz',
  blocks: [
    mcQuestion('q1', 1, { choices: ['red', 'green', 'blue'], answer: 'blue' }),
    mcQuestion('q2', 2, { choices: ['cat', 'dog', 'fox'], answer: 'cat' }),
  ],
};

/** In-memory io for the document repository (basePath-keyed, list/load/save/stat). */
function repoIo() {
  const store = new Map();
  let tick = 0;
  const mtimes = new Map();
  return {
    list: (dir, { recursive } = {}) => [...store.keys()]
      .filter((p) => p.startsWith(`${dir}/`))
      .map((p) => p.slice(dir.length + 1))
      .filter((rel) => recursive || !rel.includes('/')),
    load: (basePath) => (store.has(basePath) ? structuredClone(store.get(basePath)) : null),
    save: (basePath, content) => { store.set(basePath, structuredClone(content)); mtimes.set(basePath, tick += 1); },
    stat: (basePath) => (store.has(basePath) ? { mtimeMs: mtimes.get(basePath) } : null),
  };
}

/** In-memory io for the allocation store (full-path-keyed, load/save/list). */
function allocationIo() {
  const store = new Map();
  return {
    load: (filePath) => (store.has(filePath) ? structuredClone(store.get(filePath)) : null),
    save: (filePath, content) => { store.set(filePath, structuredClone(content)); },
    list: (dir) => [...store.keys()]
      .filter((p) => p.startsWith(`${dir}/`))
      .map((p) => p.slice(dir.length + 1).replace(/\.yml$/, '')),
  };
}

// Card-minting params (freshCard/card) moved off the GET splat onto this
// POST (punch 5b) — the real render/allocation stack behind it is unchanged.
function postRender(app, body) {
  return request(app).post('/api/v1/school/print/render').send(body);
}

describe('print route + real store + real renderer', () => {
  let app; let allocationStore;

  beforeAll(async () => {
    const io = repoIo();
    // The source file itself lives in the tree too — `execute({id})` resolves
    // through `repository.get`, exactly as a hand-authored source on disk.
    io.save('/docs/arts/integration/quiz-1', SOURCE);
    const repository = new YamlPrintDocumentRepository({ directory: '/docs', io });
    allocationStore = new YamlAllocationStore({ directory: '/docs', io: allocationIo(), now: () => new Date().toISOString() });
    await new PublishPrintDocument({ repository }).execute({ source: SOURCE });
    const renderPrintDocument = createRenderPrintDocument({ repository, allocationStore });
    app = express();
    app.use(express.json());
    app.repositoryForTest = repository;
    app.use('/api/v1/school', createSchoolRouter({
      schoolService: { listBankSourceSummaries: () => [] },
      renderPrintDocument,
      printDocumentsRepo: repository,
      printAllocationStore: allocationStore,
      logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    }));
  });

  it('mints on first bare omr, reuses on refresh, and STILL RENDERS after the scan satisfies the record', async () => {
    const first = await request(app)
      .get('/api/v1/school/print/arts/integration/quiz-1?variety=omr&learnerId=learner4');
    expect(first.status).toBe(200);
    const minted = JSON.parse(first.headers['x-school-print-allocation']);
    expect(minted.status).toBe('live');

    // Refresh: same URL, same sheet — no card burned.
    const second = await request(app)
      .get('/api/v1/school/print/arts/integration/quiz-1?variety=omr&learnerId=learner4');
    expect(second.status).toBe(200);
    expect(JSON.parse(second.headers['x-school-print-allocation']).recordId).toBe(minted.recordId);

    // The quiz is taken and scanned: record goes satisfied.
    await allocationStore.updateStatus({
      cardId: minted.cardId, recordId: minted.recordId, status: 'satisfied',
    });

    // The bookmarked URL — and the teacher's grading reprint — must keep
    // reproducing the sheet, not 500 on a recordId conflict.
    const reprint = await request(app)
      .get('/api/v1/school/print/arts/integration/quiz-1?variety=omr&learnerId=learner4');
    expect(reprint.status).toBe(200);
    const adopted = JSON.parse(reprint.headers['x-school-print-allocation']);
    expect(adopted).toMatchObject({ recordId: minted.recordId, status: 'satisfied' });
    expect(Buffer.from(reprint.body).subarray(0, 4).toString()).toBe('%PDF');

    // No duplicate record appeared on the card.
    expect(await allocationStore.findByCard(minted.cardId)).toHaveLength(1);
  });

  it('/print/<cardId> alone reproduces the sheet the card was printed for', async () => {
    const minted = await postRender(app, {
      id: 'arts/integration/quiz-1', variety: 'omr', freshCard: true, learnerId: 'learner2',
    });
    expect(minted.status).toBe(200);
    const { cardId, recordId } = JSON.parse(minted.headers['x-school-print-allocation']);

    // The card number is the only thing on the paper — it must be enough.
    const byCard = await request(app).get(`/api/v1/school/print/${cardId}`);
    expect(byCard.status).toBe(200);
    expect(JSON.parse(byCard.headers['x-school-print-allocation']).recordId).toBe(recordId);
    expect(byCard.headers['content-disposition']).toBe('inline; filename="quiz-1.pdf"');
    expect(Buffer.from(byCard.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('a retake pins the PUBLISHED rev — the record a scan must later resolve', async () => {
    const retake = await request(app)
      .get('/api/v1/school/print/arts/integration/quiz-1?variety=omr&retake=1&learnerId=learner3');
    expect(retake.status).toBe(200);
    const allocation = JSON.parse(retake.headers['x-school-print-allocation']);
    // recordId embeds the rev: it must be a rev getPublished can actually
    // serve, or the card dies at scan time (EntityNotFoundError).
    const rev = allocation.recordId.split('@')[1].split(':')[0];
    const repository = app.repositoryForTest;
    expect(await repository.getPublished('arts/integration/quiz-1', rev)).not.toBeNull();
  });

  it('a genuine allocation conflict surfaces as 409 with its invariant code, not a 500', async () => {
    const minted = await postRender(app, {
      id: 'arts/integration/quiz-1', variety: 'omr', freshCard: true, learnerId: 'learner1',
    });
    expect(minted.status).toBe(200);
    const { cardId } = JSON.parse(minted.headers['x-school-print-allocation']);

    // Explicitly claiming overlapping rows on the same card for a different
    // variant is a real conflict — the client should see WHY. No learnerId is
    // supplied here on purpose: the quiz gate still does not fire, because
    // this card already carries a usable (live) record for this document —
    // the gate only exists to reject a FABRICATED card, and this one is
    // real. Adding learnerId=learner1 here would instead make the request
    // supersede learner1's own prior live record (YamlAllocationStore.allocate's
    // `supersedes` match on documentId+learnerId excludes the supersede
    // target from the collision pool), turning this into a 200 and defeating
    // the very conflict this test exists to exercise.
    const clash = await postRender(app, {
      id: 'arts/integration/quiz-1', variety: 'omr', card: cardId, startRow: 2, variant: 5,
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('ALLOCATION_COLLISION');
  });
});
