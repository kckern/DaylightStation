/**
 * SchoolPrintScanConsumer key-alignment end-to-end (Task 4, OMR key-alignment
 * check). Drives Task 2 (`ResolveCardScan`'s row-shift detector) and Task 3
 * (`RecordCardScanOutcome#bridgeSession`'s review-queue routing) through the
 * REAL consumer, wired the same shape `app.mjs` wires it in production
 * (§ around `createSchoolPrintScanConsumer({..., resolveCardScan,
 * recordCardScanOutcome, ...})`, `backend/src/app.mjs`): both are RAW class
 * instances with an `execute` method, never a `{ execute }` wrapper — a
 * `RecordCardScanOutcome` built directly with `new RecordCardScanOutcome(...)`
 * and handed straight to the consumer, exactly like `schoolLifecycle`'s own
 * `resolveCardScan` use case is.
 *
 * The worksheet fixture is the real 2026-09-21 New York-lesson sheet that
 * motivated this feature (session `ses_qkd1wl1fzz`, rows 22-27): a parent's
 * row-shift theory, checked by hand in Task 1's own regression comment and
 * found NOT to apply. Its 6 multiple_choice correct answers are C,B,B,A,A,D
 * — the exact `learner1NewYorkRows` fixture from
 * `backend/src/2_domains/school/omrKeyAlignment.test.mjs`. Worksheet
 * construction (`PublishPrintDocument` + `RenderPrintDocument` +
 * `YamlAllocationStore`, non-letter choices so `given` and `correctLetter`
 * can never be silently conflated) is copied from Task 2's own real harness,
 * `ResolveCardScan.keyAlignment.test.mjs` — not re-derived. Session/review-
 * queue/datastore doubles are copied from Task 3's own harness,
 * `RecordCardScanOutcome.keyAlignment.test.mjs`.
 */
import { describe, it, expect } from 'vitest';
import { createSchoolPrintScanConsumer } from './SchoolPrintScanConsumer.mjs';
import { PublishPrintDocument } from '../documents/PublishPrintDocument.mjs';
import { RenderPrintDocument } from '../documents/RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from '#rendering/school/documents/PrintDocumentRendering.mjs';
import { ResolveCardScan } from '../documents/ResolveCardScan.mjs';
import { RecordCardScanOutcome } from '../documents/RecordCardScanOutcome.mjs';
import { YamlAllocationStore } from '#adapters/school/documents/YamlAllocationStore.mjs';
import { DOCUMENT_SOURCE_SCHEMA } from '#domains/school/documents/documentSource.mjs';
import { createEvent } from '#domains/school/sessions/sessionEvents.mjs';

const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };

const quietLogger = { info() {}, warn() {}, debug() {}, error() {} };

// ---- Task 2's real worksheet-construction harness (copied verbatim from
// ResolveCardScan.keyAlignment.test.mjs) ----
const richText = (md) => ({ type: 'rich_text', md });
const mcQuestion = (itemId, number, { choices, answer, points } = {}) => ({
  type: 'question', itemId, number, blocks: [richText(`Prompt for ${itemId}`)], choices, answer,
  ...(points !== undefined ? { points } : {}),
});
const sourceDoc = (id, blocks, over = {}) => ({
  schema: DOCUMENT_SOURCE_SCHEMA, id, seed: 12345, variant: 0, target: ['letter'],
  archetype: 'quiz', title: id, blocks, ...over,
});

function fakeRepository() {
  const published = new Map(); const banks = new Map(); const latestRevById = new Map();
  return {
    async writePublished({ document, bank, rev }) {
      const key = `${document.id}@${rev}`;
      published.set(key, document);
      if (bank) banks.set(key, bank);
      latestRevById.set(document.id, rev);
      return { document: { written: true, alreadyPublished: false }, bank: bank ? { written: true, alreadyPublished: false } : null };
    },
    async getPublished(id, rev) {
      const resolvedRev = rev ?? latestRevById.get(id);
      return resolvedRev ? (published.get(`${id}@${resolvedRev}`) ?? null) : null;
    },
    async getDerivedBank(id, rev) { return banks.get(`${id}@${rev}`) ?? null; },
  };
}

