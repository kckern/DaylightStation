import { describe, expect, it, vi } from 'vitest';
import { createDocumentReceiptRenderer } from './DocumentReceiptRenderer.mjs';
import { BuildAgenda } from '../../../3_applications/school/usecases/BuildAgenda.mjs';

/**
 * Two regression tests for the agenda preview / bulk-print card fixes
 * (task-2, 2026-09-01 parked-fixes):
 *
 *  1. The bulk-print card now shares the lesson card's two-column shape
 *     (code column left, text right) instead of stacking heading / subject
 *     list / code area full-width, one under the other. That shape change
 *     is what makes the card materially shorter.
 *
 *  2. `BuildAgenda`'s preview branch used to hardcode "Preview only — ask a
 *     grown-up to start this lesson" on every card (a line the print never
 *     carries) and never counted preview offers toward the bulk-print gate
 *     (so the printed agenda's "Print all sheets" card silently never showed
 *     up in a preview). Both are fixed in the same change; this test proves
 *     the preview and the print agree.
 */

const bulkBlock = {
  type: 'scan_action',
  action: 'preview:not-a-bulk-ticket',
  presentation: 'bulk_print',
  label: 'Print all sheets',
  hideCode: true,
  subjects: ['math', 'civilization', 'scripture'],
  panelCode: '000000',
};

describe('bulk print card', () => {
  it('is no taller than a single lesson card is wide-columned', async () => {
    const renderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
    const { height, codes } = await renderer.createCanvas({
      id: 'agenda-test', title: 'TEST', blocks: [bulkBlock],
    }, { tokens: {} });

    // Trap 1 (per the brief): a dropped/no-op'd block can pass a bare height
    // assertion trivially (e.g. by rendering nothing at all). Guard against
    // that two ways:
    //  - `codes` is DocumentReceiptRenderer's own ledger of every code it
    //    actually drew (`codes.push(...)` only happens for a real op).  A
    //    dropped block leaves this empty.
    //  - The lower bound on height: a document with ONLY a header and no
    //    block at all renders at ~89px (see the sibling assertion below).
    //    150px is comfortably above that and comfortably below a real
    //    two-column card (~299px for this fixture), so it can only be
    //    crossed by an actual card, not an empty one.
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatchObject({ action: bulkBlock.action, kind: 'scan_action', lines: ['000000'] });
    expect(height).toBeGreaterThan(150);

    // The two-column card must be materially shorter than the old stacked one.
    // Stacked height was padding*2 + blockGap + rowGap*3 + heading + subjects +
    // codeArea + codeGap + codeLines; two-column is padding*2 + max(code, text).
    // 320px is comfortably between the two for a 3-subject card.
    expect(height).toBeLessThan(320);
  });

  it('renders far shorter than a document with no block at all (baseline, proves the card is not a no-op)', async () => {
    const renderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
    const withCard = await renderer.createCanvas({
      id: 'agenda-test', title: 'TEST', blocks: [bulkBlock],
    }, { tokens: {} });
    const withoutCard = await renderer.createCanvas({
      id: 'agenda-test', title: 'TEST', blocks: [],
    }, { tokens: {} });
    expect(withCard.height).toBeGreaterThan(withoutCard.height + 100);
  });
});

const NOW = '2026-09-01T16:00:00.000Z';

/**
 * Copied wholesale from `BuildAgenda.progress.test.mjs`'s `fixture()`
 * (lines ~14-71), per the brief — same in-memory fake shape, just with TWO
 * printable (moveKind: 'print') sections instead of one printable + one
 * program section, and `selfService: { enabled: true }` added so the bulk
 * gate is live.
 */
