// @vitest-environment node
/**
 * OpenRemediation — the cap (failure policy: two rounds, then a grown-up).
 *
 * The original sheet is round 0; each retry it opens is one round deeper. A
 * child asking for a third fresh sheet is refused and the refusal is logged;
 * a grown-up opening one on purpose (`openedBy`, behind the teacher gate) is
 * not — the hold exists to bring a person in, not to lock them out.
 */
import { describe, it, expect, vi } from 'vitest';
import { OpenRemediation } from "./OpenRemediation.mjs";
import { FakeSessionRepository } from "../../../../../../tests/_lib/school/lifecycleFakes.mjs";

const LEARNER = 'kid1';
const UNIT = 'math.01';

async function fail(sessions, sessionId, remediationOf = null) {
  await sessions.appendEvent(sessionId, { type: 'created', at: '2026-09-26T09:00:00.000Z', learnerId: LEARNER, unitId: UNIT,
    ...(remediationOf ? { remediationOf } : {}) });
  await sessions.appendEvent(sessionId, { type: 'launch_dispatched', at: '2026-09-26T09:01:00.000Z', surface: 'portal' });
  await sessions.appendEvent(sessionId, { type: 'outcome_recorded', at: '2026-09-26T09:02:00.000Z', outcomeId: `out_${sessionId}`, result: 'needs_remediation' });
}

function build({ maxRounds } = {}) {
  const sessions = new FakeSessionRepository();
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
  let n = 0;
  const useCase = new OpenRemediation({
    curriculum: { getUnit: async () => ({ unitId: UNIT, retry: { variants: 3 } }) },
    sessions, logger, newSessionId: () => `ses_new${(n += 1)}`,
    clock: () => new Date('2026-09-29T16:00:00.000Z'),
    ...(maxRounds ? { remediationMaxRounds: maxRounds } : {}),
  });
  return { sessions, logger, useCase };
}

describe('OpenRemediation — remediation cap', () => {
  it('opens round 1 from the original and round 2 from the first retry', async () => {
    const { sessions, useCase } = build();
    await fail(sessions, 'ses_0');
    expect((await useCase.execute({ sessionId: 'ses_0' })).status).toBe('opened');
    await fail(sessions, 'ses_1', 'ses_0');
    expect((await useCase.execute({ sessionId: 'ses_1' })).status).toBe('opened');
  });

  it('refuses a third round for the child, opens nothing, and logs it', async () => {
    const { sessions, logger, useCase } = build();
    await fail(sessions, 'ses_0');
    await fail(sessions, 'ses_1', 'ses_0');
    await fail(sessions, 'ses_2', 'ses_1');
    const result = await useCase.execute({ sessionId: 'ses_2' });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'remediation_capped', newSessionId: null });
    expect(result.message).toMatch(/grown-up/);
    expect(await sessions.readEvents('ses_new1')).toEqual([]);
    expect((await sessions.readEvents('ses_2')).map((e) => e.type)).not.toContain('remediation_opened');
    expect(logger.info).toHaveBeenCalledWith('school.remediation.capped', { learnerId: LEARNER, unitId: UNIT, depth: 2, sessionId: 'ses_2', maxRounds: 2 });
  });

  it('a grown-up can still open one past the cap', async () => {
    const { sessions, useCase } = build();
    await fail(sessions, 'ses_0');
    await fail(sessions, 'ses_1', 'ses_0');
    await fail(sessions, 'ses_2', 'ses_1');
    expect((await useCase.execute({ sessionId: 'ses_2', openedBy: 'parent1' })).status).toBe('opened');
  });

  it('honours a configured cap', async () => {
    const { sessions, useCase } = build({ maxRounds: 3 });
    await fail(sessions, 'ses_0');
    await fail(sessions, 'ses_1', 'ses_0');
    await fail(sessions, 'ses_2', 'ses_1');
    expect((await useCase.execute({ sessionId: 'ses_2' })).status).toBe('opened');
  });
});
