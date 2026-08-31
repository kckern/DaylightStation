import { describe, expect, it, vi } from 'vitest';
import { ReplaceRemediation } from './ReplaceRemediation.mjs';
import {
  FakeSessionRepository,
  fakeClock,
  silentLogger,
} from '../../../../../tests/_lib/school/lifecycleFakes.mjs';

const PARENT = 'ses_failed';
const RETRY = 'ses_retry';

async function failedWithRetry(sessions, clock, { retryState = 'issued' } = {}) {
  const append = (sessionId, type, payload = {}) => sessions.appendEvent(sessionId, {
    type, at: clock.iso(), sessionId, ...payload,
  });
  await append(PARENT, 'created', { learnerId: 'milo', unitId: 'place-value' });
  await append(PARENT, 'issued', { artifactId: 'art_failed' });
  await append(PARENT, 'submitted', { transport: 'paper' });
  await append(PARENT, 'graded', { attemptIds: ['att_1'], percent: 50, missedItemIds: ['q2', 'q4', 'q6'] });
  await append(PARENT, 'outcome_recorded', { outcomeId: `out:${PARENT}`, result: 'needs_remediation' });
  await append(PARENT, 'remediation_opened', { newSessionId: RETRY, variant: 1 });
  await append(RETRY, 'created', {
    learnerId: 'milo', unitId: 'place-value', remediationOf: PARENT,
    remediationItemIds: ['q2', 'q4', 'q6'], variant: 1,
  });
  if (retryState !== 'created') await append(RETRY, 'issued', { artifactId: 'art_retry' });
  if (retryState === 'submitted') await append(RETRY, 'submitted', { transport: 'paper' });
}

function harness() {
  const sessions = new FakeSessionRepository();
  const clock = fakeClock('2026-08-31T10:00:00.000Z');
  const teacherGate = { assert: vi.fn() };
  let next = 0;
  const useCase = new ReplaceRemediation({
    curriculum: { getUnit: vi.fn(async () => ({ retry: { variants: 12 } })) },
    sessions, teacherGate, clock: clock.now,
    newSessionId: () => `ses_replacement_${++next}`,
    logger: silentLogger,
  });
  return { sessions, clock, teacherGate, useCase };
}

describe('ReplaceRemediation', () => {
  it('creates a corrected sibling before abandoning an issued but unworked retry', async () => {
    const h = harness();
    await failedWithRetry(h.sessions, h.clock);
    const result = await h.useCase.execute({
      sessionId: PARENT, currentSessionId: RETRY,
      reason: 'the worksheet wording and worked example were corrected',
      replacedBy: 'parent', pin: '7410', idempotencyKey: 'repair-milo-place-value-v2',
    });

    expect(result).toMatchObject({
      status: 'replaced', previousSessionId: RETRY,
      newSessionId: 'ses_replacement_1', variant: 2,
    });
    expect(h.teacherGate.assert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'parent', pin: '7410', action: 'sessions.remediation.replace',
    }));
    expect(h.sessions.derive('ses_replacement_1')).toMatchObject({
      state: 'created', terminal: false, learnerId: 'milo', unitId: 'place-value',
      remediationOf: PARENT, replacesSessionId: RETRY,
      replacementKey: 'repair-milo-place-value-v2', variant: 2,
      remediationItemIds: ['q2', 'q4', 'q6'],
    });
    expect(h.sessions.derive(RETRY)).toMatchObject({ state: 'abandoned', terminal: true });
    expect(h.sessions.derive(PARENT)).toMatchObject({
      state: 'remediation_opened', terminal: true,
      remediation: { newSessionId: 'ses_replacement_1', variant: 2 },
    });
  });

  it('is idempotent and finishes an interrupted old-session abandonment', async () => {
    const h = harness();
    await failedWithRetry(h.sessions, h.clock);
    const args = {
      sessionId: PARENT, currentSessionId: RETRY, reason: 'corrected wording',
      replacedBy: 'parent', pin: '7410', idempotencyKey: 'same-request',
    };
    const first = await h.useCase.execute(args);
    const second = await h.useCase.execute(args);
    expect(first.newSessionId).toBe('ses_replacement_1');
    expect(second).toMatchObject({ status: 'already_replaced', newSessionId: 'ses_replacement_1' });
    expect(h.sessions.ids()).toEqual([PARENT, RETRY, 'ses_replacement_1']);
  });

  it('refuses to replace a retry after the learner submitted it', async () => {
    const h = harness();
    await failedWithRetry(h.sessions, h.clock, { retryState: 'submitted' });
    await expect(h.useCase.execute({
      sessionId: PARENT, currentSessionId: RETRY, reason: 'changed content',
      replacedBy: 'parent', pin: '7410', idempotencyKey: 'too-late',
    })).rejects.toThrow(/learner evidence|submitted/iu);
    expect(h.sessions.ids()).toEqual([PARENT, RETRY]);
    expect(h.sessions.derive(RETRY).state).toBe('submitted');
  });
});
