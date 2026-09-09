import { describe, it, expect, vi } from 'vitest';
import { OpenBookShelfAtPanel } from './OpenBookShelfAtPanel.mjs';
import { HmacSchoolBookGrantIssuer } from '#adapters/school/actions/HmacSchoolBookGrantIssuer.mjs';

const KEY = 'test-only-secret-key-32-bytes-long-enough';
const TTL = 20 * 60_000;

function fixture(extra = {}) {
  let now = 1_000_000;
  const grants = new HmacSchoolBookGrantIssuer({ key: KEY, clock: () => now, ttlMs: TTL });
  const issueLaunchTarget = vi.fn(({ userId }) => ({
    kind: 'program', program: 'book-log', learnerId: userId, bookGrant: grants.issue({ learnerId: userId }),
  }));
  const roster = vi.fn(async () => [{ id: 'child' }, { id: 'sibling' }]);
  const service = new OpenBookShelfAtPanel({
    roster, issueLaunchTarget, target: { deviceId: 'tablet', screenId: 'portal' }, ...extra,
  });
  return { service, grants, issueLaunchTarget, roster, advance: (ms) => { now += ms; } };
}

const refusal = async (promise) => {
  try { await promise; return null; } catch (error) { return { status: error.status, message: error.message }; }
};

describe('OpenBookShelfAtPanel', () => {
  it('opens a shelf for a rostered learner at the panel, with no book and no code', async () => {
    const f = fixture();
    const result = await f.service.open({ screenId: 'portal', learnerId: 'child' });
    expect(result.launchTarget).toMatchObject({ kind: 'program', program: 'book-log', learnerId: 'child' });
    expect(f.grants.verify(result.launchTarget.bookGrant, { learnerId: 'child' }).ok).toBe(true);
    // Nothing was scanned, so nothing seeds the shelf: the child types it.
    expect(result.bookEntry).toBeNull();
  });

  it('mints minutes, not the printed card path’s hours', async () => {
    const f = fixture();
    const { launchTarget } = await f.service.open({ screenId: 'portal', learnerId: 'child' });
    f.advance(TTL - 1_000);
    expect(f.grants.verify(launchTarget.bookGrant, { learnerId: 'child' }).ok).toBe(true);
    f.advance(2_000);
    expect(f.grants.verify(launchTarget.bookGrant, { learnerId: 'child' })).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('refuses a learner who is not on the current roster', async () => {
    const f = fixture();
    expect(await refusal(f.service.open({ screenId: 'portal', learnerId: 'ghost' })))
      .toMatchObject({ status: 403 });
    expect(f.issueLaunchTarget).not.toHaveBeenCalled();
  });

  it('refuses a screen that is not the household’s school panel', async () => {
    const f = fixture();
    expect(await refusal(f.service.open({ screenId: 'livingroom-tv', learnerId: 'child' })))
      .toMatchObject({ status: 403 });
    // The roster is not even read: the screen decides first, and it is the
    // server's own answer, never the client's claim about itself.
    expect(f.roster).not.toHaveBeenCalled();
    expect(f.issueLaunchTarget).not.toHaveBeenCalled();
  });

  it('refuses when no panel is configured, rather than opening anywhere', async () => {
    const f = fixture({ target: null });
    expect(await refusal(f.service.open({ screenId: 'portal', learnerId: 'child' })))
      .toMatchObject({ status: 503 });
    expect(f.issueLaunchTarget).not.toHaveBeenCalled();
  });

  it('refuses a missing learner without asking the roster', async () => {
    const f = fixture();
    expect(await refusal(f.service.open({ screenId: 'portal' }))).toMatchObject({ status: 400 });
    expect(f.roster).not.toHaveBeenCalled();
  });
});
