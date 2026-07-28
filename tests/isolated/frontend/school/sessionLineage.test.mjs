/**
 * Lineage — a failed session and the retry it opened are ONE thread.
 *
 * The session index carries no link between the two, so this reduction over the
 * raw event log is the only thing that keeps a parent from reading two
 * unrelated rows where there was one piece of work. It is a pure function on
 * purpose, so the rule is testable without a DOM.
 */
import { describe, it, expect } from 'vitest';
import { deriveSession, buildThreads } from '#frontend/modules/Admin/School/sessionLineage.js';

const row = (over = {}) => ({
  sessionId: 'ses_1', learnerId: 'learner-two', unitId: 'math-fractions.03',
  state: 'outcome_recorded', terminal: true, outcome: { result: 'passed' },
  day: '2026-07-27', updatedAt: '2026-07-27T12:00:00.000Z', ...over,
});

const ev = (type, over = {}, seq = 1) => ({ type, seq, at: '2026-07-27T10:00:00.000Z', sessionId: 'ses_1', ...over });

describe('deriveSession', () => {
  it('pulls the issued document, attempts and score out of the event log', () => {
    const d = deriveSession(row(), [
      ev('created', { learnerId: 'learner-two', unitId: 'math-fractions.03' }, 1),
      ev('issued', { artifactId: 'art_1' }, 2),
      ev('submitted', { transport: 'paper' }, 3),
      ev('graded', { attemptIds: ['a1', 'a2'], percent: 80 }, 4),
      ev('outcome_recorded', { outcomeId: 'o1', result: 'passed' }, 5),
    ]);

    expect(d.issuedArtifacts).toEqual(['art_1']);
    expect(d.attemptIds).toEqual(['a1', 'a2']);
    expect(d.gradedPercent).toBe(80);
    expect(d.transport).toBe('paper');
    expect(d.outcomeResult).toBe('passed');
  });

  it('counts a reprint without pretending a second document was issued', () => {
    // A reprint REUSES the original artifactId — the count is the only evidence
    // a second sheet came off the printer.
    const d = deriveSession(row(), [
      ev('issued', { artifactId: 'art_1' }, 1),
      ev('reprinted', { artifactId: 'art_1' }, 2),
      ev('reprinted', { artifactId: 'art_1' }, 3),
    ]);

    expect(d.issuedArtifacts).toEqual(['art_1']);
    expect(d.reprints).toBe(2);
    expect(d.issueCount).toBe(3);
  });

  it('reads events in seq order however they arrive', () => {
    const d = deriveSession(row(), [
      ev('graded', { attemptIds: ['a2'], percent: 90 }, 3),
      ev('graded', { attemptIds: ['a1'], percent: 40 }, 2),
      ev('issued', { artifactId: 'art_1' }, 1),
    ]);
    expect(d.gradedPercent).toBe(90);
  });

  it('records both ends of a remediation link', () => {
    const failed = deriveSession(row({ sessionId: 'ses_1' }), [
      ev('remediation_opened', { newSessionId: 'ses_2', variant: 1 }, 5),
    ]);
    const retry = deriveSession(row({ sessionId: 'ses_2' }), [
      ev('created', { remediationOf: 'ses_1', variant: 1 }, 1),
    ]);

    expect(failed.remediationNewSessionId).toBe('ses_2');
    expect(retry.remediationOf).toBe('ses_1');
  });

  it('survives an empty or missing event log rather than throwing', () => {
    expect(deriveSession(row(), []).attemptIds).toEqual([]);
    expect(deriveSession(row(), null).issuedArtifacts).toEqual([]);
    expect(deriveSession(row(), undefined).gradedPercent).toBeNull();
  });
});

describe('buildThreads', () => {
  const failed = deriveSession(
    row({ sessionId: 'ses_1', outcome: { result: 'needs_remediation' }, updatedAt: '2026-07-20T10:00:00.000Z' }),
    [ev('graded', { attemptIds: ['a1'], percent: 40 }, 2), ev('remediation_opened', { newSessionId: 'ses_2' }, 3)],
  );
  const retry = deriveSession(
    row({ sessionId: 'ses_2', updatedAt: '2026-07-27T10:00:00.000Z' }),
    [ev('created', { remediationOf: 'ses_1' }, 1), ev('graded', { attemptIds: ['a2'], percent: 95 }, 2)],
  );

  it('reads a fail and its retry as one thread, oldest attempt first', () => {
    const threads = buildThreads([retry, failed]);

    expect(threads).toHaveLength(1);
    expect(threads[0].map((s) => s.sessionId)).toEqual(['ses_1', 'ses_2']);
  });

  it('a session nobody retried is a thread of one', () => {
    const solo = deriveSession(row({ sessionId: 'ses_9' }), []);
    const threads = buildThreads([solo]);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toHaveLength(1);
  });

  it('chains a third attempt onto the same thread', () => {
    const third = deriveSession(
      row({ sessionId: 'ses_3', updatedAt: '2026-07-28T10:00:00.000Z' }),
      [ev('created', { remediationOf: 'ses_2' }, 1)],
    );
    const threads = buildThreads([failed, retry, third]);
    expect(threads).toHaveLength(1);
    expect(threads[0].map((s) => s.sessionId)).toEqual(['ses_1', 'ses_2', 'ses_3']);
  });

  it('orders threads by their most recent activity', () => {
    const other = deriveSession(row({ sessionId: 'ses_x', unitId: 'art.01', updatedAt: '2026-07-25T10:00:00.000Z' }), []);
    const threads = buildThreads([other, failed, retry]);

    // The fail+retry thread last moved on the 27th; the standalone on the 25th.
    expect(threads[0][0].sessionId).toBe('ses_1');
    expect(threads[1][0].sessionId).toBe('ses_x');
  });

  it('does not hang on a log that points at itself', () => {
    const a = deriveSession(row({ sessionId: 'ses_a' }), [ev('created', { remediationOf: 'ses_b' }, 1)]);
    const b = deriveSession(row({ sessionId: 'ses_b' }), [ev('created', { remediationOf: 'ses_a' }, 1)]);

    const threads = buildThreads([a, b]);
    // Every session is somebody's retry, so there is no root; a truncated view
    // is the right failure, an infinite loop is not.
    expect(Array.isArray(threads)).toBe(true);
    expect(threads.flat().length).toBeLessThanOrEqual(2);
  });

  it('a retry whose original is not in the list still shows as its own thread', () => {
    const orphan = deriveSession(row({ sessionId: 'ses_z' }), [ev('created', { remediationOf: 'ses_gone' }, 1)]);
    const threads = buildThreads([orphan]);
    expect(threads).toHaveLength(1);
    expect(threads[0][0].remediationOf).toBe('ses_gone');
  });
});
