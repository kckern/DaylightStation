/**
 * The keypad's LAST HOP into a program: `/act` answers `outcome: 'mount'` with
 * an `effect`, and `launchTarget` rebuilds the target SchoolApp's
 * `onPortalLaunch` routes on. The backend puts `{ ...target, programId, unitId,
 * learnerId }` on the wire (`RunSelfServiceAction` → `issueLaunchTarget`), so
 * whatever grant a launcher minted IS in the effect — and a rebuild that
 * copies fields by name drops any it does not know. That is how the reading
 * shelf's `bookGrant` went missing: the card said "Opening it here on the
 * screen", SchoolApp refused a grantless target, and the child got
 * `mount.refused` words. Pinned here, at the hop, with the effect shape the
 * backend really sends.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ act: vi.fn(), resolve: vi.fn() }));

vi.mock('../schoolApi.js', () => ({
  schoolApi: {
    selfServiceResolve: (...args) => h.resolve(...args),
    selfServiceAct: (...args) => h.act(...args),
    selfServicePrinterStatus: vi.fn(),
  },
}));

const log = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('../schoolLog.js', () => ({
  schoolLog: { selfService: vi.fn(), selfServiceError: (...a) => log.error(...a), scan: vi.fn() },
}));

import { HmacSchoolBookGrantIssuer } from '../../../../../backend/src/1_adapters/school/actions/HmacSchoolBookGrantIssuer.mjs';
import { useSelfService } from './useSelfService.js';

const CARD = {
  ok: true, code: '123456',
  context: { learner: { id: 'kid1', displayName: 'Alpha' } },
  actions: [{ kind: 'program', label: 'Open my books', target: 'book-log', role: 'primary' }],
};
const mount = (effect) => ({
  ok: true, status: 200,
  data: { outcome: 'mount', sentence: 'Opening it here on the screen.', effect },
});

async function drive({ effect, onLaunch }) {
  h.resolve.mockResolvedValue({ ok: true, status: 200, data: { ...CARD, actions: [{ kind: 'program', target: effect.programId }] } });
  h.act.mockResolvedValue(mount(effect));
  const { result } = renderHook(() => useSelfService({ idleTimeoutSeconds: 0, claim: vi.fn(), onLaunch }));
  await act(async () => { await result.current.submit('123456'); });
  if (effect.programId !== 'book-log') await act(async () => { await result.current.runAction({ kind: 'program', target: effect.programId }); });
  return result;
}

describe('useSelfService: the /act mount effect reaches onLaunch intact', () => {
  beforeEach(() => { h.act.mockReset(); h.resolve.mockReset(); log.error.mockReset(); });

  it('a book-log effect keeps its bookGrant on the way to onLaunch', async () => {
    const onLaunch = vi.fn(async () => true);
    const result = await drive({
      effect: { kind: 'program', program: 'book-log', programId: 'book-log', unitId: null, learnerId: 'kid1', bookGrant: 'signed-book-grant' },
      onLaunch,
    });

    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(onLaunch.mock.calls[0][0]).toMatchObject({
      kind: 'program', program: 'book-log', learnerId: 'kid1', bookGrant: 'signed-book-grant',
    });
    // Confirmed mount: the card closed onto the keypad, and nobody said "refused".
    expect(result.current.view).toBe('keypad');
    expect(log.error).not.toHaveBeenCalledWith('mount.refused', expect.anything());
  });

  it('an effect with no bookGrant hands over null, never undefined', async () => {
    const onLaunch = vi.fn(async () => false);
    await drive({
      effect: { kind: 'program', program: 'book-log', programId: 'book-log', unitId: null, learnerId: 'kid1' },
      onLaunch,
    });
    expect(onLaunch.mock.calls[0][0]).toHaveProperty('bookGrant', null);
  });

  it('the ladder’s studyGrant still rides the same hop', async () => {
    const onLaunch = vi.fn(async () => true);
    await drive({
      effect: { kind: 'program', program: 'sentence-ladder', programId: 'sentence-ladder', corpusId: 'glossika-korean', learnerId: 'kid1', studyGrant: 'signed-study-grant' },
      onLaunch,
    });
    expect(onLaunch.mock.calls[0][0]).toMatchObject({
      program: 'sentence-ladder', corpusId: 'glossika-korean', studyGrant: 'signed-study-grant', bookGrant: null,
    });
  });
});


describe('reading code goes directly through the authenticated action', () => {
  beforeEach(() => { h.act.mockReset(); h.resolve.mockReset(); });
  const issuer = new HmacSchoolBookGrantIssuer({ key: 'isolated-test-key-for-reading-entry-32bytes' });
  const setup = (confirmIdentity = false) => {
    h.resolve.mockResolvedValue({ ok: true, data: { ...CARD, learner: 'kid1', presentation: { confirmIdentity } } });
    h.act.mockImplementation(async ({ code, action }) => {
      if (code !== '123456' || action !== 'program') return { ok: false };
      return mount({ kind: 'program', programId: 'book-log', learnerId: 'kid1', bookGrant: issuer.issue({ learnerId: 'kid1' }) });
    });
    const onLaunch = vi.fn(async target => issuer.verify(target.bookGrant, { learnerId: target.learnerId }).ok);
    const claim = vi.fn();
    return { ...renderHook(() => useSelfService({ idleTimeoutSeconds: 0, claim, onLaunch })), onLaunch, claim };
  };
  it('opens directly on an authorized matching profile using the server-issued grant once', async () => {
    const { result, onLaunch, claim } = setup();
    await act(async () => { await result.current.submit('123456'); });
    expect(h.act).toHaveBeenCalledExactlyOnceWith({ code: '123456', action: 'program' });
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(issuer.verify(onLaunch.mock.calls[0][0].bookGrant, { learnerId: 'kid1' }).ok).toBe(true);
    expect(claim).toHaveBeenCalledWith('kid1');
    expect(result.current.view).toBe('keypad');
  });
  it('one identity confirmation opens the books; repeated taps do not dispatch twice', async () => {
    const { result, onLaunch, claim } = setup(true);
    await act(async () => { await result.current.submit('123456'); });
    expect(result.current.view).toBe('identity');
    expect(claim).not.toHaveBeenCalled(); expect(onLaunch).not.toHaveBeenCalled();
    await act(async () => { await Promise.all([result.current.confirmIdentity(), result.current.confirmIdentity()]); });
    expect(onLaunch).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);
  });
  it('denying identity claims nobody and launches nothing', async () => {
    const { result, onLaunch, claim } = setup(true);
    await act(async () => { await result.current.submit('123456'); });
    act(() => result.current.denyIdentity());
    expect(result.current.view).toBe('keypad');
    expect(claim).not.toHaveBeenCalled(); expect(h.act).not.toHaveBeenCalled(); expect(onLaunch).not.toHaveBeenCalled();
  });
  it('exit discards a late resolve before the direct action', async () => {
    const { result, onLaunch } = setup();
    let resolve;
    h.resolve.mockReturnValue(new Promise(r => { resolve = r; }));
    let submitted;
    act(() => { submitted = result.current.submit('123456'); });
    act(() => result.current.exit());
    await act(async () => { resolve({ ok: true, data: CARD }); await submitted; });
    expect(h.act).not.toHaveBeenCalled(); expect(onLaunch).not.toHaveBeenCalled();
    expect(result.current.view).toBe('keypad');
  });
  it('exit discards a late act instead of opening the shelf', async () => {
    const { result, onLaunch } = setup();
    let finish;
    h.act.mockReturnValue(new Promise(r => { finish = r; }));
    let submitted;
    await act(async () => { submitted = result.current.submit('123456'); });
    expect(h.act).toHaveBeenCalledTimes(1);
    act(() => result.current.exit());
    await act(async () => { finish(mount({ kind: 'program', programId: 'book-log', bookGrant: issuer.issue({ learnerId: 'kid1' }), learnerId: 'kid1' })); await submitted; });
    expect(onLaunch).not.toHaveBeenCalled(); expect(result.current.view).toBe('keypad');
  });
  it.each([{ kind: 'program', target: 'sentence-ladder' }, { kind: 'print' }])('keeps the explicit action for %j', async action => {
    const { result, onLaunch } = setup();
    h.resolve.mockResolvedValue({ ok: true, data: { ...CARD, actions: [action] } });
    await act(async () => { await result.current.submit('123456'); });
    expect(result.current.view).toBe('card'); expect(h.act).not.toHaveBeenCalled(); expect(onLaunch).not.toHaveBeenCalled();
  });
});
