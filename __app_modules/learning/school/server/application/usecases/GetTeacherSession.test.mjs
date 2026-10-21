import { describe, expect, it, vi } from 'vitest';
import { GetTeacherSession, GetLearnerTimeline } from "./GetTeacherSession.mjs";
import { curriculumPosterRef } from '#apps/common/resources/publicResourceRefs.mjs';
import { KEY_ALIGNMENT_SUSPECTED_REASON } from "../ports/IReviewQueue.mjs";

const events = [
  { type: 'created', seq: 1, at: '2026-08-24T14:27:36.519Z', learnerId: 'learner3', unitId: 'atlas-us-p044-illinois' },
  { type: 'issued', seq: 2, at: '2026-08-24T14:28:43.031Z', artifactId: 'civilization/young-peoples-atlas-us/ws-ses-illinois' },
  { type: 'submitted', seq: 3, at: '2026-08-24T15:20:13.805Z' },
  { type: 'graded', seq: 4, at: '2026-08-24T15:20:13.833Z', percent: 100, correctCount: 1, totalCount: 1 },
];

describe('GetTeacherSession artifact read-through', () => {
  it('does not misrepresent a published revision as the original historical worksheet', async () => {
    const getPublished = vi.fn(async () => ({ id: 'civilization/young-peoples-atlas-us/ws-ses-illinois', rev: 'frozen-rev', title: 'Illinois' }));
    const useCase = new GetTeacherSession({
      sessions: {
        readEvents: vi.fn(async () => events),
        listForLearner: vi.fn(async () => [{ sessionId: 'ses_illinois', unitId: 'atlas-us-p044-illinois', outcome: { result: 'passed' } }]),
      },
      curriculum: {
        getUnit: vi.fn(async () => ({ unitId: 'atlas-us-p044-illinois', title: 'Illinois', subject: 'Civilization', courseId: 'young-peoples-atlas-us', module: 'United States' })),
        listWorks: vi.fn(async () => [{ work: 'young-peoples-atlas-us', title: 'Young People’s Atlas of the United States', subject: 'Civilization', modules: [{ module: 'United States', title: 'United States Regions and States' }] }]),
        listUnits: vi.fn(async () => [{ unitId: 'atlas-us-p044-illinois', title: 'Illinois', courseId: 'young-peoples-atlas-us' }]),
      },
      worksheetInstances: { findBySession: vi.fn(async () => ({
        id: 'civilization/young-peoples-atlas-us/ws-ses-illinois', documentId: 'civilization/young-peoples-atlas-us/ws-ses-illinois', documentRevision: 'frozen-rev', issuedAt: '2026-08-24T14:28:43.031Z',
        questions: [{ itemId: 'illinois-1', prompt: 'Which state is Illinois?', options: [{ text: 'Illinois' }] }],
      })) },
      issuedArtifacts: { get: vi.fn(async () => null) },
      reviewQueue: { listForSession: vi.fn(async () => [{ itemId: 'illinois-1', questionNumber: 1, prompt: 'Which state is Illinois?', given: 'Illinois', verdict: 'correct' }]) },
      printDocuments: { getPublished },
    });

    const result = await useCase.execute({ sessionId: 'ses_illinois' });

    expect(result).toMatchObject({
      schema: 'school.teacher-session/v5',
      taxonomy: {
        subject: 'Civilization', lessonTitle: 'Illinois', courseTitle: 'Young People’s Atlas of the United States',
        moduleTitle: 'United States Regions and States', posterUrl: curriculumPosterRef('teacher', 'young-peoples-atlas-us'),
      },
      assignment: { documentRevision: 'frozen-rev', questions: [{ prompt: 'Which state is Illinois?' }] },
      assessment: { items: [{ given: 'Illinois', verdict: 'correct' }] },
      capabilities: {
        gradeCorrection: true, launchPreview: true, companionRecovery: false,
        offerRetake: false, manualSettlement: true,
      },
      artifacts: [{ artifactId: 'civilization/young-peoples-atlas-us/ws-ses-illinois', availability: 'unavailable', exactBytesRetained: false }],
    });
    expect(result.artifacts[0].originalPdfUrl).toBeUndefined();
    expect(result.artifacts[0].thumbnailUrl).toBeUndefined();
    expect(getPublished).toHaveBeenCalledWith('civilization/young-peoples-atlas-us/ws-ses-illinois', 'frozen-rev');
  });

  /**
   * Whole-branch review finding #4: a `key-alignment-suspected` queue entry
   * has `questionNumber: null` (nothing was printed for it), so mapping
   * `reviewEvidence` unfiltered with an `index + 1` fallback fabricates a
   * phantom "Question N" in the teacher's "printed questions" list. It must
   * be excluded from `assessment.items`, and the real questions after it
   * must keep numbering as if it were never there.
   */
  it('never numbers the synthetic key-alignment queue entry as a printed question', async () => {
    const useCase = new GetTeacherSession({
      sessions: {
        readEvents: vi.fn(async () => events),
        listForLearner: vi.fn(async () => []),
      },
      curriculum: { getUnit: vi.fn(async () => null), listWorks: vi.fn(async () => []), listUnits: vi.fn(async () => []) },
      issuedArtifacts: { get: vi.fn(async () => null) },
      reviewQueue: {
        listForSession: vi.fn(async () => [
          { itemId: 'q1', questionNumber: 1, prompt: 'P1', given: 'A', verdict: 'correct' },
          { itemId: 'key-alignment', reason: 'key-alignment-suspected', questionNumber: null,
            prompt: 'Row alignment check', given: null, verdict: null },
          { itemId: 'q2', questionNumber: 2, prompt: 'P2', given: 'B', verdict: 'incorrect' },
        ]),
      },
    });

    const result = await useCase.execute({ sessionId: 'ses_illinois' });

    expect(result.assessment.items).toEqual([
      expect.objectContaining({ itemId: 'q1', questionNumber: 1 }),
      expect.objectContaining({ itemId: 'q2', questionNumber: 2 }),
    ]);
    expect(result.assessment.items.some((item) => item.itemId === 'key-alignment')).toBe(false);
    // Still visible to a teacher elsewhere (the raw review-queue read model).
    expect(result.reviewEvidence.some((item) => item.itemId === 'key-alignment')).toBe(true);
  });
  it('withholds hand-settling while a question still waits for a person', async () => {
    const useCase = new GetTeacherSession({
      sessions: { readEvents: vi.fn(async () => events.slice(0, 3)), listForLearner: vi.fn(async () => []) },
      curriculum: { getUnit: vi.fn(async () => null), listWorks: vi.fn(async () => []), listUnits: vi.fn(async () => []) },
      worksheetInstances: { findBySession: vi.fn(async () => null) },
      issuedArtifacts: { get: vi.fn(async () => null) },
      reviewQueue: { listForSession: vi.fn(async () => [{ itemId: 'q1', verdict: null }, { itemId: 'q2', verdict: 'correct' }]) },
      printDocuments: { getPublished: vi.fn(async () => null) },
    });
    const out = await useCase.execute({ sessionId: 'ses_illinois' });
    expect(out.capabilities).toMatchObject({ manualSettlement: false, pendingReview: 1 });
  });
  // A key-alignment row is not a question: grading never waits on it, so it
  // must not hold hand-settling back either.
  it('does not count a synthetic key-alignment row as waiting', async () => {
    const useCase = new GetTeacherSession({
      sessions: { readEvents: vi.fn(async () => events.slice(0, 3)), listForLearner: vi.fn(async () => []) },
      curriculum: { getUnit: vi.fn(async () => null), listWorks: vi.fn(async () => []), listUnits: vi.fn(async () => []) },
      worksheetInstances: { findBySession: vi.fn(async () => null) },
      issuedArtifacts: { get: vi.fn(async () => null) },
      reviewQueue: { listForSession: vi.fn(async () => [{ itemId: 'k1', reason: KEY_ALIGNMENT_SUSPECTED_REASON, verdict: null }]) },
      printDocuments: { getPublished: vi.fn(async () => null) },
    });
    const out = await useCase.execute({ sessionId: 'ses_illinois' });
    expect(out.capabilities).toMatchObject({ manualSettlement: true, pendingReview: 0 });
  });
  it('says a worksheet is reprintable only while the paper is still out', async () => {
    const build = (evts) => new GetTeacherSession({
      sessions: { readEvents: vi.fn(async () => evts), listForLearner: vi.fn(async () => []) },
      curriculum: { getUnit: vi.fn(async () => null), listWorks: vi.fn(async () => []), listUnits: vi.fn(async () => []) },
      worksheetInstances: { findBySession: vi.fn(async () => null) },
      issuedArtifacts: { get: vi.fn(async (artifactId) => ({ manifest: { artifactId, representation: { mediaType: 'application/pdf' } } })) },
      reviewQueue: { listForSession: vi.fn(async () => []) },
      printDocuments: { getPublished: vi.fn(async () => null) },
    });
    const out = await build(events.slice(0, 2)).execute({ sessionId: 'ses_illinois' });
    expect(out.artifacts[0].reprintable).toBe(true);
    const handedIn = await build(events).execute({ sessionId: 'ses_illinois' });
    expect(handedIn.artifacts[0].reprintable).toBe(false);
  });
  // Receipt rows for `ses_illinois`, keyed by which retained receipt it lists.
  const receiptEvent = { type: 'result_receipt_captured', seq: 5, at: '2026-08-24T15:21:00.000Z', artifactId: 'rcpt-1', kind: 'result-receipt' };
  const manifests = {
    'rcpt-1': { artifactId: 'rcpt-1', sessionId: 'ses_illinois', kind: 'result-receipt', representation: { mediaType: 'image/png' } },
    'rcpt-2': { artifactId: 'rcpt-2', sessionId: 'ses_illinois', kind: 'result-receipt', representation: { mediaType: 'application/pdf' } },
    // The reprint reads the MANIFEST's session (e.g. after a reassignment);
    // a receipt naming another session is refused there, so not offered here.
    'rcpt-other': { artifactId: 'rcpt-other', sessionId: 'some-other-session', kind: 'result-receipt', representation: { mediaType: 'image/png' } },
    // No session on the manifest: the server reads no events and refuses.
    'rcpt-nosession': { artifactId: 'rcpt-nosession', kind: 'result-receipt', representation: { mediaType: 'image/png' } },
  };
  const withReceipt = (receiptId) => new GetTeacherSession({
    sessions: { readEvents: vi.fn(async () => [...events, { ...receiptEvent, artifactId: receiptId }]), listForLearner: vi.fn(async () => []) },
    curriculum: { getUnit: vi.fn(async () => null), listWorks: vi.fn(async () => []), listUnits: vi.fn(async () => []) },
    worksheetInstances: { findBySession: vi.fn(async () => null) },
    issuedArtifacts: { get: vi.fn(async (artifactId) => (manifests[artifactId] ? { manifest: manifests[artifactId] } : null)) },
    reviewQueue: { listForSession: vi.fn(async () => []) },
    printDocuments: { getPublished: vi.fn(async () => null) },
  });
  const receiptRow = (out) => out.artifacts.find((row) => row.role === 'result-receipt');
  // `SchoolArtifactService.reprint` sends receipt kinds to
  // `ReprintResultReceiptArtifact`, which has no session-state gate: a receipt
  // stays reprintable after hand-in, as long as it is a retained PNG.
  it('keeps a retained receipt reprintable after the work is marked', async () => {
    expect(receiptRow(await withReceipt('rcpt-1').execute({ sessionId: 'ses_illinois' })).reprintable).toBe(true);
    expect(receiptRow(await withReceipt('rcpt-2').execute({ sessionId: 'ses_illinois' })).reprintable).toBe(false);
    expect(receiptRow(await withReceipt('rcpt-missing').execute({ sessionId: 'ses_illinois' })).reprintable).toBe(false);
  });
  // `ReprintResultReceiptArtifact` reads the events of `manifest.sessionId`
  // and refuses a receipt that session does not list (ARTIFACT_LINEAGE_MISMATCH).
  it('offers a receipt reprint only from the session its manifest names', async () => {
    expect(receiptRow(await withReceipt('rcpt-other').execute({ sessionId: 'ses_illinois' })).reprintable).toBe(false);
    expect(receiptRow(await withReceipt('rcpt-nosession').execute({ sessionId: 'ses_illinois' })).reprintable).toBe(false);
  });
  // `ReprintIssuedArtifact` refuses CURRICULUM_PAUSED before it looks at state.
  it('withholds a worksheet reprint while its lesson is paused', async () => {
    const useCase = new GetTeacherSession({
      sessions: { readEvents: vi.fn(async () => events.slice(0, 2)), listForLearner: vi.fn(async () => []) },
      curriculum: { getUnit: vi.fn(async () => null), listWorks: vi.fn(async () => []), listUnits: vi.fn(async () => []) },
      worksheetInstances: { findBySession: vi.fn(async () => null) },
      issuedArtifacts: { get: vi.fn(async (artifactId) => ({ manifest: { artifactId, representation: { mediaType: 'application/pdf' } } })) },
      reviewQueue: { listForSession: vi.fn(async () => []) },
      printDocuments: { getPublished: vi.fn(async () => null) },
      curriculumExceptions: { active: vi.fn(async () => [{ kind: 'paused', resolvedLessonIds: ['atlas-us-p044-illinois'] }]) },
    });
    const out = await useCase.execute({ sessionId: 'ses_illinois' });
    expect(out.artifacts[0].reprintable).toBe(false);
  });
  // GradeSubmission returns `awaiting_review` only from `submitted`; a marked
  // session settles as a `duplicate`, which the console accepts.
  it('offers hand-settling on a marked session even with a row still unmarked', async () => {
    const useCase = new GetTeacherSession({
      sessions: { readEvents: vi.fn(async () => events), listForLearner: vi.fn(async () => []) },
      curriculum: { getUnit: vi.fn(async () => null), listWorks: vi.fn(async () => []), listUnits: vi.fn(async () => []) },
      worksheetInstances: { findBySession: vi.fn(async () => null) },
      issuedArtifacts: { get: vi.fn(async () => null) },
      reviewQueue: { listForSession: vi.fn(async () => [{ itemId: 'q1', verdict: null }]) },
      printDocuments: { getPublished: vi.fn(async () => null) },
    });
    const out = await useCase.execute({ sessionId: 'ses_illinois' });
    expect(out.capabilities).toMatchObject({ manualSettlement: true, pendingReview: 1 });
  });
});