function buildPreviewAgendaHarness() {
  const mathEntry = {
    unitId: 'number-forms', courseId: 'math-course', module: 'number-sense',
    subject: 'math', title: 'Number Forms', status: 'in_progress', sessionId: 'ses-math',
  };
  const civEntry = {
    unitId: 'rome', courseId: 'civ-course', module: 'ancient-rome',
    subject: 'civilization', title: 'Rome', status: 'in_progress', sessionId: 'ses-civ',
  };
  const plan = { entries: [mathEntry, civEntry], errors: [] };
  const assignment = { courses: [
    {
      courseId: 'math-course',
      enrollment: {
        moduleOrder: ['number-sense'], optionalModules: [],
        lessonOrder: { 'number-sense': ['number-forms'] },
      },
    },
    {
      courseId: 'civ-course',
      enrollment: {
        moduleOrder: ['ancient-rome'], optionalModules: [],
        lessonOrder: { 'ancient-rome': ['rome'] },
      },
    },
  ] };
  const works = [
    { work: 'math-course', title: 'Elementary Mathematics', short_title: 'Elementary Math',
      modules: [{ module: 'number-sense', title: 'Number Sense and Place Value', short_title: 'Number Sense', number: 1 }] },
    { work: 'civ-course', title: 'Civilization', short_title: 'Civilization',
      modules: [{ module: 'ancient-rome', title: 'Ancient Rome', short_title: 'Ancient Rome', number: 1 }] },
  ];
  // `moveKind: 'print'` (per offerSession.mjs's `nextMove`, `created` state)
  // requires a unit with `.document`, or `.bank` with `delivery: 'paper'` —
  // both units below use the `.bank` + paper-delivery shape.
  const units = [
    { unitId: 'number-forms', courseId: 'math-course', module: 'number-sense',
      subject: 'math', title: 'Number Forms', bank: 'math/number-forms', delivery: 'paper' },
    { unitId: 'rome', courseId: 'civ-course', module: 'ancient-rome',
      subject: 'civilization', title: 'Rome', bank: 'civ/rome', delivery: 'paper' },
  ];
  const sections = [
    { subject: 'math', servedToday: false, next: mathEntry, progressRows: [] },
    { subject: 'civilization', servedToday: false, next: civEntry, progressRows: [] },
  ];
  const planProjection = { project: vi.fn(async () => ({
    plan, sections, activeExceptions: [],
    projection: { assignment, units, sessions: [], works, nowIso: NOW },
  })) };
  const sessions = {
    readEvents: vi.fn(async (sessionId) => [{
      type: 'created', at: NOW, sessionId, seq: 1,
      learnerId: 'user_4', unitId: sessionId === 'ses-math' ? 'number-forms' : 'rome',
      studyDay: '2026-09-01',
    }]),
    appendEvent: vi.fn(),
  };
  const tokens = {
    // `selfService` requires this regardless of `previewOnly` (constructor
    // check, BuildAgenda.mjs ~line 156) — it's read unconditionally before
    // the per-subject loop to build the cross-day duplicate-code guard.
    liveAccessCodes: vi.fn(async () => []),
    put: vi.fn(),
  };
  const useCase = new BuildAgenda({
    curriculum: {}, assignments: {}, sessions, tokens, planProjection,
    launchers: new Map(),
    previewOnly: true, clock: () => new Date(NOW), timezone: 'America/Los_Angeles',
    selfService: { enabled: true },
  });
  return useCase;
}

async function buildPreviewAgenda() {
  const useCase = buildPreviewAgendaHarness();
  return useCase.execute({ learnerId: 'user_4', learnerName: 'User_4' });
}

describe('agenda preview fidelity', () => {
  it('has at least two printable offers and a selfService bulk gate (fixture sanity, not the regression itself)', async () => {
    // Trap 2 (per the brief): with fewer than two printable offers, or
    // without `selfService`, the bulk gate correctly emits no card and the
    // assertion below would pass vacuously. Prove the fixture actually
    // clears the gate before relying on it.
    const result = await buildPreviewAgenda();
    const printableOffers = result.offers.filter((offer) => offer.printable);
    expect(printableOffers.length).toBeGreaterThanOrEqual(2);
  });

  it('preview carries no PREVIEW ONLY text and does include the bulk card', async () => {
    const result = await buildPreviewAgenda();
    const serialized = JSON.stringify(result.document);
    expect(serialized).not.toMatch(/PREVIEW ONLY/i);
    expect(serialized).not.toMatch(/ask a grown-up to start this lesson/i);
    const blocks = result.document.blocks ?? [];
    expect(blocks.some((b) => b.presentation === 'bulk_print')).toBe(true);
  });
});
