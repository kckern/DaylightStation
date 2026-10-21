import { describe, it, expect, vi } from 'vitest';
import { OpenBankAtPanel, BANK_PROGRAM } from "./OpenBankAtPanel.mjs";

function fixture(extra = {}) {
  const roster = vi.fn(async () => [{ id: 'child' }, { id: 'sibling' }]);
  const logger = { info: vi.fn() };
  const service = new OpenBankAtPanel({ roster, target: { deviceId: 'tablet', screenId: 'portal' }, logger, ...extra });
  return { service, roster, logger };
}

const refusal = async (promise) => {
  try { await promise; return null; } catch (error) { return { status: error.status, message: error.message }; }
};

describe('OpenBankAtPanel', () => {
  it('opens a rostered learner\'s bank at the panel: program and learner, nothing minted', async () => {
    const { launchTarget } = await fixture().service.open({ screenId: 'portal', learnerId: 'child' });
    expect(launchTarget).toEqual({ kind: 'program', program: BANK_PROGRAM, learnerId: 'child' });
  });

  it('is not a question bank target: `kind: bank` already means a quiz', async () => {
    const { launchTarget } = await fixture().service.open({ screenId: 'portal', learnerId: 'child' });
    expect(launchTarget.kind).not.toBe('bank');
  });

  it('refuses a learner who is not on the current roster', async () => {
    const f = fixture();
    expect(await refusal(f.service.open({ screenId: 'portal', learnerId: 'ghost' }))).toMatchObject({ status: 403 });
    expect(f.logger.info).not.toHaveBeenCalled();
  });

  it('refuses when no School panel is configured, before asking the roster', async () => {
    const f = fixture({ target: null });
    expect(await refusal(f.service.open({ screenId: 'portal', learnerId: 'child' }))).toMatchObject({ status: 503 });
    expect(f.roster).not.toHaveBeenCalled();
  });

  it('opens from any screen the School app runs on, as the shelf door does', async () => {
    const { launchTarget } = await fixture().service.open({ screenId: 'browser', learnerId: 'child' });
    expect(launchTarget.learnerId).toBe('child');
  });

  it('refuses a missing learner without asking the roster', async () => {
    const f = fixture();
    expect(await refusal(f.service.open({ screenId: 'portal' }))).toMatchObject({ status: 400 });
    expect(f.roster).not.toHaveBeenCalled();
  });

  it('logs the opening by learner and screen', async () => {
    const f = fixture();
    await f.service.open({ screenId: 'portal', learnerId: 'child' });
    expect(f.logger.info).toHaveBeenCalledWith('school.bank.panel-opened', { screenId: 'portal', learnerId: 'child' });
  });
});
