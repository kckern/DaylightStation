// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { PrintMakeupAgenda } from "./PrintMakeupAgenda.mjs";
import { validateDocument } from "../../domain/documents/documentValidation.mjs";

const MON = '2026-09-07'; const WED = '2026-09-09';
const NOW = new Date('2026-09-10T18:00:00.000Z'); // Thu 11:00 PDT

function seededRng(seed = 7) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function build({ work, printed = true, peek = null, selfService = { enabled: true } } = {}) {
  const put = [];
  const tokens = { put: vi.fn(async (r) => put.push(r)), liveAccessCodes: vi.fn(async () => []) };
  const receipts = { print: vi.fn(async () => ({ printed })) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const useCase = new PrintMakeupAgenda({
    getMakeupWork: { execute: vi.fn(async () => work) },
    tokens, receipts, logger, selfService,
    resolveSubjectNext: peek ? { peek } : null,
    roster: { displayName: () => 'Test Learner' },
    timezone: 'America/Los_Angeles', clock: () => NOW, rng: seededRng(),
  });
  return { useCase, put, receipts, logger };
}

const WORK = {
  deadline: '2026-09-12',
  items: [{ day: MON, subject: 'math' }, { day: WED, subject: 'english' }, { day: WED, subject: 'math' }],
};

describe('PrintMakeupAgenda', () => {
  it('nothing owed: prints nothing', async () => {
    const { useCase, receipts } = build({ work: { deadline: null, items: [] } });
    expect(await useCase.execute({ learnerId: 'kid' })).toEqual({ printed: false, reason: 'nothing_to_make_up' });
    expect(receipts.print).not.toHaveBeenCalled();
  });

  it('mints one continueToday subject_next ticket per subject, living until the deadline day ends', async () => {
    const { useCase, put, receipts, logger } = build({ work: WORK });
    const out = await useCase.execute({ learnerId: 'kid' });
    expect(out).toMatchObject({ printed: true, subjects: ['math', 'english'], days: [MON, WED] });
    expect(put).toHaveLength(2);
    const math = put.find((r) => r.subject.subject === 'math');
    expect(math).toMatchObject({
      tokenClass: 'subject_next',
      subject: { learnerId: 'kid', subject: 'math', continueToday: true },
      // Sat 2026-09-12 study day ends Sun 04:00 PDT = 11:00Z.
      expiresAt: '2026-09-13T11:00:00.000Z',
      accessCodeExpiresAt: '2026-09-13T11:00:00.000Z',
      maxUses: 6,
    });
    expect(math.accessCode).toMatch(/^\d{6}$/);
    expect(put[0].accessCode).not.toBe(put[1].accessCode);
    const doc = receipts.print.mock.calls[0][0];
    expect(() => validateDocument(doc)).not.toThrow();
    const card = doc.blocks.find((b) => b.type === 'scan_action' && b.action === math.token);
    expect(card).toMatchObject({ rail: 'Makeup · Mon, Wed', panelCode: math.accessCode });
    expect(logger.info).toHaveBeenCalledWith('school.makeup.printed', { learnerId: 'kid', subjects: ['math', 'english'], days: [MON, WED] });
  });

  it('names the program when the subject continues to one', async () => {
    const peek = vi.fn(async ({ subject }) => (subject === 'english'
      ? { kind: 'program', programId: 'book-log' } : { kind: 'move' }));
    const { useCase, put } = build({ work: WORK, peek });
    await useCase.execute({ learnerId: 'kid' });
    expect(put.find((r) => r.subject.subject === 'english').subject.program).toBe('book-log');
    expect(put.find((r) => r.subject.subject === 'math').subject).not.toHaveProperty('program');
  });

  it('without self-service the cards carry no code', async () => {
    const { useCase, put } = build({ work: WORK, selfService: null });
    await useCase.execute({ learnerId: 'kid' });
    expect(put.every((r) => r.accessCode === undefined)).toBe(true);
  });

  it('a printer that does not answer is reported', async () => {
    const { useCase, logger } = build({ work: WORK, printed: false });
    expect(await useCase.execute({ learnerId: 'kid' })).toMatchObject({ printed: false, reason: 'print_failed' });
    expect(logger.warn).toHaveBeenCalledWith('school.makeup.print-failed', expect.objectContaining({ learnerId: 'kid' }));
  });
});