function fakeAllocationStore(over = {}) {
  const map = new Map();
  const io = {
    load: (filePath) => (map.has(filePath) ? structuredClone(map.get(filePath)) : null),
    save: (filePath, content) => { map.set(filePath, structuredClone(content)); },
    list: (dir) => [...map.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).replace(/\.yml$/, '')),
  };
  return new YamlAllocationStore({
    directory: '/docs', io, now: () => '2026-08-04T00:00:00.000Z', rng: () => 0.42, ...over,
  });
}

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({ rendering: createPrintDocumentRendering(), ...deps });

async function publishAndAllocate({ repository, allocationStore, source, context }) {
  const publisher = new PublishPrintDocument({ repository });
  const { id, rev } = await publisher.execute({ source });
  const published = await repository.getPublished(id, rev);
  const renderer = createRenderPrintDocument({ repository, allocationStore });
  const result = await renderer.execute({ document: published, context });
  return { allocation: result.allocation, published };
}

// Non-letter choices on purpose (Task 2's own comment): a standard
// multiple_choice row's graded `given` holds the resolved CHOICE VALUE, not
// the bubbled letter — using plain-word choices means a wiring mistake that
// fed a choice value into the row-shift check instead of the raw scanned
// letter would fail loudly rather than accidentally matching.
const CHOICES = ['walrus', 'penguin', 'otter', 'seal'];
// A=walrus, B=penguin, C=otter, D=seal. The real New York-lesson correct
// answers at rows 22-27 are C,B,B,A,A,D (learner1NewYorkRows,
// omrKeyAlignment.test.mjs).
const NY_CORRECT_CHOICES = ['otter', 'penguin', 'penguin', 'walrus', 'walrus', 'seal'];
const NY_START_ROW = 22;

function newYorkLessonSource(id) {
  return sourceDoc(id, NY_CORRECT_CHOICES.map((answer, index) => (
    mcQuestion(`q${NY_START_ROW + index}`, NY_START_ROW + index, { choices: CHOICES, answer })
  )));
}

// ---- Task 3's real session/review-queue/datastore harness (copied verbatim
// from RecordCardScanOutcome.keyAlignment.test.mjs) ----
function fakeDatastore() {
  const byLearner = new Map();
  return {
    appendAttempt(learnerId, attempt) {
      if (!byLearner.has(learnerId)) byLearner.set(learnerId, []);
      byLearner.get(learnerId).push(structuredClone(attempt));
      return attempt;
    },
    readAllAttempts(learnerId) { return structuredClone(byLearner.get(learnerId) ?? []); },
    readAttemptsInRange(learnerId, fromDay, toDay) {
      return structuredClone(byLearner.get(learnerId) ?? [])
        .filter((attempt) => { const day = String(attempt.at).slice(0, 10); return day >= fromDay && day <= toDay; });
    },
  };
}

function fakeSessions(seedEvents = []) {
  const events = new Map();
  const append = (sessionId, event) => {
    const list = events.get(sessionId) ?? [];
    const seq = list.reduce((max, e) => Math.max(max, e.seq ?? 0), 0) + 1;
    list.push({ ...structuredClone(event), seq });
    events.set(sessionId, list);
  };
  for (const { sessionId, event } of seedEvents) append(sessionId, event);
  return {
    async readEvents(sessionId) { return structuredClone(events.get(sessionId) ?? []); },
    async appendEvent(sessionId, event) { append(sessionId, event); },
  };
}

function fakeReviewQueue() {
  const items = [];
  return {
    items,
    async enqueue(batch) { items.push(...structuredClone(batch)); },
    async listForSession(sessionId) { return structuredClone(items.filter((i) => i.sessionId === sessionId)); },
  };
}

