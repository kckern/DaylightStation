import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  response: null, stateGatesHandler: null,
  // STABLE spies, not a fresh pair per call: a logger double rebuilt on every
  // `getLogger()` cannot be asserted against, which is how "was the verdict
  // even recorded?" stayed an unanswerable question.
  log: { warn: vi.fn(), info: vi.fn() },
}));

function entitlement({ decision = 'denied', basisState = 'unsatisfied', learnerId = 'kid-one' } = {}) {
  return {
    items: [{
      capabilityId: 'piano.games', gateId: 'school.day-complete',
      subject: { kind: 'learner', id: learnerId },
      period: { kind: 'interval', id: 'school-day:2026-08-30', startsAt: 0, endsAt: 4_102_444_800_000 },
      decision, basisState, degraded: basisState === 'indeterminate',
    }],
  };
}

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => h.response),
}));
vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (topic, handler) => {
    if (topic === 'state-gates') h.stateGatesHandler = handler;
  },
}));
// Both levels the hook uses. The mock carried only `warn`, which meant a test
// suite could not have caught the hazard that `info` introduced on 2026-08-28:
// a logging call inside the fetch's try block turning a successful read into
// `status: 'error'` — and `error` locks games. A logger double that is missing
// a level the code calls is a double that tests the wrong program.
vi.mock('../../../lib/logging/Logger.js', () => ({
  default: () => ({ child: () => h.log }),
}));

import { DaylightAPI } from '../../../lib/api.mjs';
import useSchoolGameAccess, { completionAllowsGames } from './useSchoolGameAccess.js';

beforeEach(() => {
  h.response = entitlement();
  h.stateGatesHandler = null;
  DaylightAPI.mockClear();
  h.log.warn.mockClear();
  h.log.info.mockClear();
});

afterEach(() => vi.useRealTimers());

describe('completionAllowsGames', () => {
  it.each(['complete', 'no_work_today'])('unlocks for %s', (state) => {
    expect(completionAllowsGames(state)).toBe(true);
  });

  it.each(['incomplete', 'indeterminate', null, 'plan_error'])('does not unlock for %s', (state) => {
    expect(completionAllowsGames(state)).toBe(false);
  });

  // A reward gate that fails OPEN on breakage will eventually pay out on
  // breakage. `indeterminate` is what `resolveDayCompletion` returns when the
  // day could not be judged — a plan error, an unavailable required program, or
  // work blocked by something nothing can reach. On 2026-08-25 a learner's only
  // subject was excused for being broken, his day read `complete`, and his
  // games unlocked. This pins the gate closed on every state that is not
  // positive evidence the day is done.
  it('unlocks on exactly two of the four completion states, and indeterminate is not one', () => {
    const everyCompletionState = ['complete', 'incomplete', 'no_work_today', 'indeterminate'];
    expect(everyCompletionState.filter(completionAllowsGames)).toEqual(['complete', 'no_work_today']);
    expect(completionAllowsGames('indeterminate')).toBe(false);
  });

  it('fails closed for any state it does not recognise', () => {
    expect(completionAllowsGames('probably_fine')).toBe(false);
    expect(completionAllowsGames(undefined)).toBe(false);
    expect(completionAllowsGames('')).toBe(false);
  });
});

