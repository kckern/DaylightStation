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
    expect(result.message).toBe('After 2 retries, a grown-up will help with this one.');
    expect(await sessions.readEvents('ses_new1')).toEqual([]);
    expect((await sessions.readEvents('ses_2')).map((e) => e.type)).not.toContain('remediation_opened');
    expect(logger.info).toHaveBeenCalledWith('school.remediation.capped', { learnerId: LEARNER, unitId: UNIT, depth: 2, sessionId: 'ses_2', maxRounds: 2 });
  });

  it('tells the child the real number of retries past the cap', async () => {
    const { sessions, useCase } = build();
    await fail(sessions, 'ses_0');
    await fail(sessions, 'ses_1', 'ses_0');
    await fail(sessions, 'ses_2', 'ses_1');
    await fail(sessions, 'ses_3', 'ses_2');
    expect((await useCase.execute({ sessionId: 'ses_3' })).message).toBe('After 3 retries, a grown-up will help with this one.');
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

  it('a STALE failure (unretried for weeks, depth 0) still opens for the child who brings the ticket back', async () => {
    const { sessions } = build();
    await fail(sessions, 'ses_0');
    // `build` runs the clock on 2026-09-29; the failure is from 9/26 and the
    // planner would call it stale after three school days. The retry is the
    // child coming back — the stale hold only stops it being owed.
    const later = new OpenRemediation({
      curriculum: { getUnit: async () => ({ unitId: UNIT, retry: { variants: 3 } }) },
      sessions, logger: { info() {} }, newSessionId: () => 'ses_late',
      clock: () => new Date('2026-10-20T16:00:00.000Z'),
    });
    expect((await later.execute({ sessionId: 'ses_0' })).status).toBe('opened');
  });

  it('stops reading the lineage a few rounds past the cap', async () => {
    const { sessions, useCase } = build();
    await fail(sessions, 'ses_0');
    for (let n = 1; n <= 6; n += 1) await fail(sessions, `ses_${n}`, `ses_${n - 1}`);
    const reads = vi.spyOn(sessions, 'readEvents');
    expect((await useCase.execute({ sessionId: 'ses_6' })).status).toBe('unavailable');
    // Cap 2 plus headroom 3: ses_5 back to ses_1 are walked — never ses_0.
    expect(reads.mock.calls.map(([id]) => id)).not.toContain('ses_0');
  });

  it('a lineage that loops back on itself ends instead of hanging', async () => {
    const { sessions, useCase } = build({ maxRounds: 9 });
    await fail(sessions, 'ses_a', 'ses_c');
    await fail(sessions, 'ses_b', 'ses_a');
    await fail(sessions, 'ses_c', 'ses_b');
    expect((await useCase.execute({ sessionId: 'ses_c' })).status).toBe('opened');
  });
});
