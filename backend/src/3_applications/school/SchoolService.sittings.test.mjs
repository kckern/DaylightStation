/**
 * Mid-quiz resumability via server-side sittings (prod-hardening Task 17).
 * A sitting is a CONVENIENCE, not evidence: the attempt log stays the record;
 * the sitting only lets a dropped quiz pick up where it left off.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SchoolService } from './SchoolService.mjs';
import { YamlSittingStore } from '../../1_adapters/persistence/yaml/YamlSittingStore.mjs';

const bank = {
  id: 'generated:caps', title: 'Caps', audience: 'generic',
  items: [
    { id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] },
    { id: 'q2', type: 'multiple_choice', prompt: 'OR?', answer: 'Salem', choices: ['Salem', 'Boise'] },
    { id: 'q3', type: 'multiple_choice', prompt: 'ID?', answer: 'Boise', choices: ['Salem', 'Boise'] },
  ],
};
// Same id, different content — bankContentRev must differ.
const editedBank = {
  ...bank,
  items: [bank.items[0], bank.items[1], { ...bank.items[2], answer: 'Salem' }],
};

let tmp;
let nowMs;
let attempts;

const HOUR = 60 * 60 * 1000;

function makeService({ bankDoc = bank, sittings = 'wired' } = {}) {
  const configService = {
    getUserProfile: (id) => (id === 'u1' ? { id } : null),
    getUserDir: (id) => path.join(tmp, 'users', id),
  };
  const ds = {
    readBankRaw: () => null,
    readAllBankRaws: async () => [],
    readAllAttempts: () => attempts,
    appendAttempt: (uid, a) => { attempts.push(a); return { ok: true }; },
    readQuizRequests: () => [],
  };
  const users = { getProfile: (id) => (id === 'u1' ? { id: 'u1' } : null), getHouseholdRoster: () => [{ id: 'u1' }] };
  const store = sittings === 'wired'
    ? new YamlSittingStore({ configService, logger: { warn() {}, info() {} } })
    : null;
  const svc = new SchoolService({
    datastore: ds,
    userService: users,
    logger: { info() {}, warn() {}, error() {} },
    now: () => nowMs,
    bankSources: [{ resolve: (id) => (id === bankDoc.id ? bankDoc : null), listSummaries: () => [] }],
    sittings: store,
  });
  return { svc, store };
}

function sittingsFile() {
  return path.join(tmp, 'users', 'u1', 'apps', 'school', 'sittings.yml');
}

function answerN(svc, sessionId, n, { from = 0, wrongAt = [] } = {}) {
  for (let i = from; i < from + n; i += 1) {
    const item = bank.items[i];
    svc.answer({ sessionId, itemId: item.id, given: wrongAt.includes(i) ? bank.items[(i + 1) % 3].answer : item.answer });
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sittings-'));
  nowMs = 1_700_000_000_000;
  attempts = [];
});

afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('SchoolService sittings (mid-quiz resume)', () => {
  it('answer 2 of 3, drop the session, reopen (new service, same store dir) → resume with score/outcomes; 3rd answer completes and CLEARS', () => {
    const { svc } = makeService();
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    // q1 right, q2 wrong
    svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' });
    svc.answer({ sessionId, itemId: 'q2', given: 'Boise' });

    // Restart: a brand-new service instance over the same sitting-store dir.
    const { svc: svc2 } = makeService();
    const reopened = svc2.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(reopened.resume).toEqual({
      answeredItemIds: ['q1', 'q2'],
      score: 1,
      outcomes: [true, false],
    });

    // Third answer completes the bank — sitting is deleted.
    svc2.answer({ sessionId: reopened.sessionId, itemId: 'q3', given: 'Boise' });
    const { svc: svc3 } = makeService();
    const again = svc3.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(again.resume).toBeUndefined();
  });

  it('re-answering an already-answered item in a resumed sitting is REFUSED', () => {
    const { svc } = makeService();
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' });
    const { svc: svc2 } = makeService();
    const reopened = svc2.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(reopened.resume.answeredItemIds).toEqual(['q1']);
    expect(() => svc2.answer({ sessionId: reopened.sessionId, itemId: 'q1', given: 'Olympia' }))
      .toThrow(/already answered in this sitting/);
    // The refusal recorded nothing new.
    expect(attempts.filter((a) => a.itemId === 'q1')).toHaveLength(1);
  });

  it('fresh:true wipes the sitting and answers no resume', () => {
    const { svc } = makeService();
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    answerN(svc, sessionId, 2);
    const { svc: svc2 } = makeService();
    const freshOpen = svc2.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz', fresh: true });
    expect(freshOpen.resume).toBeUndefined();
    // The wipe is durable: a later plain open sees nothing either.
    const { svc: svc3 } = makeService();
    expect(svc3.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' }).resume).toBeUndefined();
  });

  it('guests never write sittings', () => {
    const { svc } = makeService();
    const { sessionId } = svc.openSession({ userId: null, bankId: bank.id, mode: 'quiz' });
    svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' });
    expect(fs.existsSync(sittingsFile())).toBe(false);
  });

  it('flashcard mode never writes sittings', () => {
    const { svc } = makeService();
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'flashcard' });
    svc.answer({ sessionId, itemId: 'q1', selfGrade: 'correct' });
    expect(fs.existsSync(sittingsFile())).toBe(false);
  });

  it('a >24h-old sitting is ignored on open and replaced by the new run', () => {
    const { svc } = makeService();
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    svc.answer({ sessionId, itemId: 'q1', given: 'Seattle' }); // WRONG — marks the stale run

    nowMs += 25 * HOUR;
    const { svc: svc2 } = makeService();
    const reopened = svc2.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(reopened.resume).toBeUndefined();
    // The un-resumed runner restarts at q1; its first answer REPLACES the
    // stale sitting — proven by the outcome flipping to the new run's true.
    svc2.answer({ sessionId: reopened.sessionId, itemId: 'q1', given: 'Olympia' });
    const { svc: svc3 } = makeService();
    const third = svc3.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(third.resume).toEqual({ answeredItemIds: ['q1'], score: 1, outcomes: [true] });
  });

  it('a bankRev mismatch (bank edited since) ignores the sitting', () => {
    const { svc } = makeService();
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    answerN(svc, sessionId, 2);
    const { svc: svc2 } = makeService({ bankDoc: editedBank });
    const reopened = svc2.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(reopened.resume).toBeUndefined();
  });

  it('a corrupt sittings file is treated as none, and writes are refused (warn, never fail the answer)', () => {
    fs.mkdirSync(path.dirname(sittingsFile()), { recursive: true });
    fs.writeFileSync(sittingsFile(), '{{{{ not: yaml', 'utf8');
    const { svc } = makeService();
    const opened = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(opened.resume).toBeUndefined();
    // The answer still records the attempt — sitting persistence is best-effort.
    const res = svc.answer({ sessionId: opened.sessionId, itemId: 'q1', given: 'Olympia' });
    expect(res.correct).toBe(true);
    expect(attempts).toHaveLength(1);
    // The corrupt file was NOT clobbered.
    expect(fs.readFileSync(sittingsFile(), 'utf8')).toBe('{{{{ not: yaml');
  });

  it('a gap sitting ([q1, q3] — an append failed mid-run) is ignored on open and replaced by the new run', () => {
    // Reproduce the gap exactly as production creates it: the runner advanced
    // past a failed append, so the NEXT recorded answer is not the next item.
    const { svc } = makeService();
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' });
    svc.answer({ sessionId, itemId: 'q3', given: 'Boise' }); // q2's append never landed

    // A non-prefix sitting must NOT resume: index-based resume would land on
    // an already-answered item and refusal-loop until the TTL.
    const { svc: svc2 } = makeService();
    const reopened = svc2.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(reopened.resume).toBeUndefined();

    // The new run replaces the broken sitting from its first answer, and CAN
    // re-answer q1 (the attempt log is append-only; a re-ask is honest).
    svc2.answer({ sessionId: reopened.sessionId, itemId: 'q1', given: 'Olympia' });
    const { svc: svc3 } = makeService();
    const third = svc3.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(third.resume).toEqual({ answeredItemIds: ['q1'], score: 1, outcomes: [true] });
  });

  it('a sitting store whose read() throws is treated as no-sitting — openSession never 500s', () => {
    const { svc, store } = makeService();
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' });
    const { svc: svc2, store: store2 } = makeService();
    store2.read = () => { throw new Error('store exploded'); };
    const reopened = svc2.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(reopened.sessionId).toBeTruthy();
    expect(reopened.resume).toBeUndefined();
  });

  it('paper-transport answers (GradeSubmission machine-grading) neither collide with nor advance a screen sitting', () => {
    const { svc } = makeService();
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' }); // screen sitting holds q1

    // Paper grading opens its own quiz session and marks the SAME item — the
    // paper path dedupes for itself and must not be refused by the sitting.
    const { svc: svc2 } = makeService();
    const grader = svc2.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    const res = svc2.answer({ sessionId: grader.sessionId, itemId: 'q1', given: 'Olympia', transport: 'paper' });
    expect(res.correct).toBe(true);
    svc2.answer({ sessionId: grader.sessionId, itemId: 'q2', given: 'Salem', transport: 'paper' });

    // The screen sitting is untouched: still exactly q1, still resumable.
    const { svc: svc3 } = makeService();
    const reopened = svc3.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    expect(reopened.resume).toEqual({ answeredItemIds: ['q1'], score: 1, outcomes: [true] });
  });

  it('without a sitting store wired, quiz sessions behave exactly as before', () => {
    const { svc } = makeService({ sittings: null });
    const { sessionId } = svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' });
    svc.answer({ sessionId, itemId: 'q1', given: 'Olympia' });
    expect(fs.existsSync(sittingsFile())).toBe(false);
    expect(svc.openSession({ userId: 'u1', bankId: bank.id, mode: 'quiz' }).resume).toBeUndefined();
  });
});