function seededSession(sessionId, { learnerId = 'learner1', unitId = 'geography-new-york' } = {}) {
  const mk = (payload) => {
    const { errors, event } = createEvent(payload);
    if (errors.length) throw new Error(errors.join('; '));
    return { sessionId, event };
  };
  return [
    mk({ type: 'created', at: '2026-09-21T00:00:00.000Z', sessionId, unitId, learnerId }),
    mk({ type: 'issued', at: '2026-09-21T00:00:01.000Z', sessionId, artifactId: 'art-ny-lesson' }),
  ];
}

/**
 * Builds one real end-to-end wiring: a published+allocated New York-lesson
 * worksheet, a real `ResolveCardScan`, a real `RecordCardScanOutcome` backed
 * by a seeded session, and the real `SchoolPrintScanConsumer` in front of
 * them — same shape `app.mjs` wires (raw instances, not `{ execute }`
 * wrappers).
 */
async function buildPipeline({ cardId, sessionId, documentId }) {
  const repository = fakeRepository();
  const allocationStore = fakeAllocationStore();
  const source = newYorkLessonSource(documentId);
  await publishAndAllocate({
    repository, allocationStore, source,
    context: {
      cardId, startRow: NY_START_ROW, learnerId: 'learner1', sessionId,
    },
  });
  const resolveCardScan = new ResolveCardScan({ repository, allocationStore, logger: quietLogger });
  const recordCardScanOutcome = new RecordCardScanOutcome({
    datastore: fakeDatastore(),
    sessions: fakeSessions(seededSession(sessionId)),
    reviewQueue: fakeReviewQueue(),
    clock: () => new Date('2026-09-21T14:00:00.000Z'),
    logger: quietLogger,
  });

  let handler;
  const broadcast = [];
  const realtime = {
    onPrintSheet: (_config, cb) => { handler = cb; return () => {}; },
    printScanResolved: (payload) => broadcast.push(payload),
  };
  createSchoolPrintScanConsumer({
    realtime, resolveCardScan, recordCardScanOutcome, logger: quietLogger,
  });
  return { broadcast, feed: async (answers) => { handler({ testId: cardId, answers }); await settle(); } };
}

describe('SchoolPrintScanConsumer key-alignment end-to-end', () => {
  it('grades normally and never suspects the real Learner1 New York marks (must-not-trigger)', async () => {
    const { broadcast, feed } = await buildPipeline({
      cardId: '5252427', sessionId: 'ses_qkd1wl1fzz', documentId: 'geography/atlas/ny-lesson-clean',
    });
    // The real bubbled letters from the 2026-09-21 scan: rows 22-27 =
    // C,A,B,C,C,C against a C,B,B,A,A,D key — 2/6, genuine content misses,
    // hand-verified in Task 1 to reach no offset at MARGIN.
    await feed({
      22: 'C', 23: 'A', 24: 'B', 25: 'C', 26: 'C', 27: 'C',
    });
    expect(broadcast.some((event) => event.kind === 'scan-review')).toBe(false);
    const graded = broadcast.find((event) => event.kind === 'scan-graded');
    expect(graded).toBeTruthy();
    expect(graded.correctCount).toBe(2);
    expect(graded.totalCount).toBe(6);
  });

  it('routes a shifted-marks scan of the same worksheet to review (must-trigger)', async () => {
    const { broadcast, feed } = await buildPipeline({
      cardId: '5252428', sessionId: 'ses_ny_shifted', documentId: 'geography/atlas/ny-lesson-shifted',
    });
    // Same worksheet, marks written one row late: given[row] = correct
    // choice-letter of row-1 for rows 23-27; row 22 has no row 21 to draw
    // from, so it is deliberately wrong. This is the offset -1 / 5-of-6
    // shifted-match pattern Task 1's synthetic fixture exercises.
    await feed({
      22: 'X', 23: 'C', 24: 'B', 25: 'B', 26: 'A', 27: 'A',
    });
    expect(broadcast.some((event) => event.kind === 'scan-graded')).toBe(false);
    const review = broadcast.find((event) => event.kind === 'scan-review');
    expect(review).toBeTruthy();
    expect(review.reasons).toContain('key-alignment-suspected');
    expect(review.pendingReview).toBe(1);
  });
});
