// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { ResolveScanAction } from "./ResolveScanAction.mjs";
import { mintToken } from "../../domain/sessions/tokens.mjs";

const NOW = new Date('2026-09-10T18:00:00.000Z');
const record = mintToken({
  tokenClass: 'makeup_print', subject: { learnerId: 'kid' },
  at: '2026-09-10T15:00:00.000Z', rng: () => 0.5, expiresAt: '2026-09-13T11:00:00.000Z',
});

function build(printMakeupAgenda) {
  const receipts = { print: vi.fn(async () => ({ printed: true })) };
  const noop = { execute: vi.fn() };
  const useCase = new ResolveScanAction({
    tokens: { get: vi.fn(async (t) => (t === record.token ? record : null)) },
    sessions: { readEvents: vi.fn(async () => []) },
    curriculum: {}, resolvePersonalCard: noop, issueDocument: noop, dispatchMedia: noop, openRemediation: noop,
    receipts, printMakeupAgenda, clock: () => NOW, logger: { info() {}, warn() {} },
  });
  return { useCase, receipts };
}

const headline = (receipts) => receipts.print.mock.calls[0]?.[0]?.blocks?.[0]?.md;

describe('ResolveScanAction makeup_print', () => {
  it('prints the makeup sheet for the ticket\'s learner', async () => {
    const printMakeupAgenda = { execute: vi.fn(async () => ({ printed: true, subjects: ['math'], days: ['2026-09-07'] })) };
    const { useCase, receipts } = build(printMakeupAgenda);
    const out = await useCase.execute({ code: record.token });
    expect(printMakeupAgenda.execute).toHaveBeenCalledWith({ learnerId: 'kid' });
    expect(out).toMatchObject({ status: 'issued', tokenClass: 'makeup_print', printed: true, message: 'Printing your makeup sheet.' });
    expect(receipts.print).not.toHaveBeenCalled();
  });

  it('nothing owed prints a slip saying so', async () => {
    const { useCase, receipts } = build({ execute: vi.fn(async () => ({ printed: false, reason: 'nothing_to_make_up' })) });
    const out = await useCase.execute({ code: record.token });
    expect(out).toMatchObject({ status: 'already_done', physical: 'receipt', message: 'Nothing to make up.' });
    expect(headline(receipts)).toBe('# Nothing to make up');
  });

  it('a printer failure prints a slip, never silence', async () => {
    const { useCase, receipts } = build({ execute: vi.fn(async () => { throw new Error('offline'); }) });
    const out = await useCase.execute({ code: record.token });
    expect(out.status).toBe('print_failed');
    expect(headline(receipts)).toBe('# The printer did not answer');
  });

  it('unwired: the standard could-not-use slip', async () => {
    const { useCase } = build(null);
    expect((await useCase.execute({ code: record.token })).status).toBe('unsupported');
  });
});

describe('ResolveScanAction subject_next from a makeup sheet', () => {
  const ticket = (subject) => mintToken({
    tokenClass: 'subject_next', subject: { learnerId: 'kid', subject: 'math', continueToday: true, ...subject },
    at: '2026-09-10T15:00:00.000Z', rng: () => 0.5, expiresAt: '2026-09-13T11:00:00.000Z',
  });

  function buildScan(rec, move) {
    const claimMakeupLesson = { execute: vi.fn(async () => ({ claimed: '2026-09-07', reason: null })) };
    const issueDocument = { execute: vi.fn(async () => ({ status: 'issued', artifactId: 'art_1', pageCount: 1 })) };
    const openRemediation = { execute: vi.fn(async () => ({ status: 'opened', newSessionId: 'ses_retry', variant: 1 })) };
    const useCase = new ResolveScanAction({
      tokens: { get: vi.fn(async (t) => (t === rec.token ? rec : null)) },
      sessions: { readEvents: vi.fn(async () => []) },
      curriculum: { getUnit: vi.fn(async () => null) },
      resolvePersonalCard: { execute: vi.fn() }, issueDocument, dispatchMedia: { execute: vi.fn() }, openRemediation,
      receipts: { print: vi.fn(async () => ({ printed: true })) },
      resolveSubjectNext: { execute: vi.fn(async () => ({ kind: 'move', move: { kind: move }, sessionId: 'ses_a', state: null })) },
      claimMakeupLesson, clock: () => NOW, logger: { info() {}, warn() {} },
    });
    return { useCase, claimMakeupLesson, issueDocument };
  }

  it('a makeup ticket claims the session it prints', async () => {
    const rec = ticket({ makeupFor: ['2026-09-07', '2026-09-09'] });
    const { useCase, claimMakeupLesson, issueDocument } = buildScan(rec, 'print');
    await useCase.execute({ code: rec.token });
    expect(claimMakeupLesson.execute).toHaveBeenCalledWith({
      sessionId: 'ses_a', learnerId: 'kid', subject: 'math', forDays: ['2026-09-07', '2026-09-09'],
    });
    expect(issueDocument.execute).toHaveBeenCalledWith({ sessionId: 'ses_a' });
  });

  it('an ordinary ticket claims nothing', async () => {
    const rec = ticket({});
    const { useCase, claimMakeupLesson } = buildScan(rec, 'print');
    await useCase.execute({ code: rec.token });
    expect(claimMakeupLesson.execute).not.toHaveBeenCalled();
  });

  it('a retry move never claims', async () => {
    const rec = ticket({ makeupFor: ['2026-09-07'] });
    const { useCase, claimMakeupLesson } = buildScan(rec, 'retry');
    await useCase.execute({ code: rec.token });
    expect(claimMakeupLesson.execute).not.toHaveBeenCalled();
  });
});
