/**
 * gateEvents — the observability contract for the game budget and the match
 * gate.
 *
 * The design promises a table of structured events and then leans on them:
 * `gate.rung-changed` and `gate.floor-reached` are how the retry-count default
 * gets tuned against real children, and `budget.settle-failed` is the alerting
 * signal for play that was never charged. An event that is declared but never
 * emitted is worse than one that was never declared — the query comes back
 * empty and reads as "this never happens".
 *
 * So this spec asserts EVENT NAMES AND THEIR PAYLOAD FIELDS, never call counts.
 * A gate that logged `gate.failed` with no `rung` would satisfy a
 * `toHaveBeenCalled()` and answer none of the questions the field exists for,
 * and the two identity fields that make a line joinable across a household —
 * `learnerId` and `deviceId` — are exactly the ones a refactor drops in
 * silence.
 *
 * The last test in the file is the coverage gate: every event in the declared
 * table must have been asserted, with fields, by some test above it. Adding a
 * name to a table without a path that emits it fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const h = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  return { logger, runProps: [], catalog: vi.fn(), instances: vi.fn() };
});

// One mock covers BOTH subjects: GameGate and useGameBudgetMeter resolve the
// same module id through different relative paths, and both reach it through
// the default export's `.child()`.
vi.mock('../../../../../lib/logging/Logger.js', () => ({
  default: () => h.logger,
  getLogger: () => h.logger,
}));
vi.mock('../Exercises/pianoLearningApi.js', () => ({
  pianoLearningApi: { catalog: h.catalog, instances: h.instances, instance: vi.fn() },
}));
vi.mock('../Exercises/ExerciseRun.jsx', () => ({
  default: (props) => {
    h.runProps.push(props);
    return (
      <div data-testid="exercise-run">
        <button type="button" onClick={() => props.onPassed?.({ score: 0.94 })}>stub-pass</button>
        <button type="button" onClick={() => props.onFailed?.({ score: 0.41 })}>stub-fail</button>
        <button type="button" onClick={() => props.onExit?.()}>stub-exit</button>
        <button type="button" onClick={() => props.onUnavailable?.('instance-not-found')}>stub-dead-end</button>
        <button type="button" onClick={() => props.onUnavailable?.('no-access')}>stub-no-access</button>
      </div>
    );
  },
}));

const { default: GameGate, gateStateKey } = await import('./GameGate.jsx');
const { initialRung, degradeRung, isFloor } = await import('./gameGateLadder.js');
const { KIOSK_DEVICE_STORAGE_KEY } = await import('../../kioskDeviceIdentity.js');
const { default: useGameBudgetMeter } = await import('../../useGameBudgetMeter.js');
const { activitySignal } = await import('../../activitySignal.js');

const DEVICE = 'yellow-room-tablet';

// ── The declared table ───────────────────────────────────────────────────────
// Left side of the reconciliation in docs/reference/piano/games-budget-gate.md.
// Values are the fields a consumer of that event actually queries on; a name
// with no path that emits it, or a path that emits it without these fields,
// fails the coverage gate at the bottom of this file.
//
// `IDENTITY` is the four fields the design requires of EVERY event in the
// table, gate and budget alike. It is deliberately the same list on both
// sides: an operator asking "which tablet burned the device cap this
// afternoon" queries `data.deviceId` directly, and a budget line that carried
// only `learnerId` + `sessionId` would answer that question with zero rows
// while looking perfectly healthy. `studyDate` is what pulls one evening back
// out of the store as a unit — the household day rolls at 4am, so a
// calendar-date filter splits a late match in half.
const IDENTITY = ['learnerId', 'deviceId', 'studyDate', 'sessionId'];
const GATE_IDENTITY = IDENTITY;
const DECLARED = {
  'gate.presented': [...GATE_IDENTITY, 'rung', 'material', 'mode', 'attemptId'],
  'gate.attempt': [...GATE_IDENTITY, 'rung', 'material', 'mode', 'attemptId'],
  'gate.passed': [...GATE_IDENTITY, 'rung', 'attemptId', 'score'],
  'gate.failed': [...GATE_IDENTITY, 'rung', 'attemptId', 'score'],
  'gate.rung-changed': [...GATE_IDENTITY, 'rung', 'from', 'direction'],
  'gate.floor-reached': [...GATE_IDENTITY, 'rung'],
  'gate.practice-detour': [...GATE_IDENTITY, 'rung', 'material', 'mode'],
  'gate.abandoned': [...GATE_IDENTITY, 'rung'],
  'gate.unavailable': [...GATE_IDENTITY, 'rung', 'error'],
  'gate.blocked': [...GATE_IDENTITY, 'rung', 'reason'],
  'gate.material-skipped': [...GATE_IDENTITY, 'rung', 'kind', 'reason'],
  'budget.idle-paused': [...IDENTITY],
  'budget.idle-resumed': [...IDENTITY],
  'budget.warning': [...IDENTITY, 'secondsLeft', 'warnAtSeconds'],
  'budget.open-failed': [...IDENTITY, 'error'],
};

/** Names asserted-with-fields so far, across every test in this file. */
const covered = new Set();