describe('useSchoolGameAccess', () => {
  it('keeps an incomplete learner locked', async () => {
    const { result } = renderHook(() => useSchoolGameAccess('kid-one'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ state: 'incomplete', unlocked: false });
    expect(DaylightAPI).toHaveBeenCalledWith(expect.stringMatching(
      /^api\/v1\/entitlements\?.*capabilityId=piano\.games.*subjectId=kid-one/,
    ));
  });

  it('unlocks when the fail-closed piano.games entitlement is granted', async () => {
    h.response = entitlement({ decision: 'granted', basisState: 'satisfied', learnerId: 'kid one' });
    const { result } = renderHook(() => useSchoolGameAccess('kid one'));
    await waitFor(() => expect(result.current.unlocked).toBe(true));
    expect(DaylightAPI).toHaveBeenCalledWith(expect.stringContaining('subjectId=kid+one'));
  });

  it('keeps Guest locked without asking School for a nonexistent learner', async () => {
    const { result } = renderHook(() => useSchoolGameAccess('guest'));
    await waitFor(() => expect(result.current.status).toBe('locked'));
    expect(result.current).toMatchObject({ state: null, unlocked: false });
    expect(DaylightAPI).not.toHaveBeenCalled();
  });

  it('fails closed when the entitlement read fails', async () => {
    DaylightAPI.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useSchoolGameAccess('kid-one'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.unlocked).toBe(false);
  });

  it('does not carry one player\'s unlock across an identity switch', async () => {
    h.response = entitlement({ decision: 'granted', basisState: 'satisfied' });
    const { result, rerender } = renderHook(
      ({ learnerId }) => useSchoolGameAccess(learnerId),
      { initialProps: { learnerId: 'kid-one' } },
    );
    await waitFor(() => expect(result.current.unlocked).toBe(true));

    // The new read has not resolved yet, but the old player's permission is
    // already gone synchronously.
    h.response = new Promise(() => {});
    rerender({ learnerId: 'kid-two' });
    expect(result.current).toMatchObject({ status: 'loading', unlocked: false });
  });

  it('refreshes the entitlement while the kiosk remains mounted', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSchoolGameAccess('kid-one'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.unlocked).toBe(false);

    h.response = entitlement({ decision: 'granted', basisState: 'satisfied' });
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(result.current).toMatchObject({ state: 'complete', unlocked: true });
  });

  it('refreshes immediately when this learner\'s State Gates entitlement changes', async () => {
    const { result } = renderHook(() => useSchoolGameAccess('kid-one'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    h.response = entitlement({ decision: 'granted', basisState: 'satisfied' });
    await act(async () => {
      h.stateGatesHandler({
        kind: 'EntitlementDecisionChanged',
        payload: { capabilityId: 'piano.games', subject: { kind: 'learner', id: 'kid-one' } },
      });
    });
    await waitFor(() => expect(result.current.unlocked).toBe(true));
  });

  it('shows indeterminate and stays locked when current evidence is degraded or missing', async () => {
    h.response = entitlement({ decision: 'granted', basisState: 'indeterminate' });
    const { result } = renderHook(() => useSchoolGameAccess('kid-one'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ state: 'indeterminate', unlocked: false });
  });
});

describe('useSchoolGameAccess for a household member School does not track', () => {
  // 2026-09-02: an adult has no `piano.games` entitlement item at all — State
  // Gates enumerates instances from evidence, and School publishes claims only
  // for learners. No item reads as `indeterminate`, and `indeterminate` fails
  // closed, so both grown-ups were permanently locked out of Games and told to
  // go finish schoolwork they had never been assigned.
  //
  // "Not a learner" and "a learner whose day cannot be judged" are different
  // answers and must not collapse into one. The fail-closed posture is right
  // for the second and meaningless for the first.
  it('does not gate a member the roster marks as not a school learner', async () => {
    h.response = { items: [] };
    const { result } = renderHook(() => useSchoolGameAccess('dad', { schoolLearner: false }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ state: 'not_gated', unlocked: true });
    // Not merely unlocked — never asked. There is no question to put to a gate
    // whose subject it does not cover.
    expect(DaylightAPI).not.toHaveBeenCalled();
  });

  it('still gates a learner, and still fails closed on no evidence', async () => {
    h.response = { items: [] };
    const { result } = renderHook(() => useSchoolGameAccess('kid-one', { schoolLearner: true }));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toMatchObject({ state: 'indeterminate', unlocked: false });
  });

  // The roster arrives over the network. Until it does, nothing is known about
  // whether this id is a learner, and an unknown must not open the gate — that
  // would hand every child a reliable unlock by racing the roster fetch.
  it('gates while the roster has not said yet', async () => {
    h.response = { items: [] };
    const { result } = renderHook(() => useSchoolGameAccess('kid-one'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.unlocked).toBe(false);
  });
});

describe('useSchoolGameAccess verdict logging', () => {
  // The 2026-08-28 lesson, applied to the branch added on 2026-09-02: a verdict
  // that opens Games and leaves no trace makes "why were games open for this
  // person?" unanswerable. `not_gated` is an UNLOCK, and the newest one — the
  // first place to look when the next report says the gate let someone through.
  it('records the verdict when a member is outside the gate entirely', async () => {
    const { result } = renderHook(() => useSchoolGameAccess('dad', { schoolLearner: false }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(h.log.info).toHaveBeenCalledWith(
      'piano.school-access.verdict',
      expect.objectContaining({ learnerId: 'dad', state: 'not_gated', unlocked: true }),
    );
  });

  it('records it once, not on every refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderHook(() => useSchoolGameAccess('dad', { schoolLearner: false }));
    await waitFor(() => expect(h.log.info).toHaveBeenCalledTimes(1));

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    expect(h.log.info).toHaveBeenCalledTimes(1);
  });
});
