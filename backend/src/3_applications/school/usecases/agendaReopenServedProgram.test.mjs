// @vitest-environment node
/**
 * DONE IS NOT CLOSED (2026-09-25).
 *
 * A learner finished their flashcards in the morning and wanted another round in the
 * evening. The sheet they printed listed "Language — Flashcards" under Done today
 * and offered no code: `BuildAgenda` skipped every served subject. And the code
 * they still held from the morning resolved to the SENTENCE LADDER they had been
 * moved off on 09-24, because the reopen lookup scanned every plan entry and
 * took the first reopenable one, retired or not.
 *
 * The day's requirement stays met; extra rounds must always be reachable, and
 * they must reach the program the child actually does.
 */
import { describe, it, expect, vi } from 'vitest';
import { planDailyAgenda } from '#domains/school/agenda.mjs';
import { BuildAgenda } from './BuildAgenda.mjs';
import { findReopenableProgramEntry } from './continuationEntry.mjs';
import { programStatusFor } from '#domains/school/agenda.mjs';

const WEEKDAYS = [1, 2, 3, 4, 5];
const NOW = '2026-09-25T18:00:00.000Z'; // Friday, after the switchover
const ladder = {
  unitId: 'sentence-ladder:glossika-korean', title: 'Glossika Korean', subject: 'language',
  program: 'sentence-ladder', programInstance: 'glossika-korean', cadence: 'daily',
  status: 'available', timingState: 'available', elective: false,
  schedule: { daysOfWeek: WEEKDAYS, except: [{ from: '2026-09-24', to: '2099-12-31' }] },
};
const cards = {
  unitId: 'flashcards:language/korean/week-01-classroom', title: 'UBKS 비둘기', subject: 'language',
  program: 'flashcards', programInstance: 'language/korean/week-01-classroom', cadence: 'daily',
  status: 'available', timingState: 'available', elective: false,
  schedule: { daysOfWeek: WEEKDAYS, except: [{ from: '2026-01-01', to: '2026-09-23' }] },
};
// Both launchers declare themselves reopenable — the sentence ladder does too.
const programStatuses = {
  'sentence-ladder::glossika-korean': { doneToday: false, reopenable: true },
  'flashcards::language/korean/week-01-classroom': {
    doneToday: true, reopenable: true,
    servedWork: [{ unitId: cards.unitId, title: 'Flashcards' }],
    context: {
      course: { id: 'program:card-ladder:ubks', title: 'UBKS 비둘기' },
      unit: { id: 'week-01', title: 'Week 1: Classroom' },
      lesson: { id: 'week-01:2026-09-25', title: 'Review run' },
    },
    progress: [{ scope: 'unit', label: '4 recognised · 0 mastered', completed: 0, inProgress: 4, total: 19 }],
  },
};
const plan = () => ({ entries: [{ ...ladder }, { ...cards }] });
const languageSection = (p) => planDailyAgenda({ plan: p, now: NOW, programStatuses })
  .sections.find((section) => section.subject === 'language');

describe('a served subject names the LIVE program it reopens to', () => {
  it('reopens the flashcards, never the retired sentence ladder', () => {
    const section = languageSection(plan());
    expect(section.servedToday).toBe(true);
    expect(section.reopenUnitId).toBe(cards.unitId);
  });

  it('the resolvers honour it — the retired ladder cannot win by plan order', () => {
    const p = plan();
    const section = languageSection(p);
    const statusOf = (entry) => programStatusFor(programStatuses, entry);
    // The old scan: first reopenable entry in plan order — the wrong program.
    expect(findReopenableProgramEntry(p, { subject: 'language', statusOf }).entry.unitId).toBe(ladder.unitId);
    expect(findReopenableProgramEntry(p, { subject: 'language', statusOf, unitId: section.reopenUnitId }).entry.unitId)
      .toBe(cards.unitId);
    expect(findReopenableProgramEntry(p, { subject: 'language', statusOf, unitId: null })).toBeNull();
  });

  it('an unserved section reopens nothing', () => {
    const section = planDailyAgenda({
      plan: plan(), now: NOW,
      programStatuses: { ...programStatuses, 'flashcards::language/korean/week-01-classroom': { doneToday: false, reopenable: true } },
    }).sections.find((s) => s.subject === 'language');
    expect(section.servedToday).toBe(false);
    expect(section.reopenUnitId).toBeNull();
  });
});

describe('BuildAgenda prints a way back in for a finished flashcard deck', () => {
  function build() {
    const p = plan();
    const { sections } = planDailyAgenda({ plan: p, now: NOW, programStatuses });
    const assignment = { learnerId: 'test-learner', courses: [], programs: [] };
    const planProjection = { project: vi.fn(async () => ({
      plan: p, sections, activeExceptions: [],
      programStatuses: Object.entries(programStatuses).map(([key, status]) => {
        const [programId, programInstance] = key.split('::');
        return { programId, programInstance, status };
      }),
      projection: { assignment, units: [], sessions: [], works: [], nowIso: NOW },
    })) };
    const tokens = { put: vi.fn(async () => {}), liveAccessCodes: vi.fn(async () => []) };
    const useCase = new BuildAgenda({
      curriculum: {}, assignments: {}, sessions: {}, tokens, planProjection, selfService: { enabled: true },
      launchers: new Map([['flashcards', { locationHint: 'on the Portal' }]]),
      clock: () => new Date(NOW), timezone: 'America/Los_Angeles',
    });
    return { useCase, tokens };
  }

  it('mints a language code that names the flashcards program', async () => {
    const { useCase, tokens } = build();
    await useCase.execute({ learnerId: 'test-learner', learnerName: 'Test' });
    const record = tokens.put.mock.calls.map(([r]) => r)
      .find((r) => r.tokenClass === 'subject_next' && r.subject?.subject === 'language');
    expect(record).toBeDefined();
    expect(record.subject).toEqual({ learnerId: 'test-learner', subject: 'language', program: 'flashcards' });
    expect(record.accessCode).toMatch(/^\d{6}$/);
  });

  it('prints a Done-railed card with that code, and keeps the day in the Done tally', async () => {
    const { useCase, tokens } = build();
    const { document, mintedTokens } = await useCase.execute({ learnerId: 'test-learner', learnerName: 'Test' });
    const record = tokens.put.mock.calls.map(([r]) => r)
      .find((r) => r.subject?.subject === 'language');
    const card = document.blocks.find((b) => b.type === 'scan_action' && b.action === record.token);
    expect(card).toBeDefined();
    expect(card.rail).toBe('Done');
    expect(card.panelCode).toBe(record.accessCode);
    expect(card.meta).toBe('ON THE PORTAL');
    expect(card.taxonomy?.course).toBe('UBKS 비둘기');
    // Credit untouched: the subject is still in the done tally.
    const done = document.blocks.find((b) => b.type === 'done_summary');
    expect(done.entries.map((e) => e.subject)).toContain('language');
    // A going-again card is an invitation, not owed work.
    expect(done.label).toBe('All done today');
    // Handed back if the print is suppressed, like every other live code.
    expect(mintedTokens).toContain(record.token);
  });
});