/** Every line the logger took, at any level, as [name, data]. */
const lines = () => [
  ...h.logger.info.mock.calls,
  ...h.logger.warn.mock.calls,
  ...h.logger.error.mock.calls,
  ...h.logger.debug.mock.calls,
];

/**
 * Find `name`, assert the fields the table declares for it are PRESENT (a
 * declared field carrying `null` is a real answer — "no material was
 * resolved" — but an ABSENT one is a hole), and mark it covered.
 */
function expectEvent(name, extra = {}) {
  const required = DECLARED[name];
  if (!required) throw new Error(`${name} is not in the declared table`);
  const found = lines().filter(([event]) => event === name);
  expect(found, `${name} was never emitted. Emitted: ${[...new Set(lines().map(([e]) => e))].join(', ')}`)
    .not.toHaveLength(0);
  const match = found.find(([, data]) => Object.entries(extra)
    .every(([key, value]) => JSON.stringify(data?.[key]) === JSON.stringify(value)));
  expect(match, `${name} fired, but none carried ${JSON.stringify(extra)}`).toBeTruthy();
  const [, data] = match;
  for (const field of required) {
    expect(Object.prototype.hasOwnProperty.call(data, field), `${name} is missing '${field}'`).toBe(true);
  }
  covered.add(name);
  return data;
}

// ── Gate fixtures ────────────────────────────────────────────────────────────
const SEEDS = [
  { id: 'scales/c-major', category: 'scales', title: 'C major', supports: ['free', 'metronome', 'cued'] },
];
const INSTANCES = [{ id: 'scales/c-major@hands=2', axes: { hands: 2 }, supports: ['free', 'cued'] }];

const serveBank = () => {
  h.catalog.mockResolvedValue({ ok: true, status: 200, data: { seeds: SEEDS } });
  h.instances.mockResolvedValue({ ok: true, status: 200, data: { instances: INSTANCES } });
};

/** The rung one degrade above the floor: everything eased except timing. */
const ONE_ABOVE_FLOOR = (() => {
  let rung = initialRung();
  while (!isFloor(degradeRung(rung))) rung = degradeRung(rung);
  return rung;
})();

const seedRung = (learnerId, rung, rest = {}) => localStorage.setItem(
  gateStateKey(learnerId),
  JSON.stringify({ rung, failuresAtRung: 0, cleanPasses: 0, ...rest }),
);

/**
 * `gameGate.material` with a `score` entry alongside the exercise one — the
 * phase-1 seam declines score material, and the gate logs that decision rather
 * than letting it vanish.
 */