describe('GetLearnerTimeline catalog join', () => {
  const sessions = {
    listForLearner: vi.fn(async () => [
      { sessionId: 's1', learnerId: 'learner3', unitId: 'atlas-us-p044-illinois', state: 'closed', updatedAt: '2026-08-24T15:20:00Z' },
    ]),
  };
  const curriculum = {
    getUnit: vi.fn(async () => ({
      unitId: 'atlas-us-p044-illinois', title: 'Illinois', subject: 'Civilization',
      courseId: 'young-peoples-atlas-us', module: 'United States',
    })),
    listWorks: vi.fn(async () => [{
      work: 'young-peoples-atlas-us', title: 'United States Regions and States', subject: 'Civilization',
      modules: [{ module: 'United States', title: 'Midwest' }],
    }]),
  };

  it('joins the catalog so timeline rows carry the taxonomy the list renders', async () => {
    const useCase = new GetLearnerTimeline({ sessions, curriculum });
    const { items } = await useCase.execute({ learnerId: 'learner3' });
    expect(items[0]).toMatchObject({
      sessionId: 's1',
      lessonTitle: 'Illinois',
      courseId: 'young-peoples-atlas-us',
      courseTitle: 'United States Regions and States',
      subject: 'Civilization',
      moduleTitle: 'Midwest',
      posterUrl: curriculumPosterRef('teacher', 'young-peoples-atlas-us'),
    });
  });

  it('returns raw rows untouched when no curriculum is wired', async () => {
    const useCase = new GetLearnerTimeline({ sessions });
    const { items } = await useCase.execute({ learnerId: 'learner3' });
    expect(items[0].sessionId).toBe('s1');
    expect(items[0].lessonTitle).toBeUndefined();
  });

  it('degrades to raw rows when the catalog read throws', async () => {
    const useCase = new GetLearnerTimeline({
      sessions,
      curriculum: { getUnit: vi.fn(async () => { throw new Error('catalog down'); }), listWorks: vi.fn(async () => { throw new Error('catalog down'); }) },
    });
    const { items } = await useCase.execute({ learnerId: 'learner3' });
    expect(items[0].sessionId).toBe('s1');
  });
});
