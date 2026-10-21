import { describe, it, expect, vi } from 'vitest';
import { OpenBankAtPanel, BANK_PROGRAM } from "./OpenBankAtPanel.mjs";
import { HmacSchoolBankGrantIssuer } from "../../adapters/actions/HmacSchoolBankGrantIssuer.mjs";
import { HmacSchoolBookGrantIssuer } from "../../adapters/actions/HmacSchoolBookGrantIssuer.mjs";

const KEY = 'test-only-secret-key-32-bytes-long-enough';
const TTL = 10 * 60_000;

function fixture(extra = {}) {
  let now = 1_000_000;
  const grants = new HmacSchoolBankGrantIssuer({ key: KEY, clock: () => now, ttlMs: TTL });
  const roster = vi.fn(async () => [{ id: 'child' }, { id: 'sibling' }]);
  const logger = { info: vi.fn() };
  const service = new OpenBankAtPanel({
    roster, grants, target: { deviceId: 'tablet', screenId: 'portal' }, logger, ...extra,
  });
  return { service, grants, roster, logger, advance: (ms) => { now += ms; } };
}

const refusal = async (promise) => {
  try { await promise; return null; } catch (error) { return { status: error.status, message: error.message }; }
};

describe('OpenBankAtPanel', () => {
  it('opens a rostered learner\'s bank at the panel with a bank grant for that learner', async () => {
    const f = fixture();
    const { launchTarget } = await f.service.open({ screenId: 'portal', learnerId: 'child' });
    expect(launchTarget).toMatchObject({ kind: 'program', program: BANK_PROGRAM, learnerId: 'child' });
    expect(f.grants.verify(launchTarget.bankGrant, { learnerId: 'child' }).ok).toBe(true);
    expect(f.grants.verify(launchTarget.bankGrant, { learnerId: 'sibling' }).ok).toBe(false);
  });

  it('is not a question bank target: `kind: bank` already means a quiz', async () => {
    const { launchTarget } = await fixture().service.open({ screenId: 'portal', learnerId: 'child' });
    expect(launchTarget.kind).not.toBe('bank');
  });

  it('mints minutes: the grant dies at the TTL', async () => {
    const f = fixture();
    const { launchTarget } = await f.service.open({ screenId: 'portal', learnerId: 'child' });
    f.advance(TTL - 1_000);
    expect(f.grants.verify(launchTarget.bankGrant, { learnerId: 'child' }).ok).toBe(true);
    f.advance(2_000);
    expect(f.grants.verify(launchTarget.bankGrant, { learnerId: 'child' })).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('a bank grant opens no shelf, and a shelf grant opens no bank', async () => {
    const f = fixture();
    const books = new HmacSchoolBookGrantIssuer({ key: KEY });
    const { launchTarget } = await f.service.open({ screenId: 'portal', learnerId: 'child' });
    expect(books.verify(launchTarget.bankGrant, { learnerId: 'child' }).ok).toBe(false);
    expect(f.grants.verify(books.issue({ learnerId: 'child' }), { learnerId: 'child' }).ok).toBe(false);
  });

  it('refuses a learner who is not on the current roster, and mints nothing', async () => {
    const f = fixture();
    const issue = vi.spyOn(f.grants, 'issue');
    expect(await refusal(f.service.open({ screenId: 'portal', learnerId: 'ghost' }))).toMatchObject({ status: 403 });
    expect(issue).not.toHaveBeenCalled();
  });

  it('refuses when no School panel is configured, before asking the roster', async () => {
    const f = fixture({ target: null });
    expect(await refusal(f.service.open({ screenId: 'portal', learnerId: 'child' }))).toMatchObject({ status: 503 });
    expect(f.roster).not.toHaveBeenCalled();
  });

  it('opens from any screen the School app runs on, as the shelf door does', async () => {
    const f = fixture();
    const { launchTarget } = await f.service.open({ screenId: 'browser', learnerId: 'child' });
    expect(f.grants.verify(launchTarget.bankGrant, { learnerId: 'child' }).ok).toBe(true);
  });

  it('refuses a missing learner without asking the roster', async () => {
    const f = fixture();
    expect(await refusal(f.service.open({ screenId: 'portal' }))).toMatchObject({ status: 400 });
    expect(f.roster).not.toHaveBeenCalled();
  });

  it('logs the opening by learner and screen, never the grant', async () => {
    const f = fixture();
    const { launchTarget } = await f.service.open({ screenId: 'portal', learnerId: 'child' });
    expect(f.logger.info).toHaveBeenCalledWith('school.bank.panel-opened', { screenId: 'portal', learnerId: 'child' });
    expect(JSON.stringify(f.logger.info.mock.calls)).not.toContain(launchTarget.bankGrant);
  });
});