const MATERIAL_WITH_SCORE = [
  { kind: 'exercise', collections: ['scales'] },
  { kind: 'score', source: 'current-study-piece', measures: 4 },
];

function renderGate({ learnerId = 'kid1', gateConfig = {}, onPassed = vi.fn(), onLeave = vi.fn() } = {}) {
  const utils = render(
    <MemoryRouter initialEntries={['/piano/games/tetris']}>
      <Routes>
        {/* deviceId is deliberately NOT passed: the gate must resolve it from
            the captured kiosk self-identity, which is the only thing that can
            tell two tablets apart in a per-device log query. */}
        <Route
          path="/piano/games/:gameId"
          element={<GameGate learnerId={learnerId} gateConfig={gateConfig} onPassed={onPassed} onLeave={onLeave} />}
        />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...utils, onPassed, onLeave };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.runProps.length = 0;
  localStorage.clear();
  localStorage.setItem(KIOSK_DEVICE_STORAGE_KEY, DEVICE);
  serveBank();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('gate events', () => {
  it('a mounted gate announces itself and the attempt it is about to run', async () => {
    renderGate({ learnerId: 'kid1' });
    await screen.findByTestId('exercise-run');

    const presented = expectEvent('gate.presented');
    expect(presented.learnerId).toBe('kid1');
    expect(presented.deviceId).toBe(DEVICE);
    expect(presented.studyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(presented.sessionId).toMatch(/^gate-/);
    expect(presented.material).toBe('scales/c-major@hands=2');
    expect(presented.mode).toBe('cued');
    expect(presented.rung).toEqual(initialRung());

    const attempt = expectEvent('gate.attempt');
    // Same attempt, same identity — a query anchored on gate.presented has to
    // be able to follow attemptId straight through to the outcome.
    expect(attempt.attemptId).toBe(presented.attemptId);
    expect(attempt.sessionId).toBe(presented.sessionId);
  });

  it('a genuine pass carries its score and the rung it was played at', async () => {
    renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-pass'));

    const passed = expectEvent('gate.passed');
    expect(passed.score).toBe(0.94);
    expect(passed.rung).toEqual(initialRung());
    expect(passed.learnerId).toBe('kid1');
  });

  it('a completed miss carries its score, and the ladder move it caused is its own line', async () => {
    // retriesBeforeDegrade: 1 — one miss moves the rung, so both events land
    // on the same click.
    renderGate({ learnerId: 'kid1', gateConfig: { retriesBeforeDegrade: 1 } });
    fireEvent.click(await screen.findByText('stub-fail'));

    const failed = expectEvent('gate.failed');
    expect(failed.score).toBe(0.41);

    const changed = expectEvent('gate.rung-changed', { direction: 'degrade' });
    expect(changed.from).toEqual(initialRung());
    expect(changed.rung).toEqual(degradeRung(initialRung()));
    // `from` and `rung` are the pair that makes the ladder reconstructible —
    // a line with only the destination cannot say which axis moved.
    expect(changed.rung).not.toEqual(changed.from);
  });

  it('a climb is the same event in the other direction', async () => {
    // EXACTLY ONE gate is mounted here, deliberately. An earlier version of
    // this test rendered a second gate for another learner alongside it and
    // clicked `findAllByText('stub-pass').at(-1)` — but `findAllBy*` resolves
    // as soon as the FIRST match appears, so under load it returned one
    // button and `.at(-1)` drove whichever gate happened to mount first. When
    // that was the learner sitting at the top of the ladder, `climbRung`
    // returned the same rung and `gate.rung-changed` never fired: green in
    // isolation, red in a full sweep. A second mounted gate also pollutes the
    // shared `lines()` pool, so `expectEvent` could match the other gate's
    // event even on a passing run. One gate, `findByText` singular — which
    // additionally FAILS if a second run ever mounts.
    seedRung('kid1', degradeRung(initialRung()));
    renderGate({ learnerId: 'kid1', gateConfig: { climbAfterCleanPasses: 1 } });
    fireEvent.click(await screen.findByText('stub-pass'));

    const changed = expectEvent('gate.rung-changed', { direction: 'climb' });
    expect(changed.from).toEqual(degradeRung(initialRung()));
    expect(changed.rung).toEqual(initialRung());
  });

  it('arriving at the floor is announced once, alongside the rung change that got there', async () => {
    seedRung('kid1', ONE_ABOVE_FLOOR);
    renderGate({ learnerId: 'kid1', gateConfig: { retriesBeforeDegrade: 1 } });
    fireEvent.click(await screen.findByText('stub-fail'));

    const floor = expectEvent('gate.floor-reached');
    expect(isFloor(floor.rung)).toBe(true);
    expectEvent('gate.rung-changed', { direction: 'degrade' });
    // Once per ARRIVAL. A child sitting at the floor must not re-announce it
    // on every subsequent miss, or the calibration signal drowns itself.
    expect(lines().filter(([event]) => event === 'gate.floor-reached')).toHaveLength(1);
  });

  it('the practice detour is logged as leaving, with the material it detoured to', async () => {
    renderGate({ learnerId: 'kid1', gateConfig: { retriesBeforeDegrade: 3 } });
    fireEvent.click(await screen.findByText('stub-fail'));
    fireEvent.click(await screen.findByText('Practice this'));

    const detour = expectEvent('gate.practice-detour');
    expect(detour.material).toBe('scales/c-major@hands=2');
    expect(detour.mode).toBe('cued');
  });

  it('walking away is a distinct event from failing — the ladder did not move', async () => {
    renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-exit'));

    const abandoned = expectEvent('gate.abandoned');
    expect(abandoned.rung).toEqual(initialRung());
    expect(lines().some(([event]) => event === 'gate.failed')).toBe(false);
    expect(lines().some(([event]) => event === 'gate.rung-changed')).toBe(false);
  });

  it('infrastructure that cannot answer opens the gate and says why', async () => {
    h.catalog.mockResolvedValue({ ok: false, status: 502, data: null });
    const { onPassed } = renderGate({ learnerId: 'kid1' });
    await waitFor(() => expect(onPassed).toHaveBeenCalled());

    const unavailable = expectEvent('gate.unavailable');
    expect(unavailable.error).toBe('catalog-unavailable');
    // The child earned this game and can do nothing about a 502 — fail OPEN.
    expect(onPassed).toHaveBeenCalledTimes(1);
    // And it still anchors its own query: a fail-open run without a
    // gate.presented has no beginning to reconstruct from.
    expectEvent('gate.presented');
  });

  it('a run that dead-ends after mounting is the same fail-open, tagged with the run reason', async () => {
    const { onPassed } = renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-dead-end'));

    expect(onPassed).toHaveBeenCalledTimes(1);
    expectEvent('gate.unavailable', { error: 'run-instance-not-found' });
  });

  it('no player chosen is NOT a fail-open — it is blocked, and logged as blocked', async () => {
    const { onPassed } = renderGate({ learnerId: null });
    fireEvent.click(await screen.findByText('stub-no-access'));

    const blocked = expectEvent('gate.blocked', { reason: 'no-access' });
    expect(blocked.learnerId).toBeNull();
    // Failing open here would make picking Guest a one-tap bypass of the gate.
    expect(onPassed).not.toHaveBeenCalled();
    await screen.findByText('Choose a player first');
  });

  it('material the phase declines is logged, not silently dropped', async () => {
    renderGate({ learnerId: 'kid1', gateConfig: { material: MATERIAL_WITH_SCORE } });
    await screen.findByTestId('exercise-run');

    const skipped = expectEvent('gate.material-skipped', { kind: 'score' });
    expect(skipped.reason).toBe('score-material-phase-2');
    // The exercise entry still resolved — a declined score entry must not take
    // the whole gate down with it.
    expectEvent('gate.attempt');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('budget meter events', () => {
  const openOk = (over = {}) => ({
    enabled: true, sessionId: 'sess_1', cumulativeSeconds: 0, secondsLeft: 600,
    warnAtSeconds: 60, settleIntervalSec: 600, idleAfterSeconds: 90, ...over,
  });

  function fakeApi({ open, settle } = {}) {
    const calls = { open: [], settle: [], close: [] };
    const responder = (spec, sink) => vi.fn(async (args) => {
      sink.push(args);
      if (spec instanceof Error) throw spec;
      return spec;
    });
    return {
      calls,
      open: responder(open ?? openOk(), calls.open),
      settle: responder(settle ?? { secondsLeft: 0, depleted: false, deviceDepleted: false }, calls.settle),
      close: responder({ ok: true }, calls.close),
      balance: responder({ enabled: false }, []),
    };
  }

  const mount = (api) => renderHook(() => useGameBudgetMeter({
    learnerId: 'kid1', deviceId: DEVICE, active: true, api,
  }));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    // activitySignal is a module singleton; a stale timestamp from an earlier
    // test would read as "already idle" the moment this one mounts.
    activitySignal.bump();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('idle pause and resume are both announced — a pause with no resume is unreadable', async () => {
    const api = fakeApi();
    const { result } = mount(api);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { activitySignal.bump(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(91_000); }); // cross 90s idle
    expect(result.current.state).toBe('idle-paused');
    const paused = expectEvent('budget.idle-paused');
    expect(paused.learnerId).toBe('kid1');
    expect(paused.sessionId).toBe('sess_1');
    // The same identity contract the gate honours. A budget line that named
    // only the child cannot answer "which tablet", and the device cap is
    // shared ACROSS tablets — that is the question it exists to answer.
    expect(paused.deviceId).toBe(DEVICE);
    expect(paused.studyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    act(() => { activitySignal.bump(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current.state).toBe('playing');
    expect(expectEvent('budget.idle-resumed').sessionId).toBe('sess_1');
  });

  it('crossing the warning threshold is announced once, with the balance that crossed it', async () => {
    // 62s left against a 60s warn threshold: two ticks reach it.
    const api = fakeApi({ open: openOk({ secondsLeft: 62, warnAtSeconds: 60 }) });
    const { result } = mount(api);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { activitySignal.bump(); });

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current.state).toBe('playing'); // 61 > 60, not yet

    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(result.current.state).toBe('warning');
    const warning = expectEvent('budget.warning');
    expect(warning.secondsLeft).toBe(60);
    expect(warning.warnAtSeconds).toBe(60);
    expect(warning.sessionId).toBe('sess_1');
    // `"budget.warning" AND data.deviceId:<tablet>` has to return rows.
    expect(warning.deviceId).toBe(DEVICE);

    // An EDGE, not a state: the tick recomputes `warning` every second, and a
    // per-second line would put 60 identical entries in the store for this one
    // window and drown the one that carries news.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(lines().filter(([event]) => event === 'budget.warning')).toHaveLength(1);
  });

  it('a failed open is a warn-level line naming the learner, the device, and the error', async () => {
    const api = fakeApi({ open: new Error('network down') });
    const { result } = mount(api);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // Fail OPEN: unmetered play, never a lockout.
    expect(result.current.state).toBe('unavailable');
    const failed = expectEvent('budget.open-failed');
    expect(failed.error).toBe('network down');
    expect(failed.deviceId).toBe(DEVICE);
    expect(h.logger.warn.mock.calls.some(([event]) => event === 'budget.open-failed')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('coverage', () => {
  it('every declared event was asserted, with its fields, by a test above', () => {
    const missing = Object.keys(DECLARED).filter((name) => !covered.has(name));
    expect(missing, `declared but never asserted on a real path: ${missing.join(', ')}`).toEqual([]);
  });
});
