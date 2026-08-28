import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// ── Doubles ─────────────────────────────────────────────────────────────────
// ExerciseRun is stubbed to its four host callbacks, and the difference between
// them is the point:
//   onPassed      — a GENUINE pass (the surface judges it, per Task 9).
//   onFailed      — a COMPLETED attempt that missed the bar. The ONLY thing
//                   allowed to move the ladder.
//   onExit        — the player walked away. Nothing to judge, ladder unmoved;
//                   counting these would let a child press Exit their way to
//                   the unfailable floor without playing a note.
//   onUnavailable — the run hit a terminal state it cannot leave (its own
//                   instance fetch 502'd, the attempt would not build, guest).
// The stub also RECORDS its props, because the gate's most load-bearing output
// is not what it renders — it is the requirement it hands the run. A
// requirement with a missing/out-of-range `passScore` makes `ExerciseRun` fall
// back to `verdict.passed`, unconditionally true on a non-floor rung: a gate
// that grants game time to a child who played nothing.
const h = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  return {
    logger,
    runProps: [],
    catalog: vi.fn(),
    instances: vi.fn(),
  };
});

vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => h.logger, getLogger: () => h.logger }));
vi.mock('../Exercises/pianoLearningApi.js', () => ({
  pianoLearningApi: { catalog: h.catalog, instances: h.instances, instance: vi.fn() },
}));
vi.mock('../Exercises/ExerciseRun.jsx', () => ({
  default: (props) => {
    h.runProps.push(props);
    return (
      <div data-testid="exercise-run">
        <button type="button" onClick={() => props.onPassed?.({ score: 0.91 })}>stub-pass</button>
        {/* A COMPLETED attempt that missed the bar — the only thing that may
            move the ladder. Distinct from stub-exit, which is walking away. */}
        <button type="button" onClick={() => props.onFailed?.({ score: 0.62 })}>stub-fail</button>
        <button type="button" onClick={() => props.onExit?.()}>stub-exit</button>
        <button type="button" onClick={() => props.onUnavailable?.('instance-not-found')}>stub-dead-end</button>
      </div>
    );
  },
}));

const {
  default: GameGate, GATE_CONFIG_DEFAULTS, gateStateKey, readGateState, resolveGateConfig,
} = await import('./GameGate.jsx');
const { pickGateMaterial } = await import('./gateMaterial.js');
const { initialRung, degradeRung, isFloor, requirementForRung } = await import('./gameGateLadder.js');
const { KIOSK_DEVICE_STORAGE_KEY } = await import('../../kioskDeviceIdentity.js');

// ── Fixtures ────────────────────────────────────────────────────────────────
const SEEDS = [
  { id: 'scales/c-major', category: 'scales', title: 'C major', supports: ['free', 'metronome', 'cued'] },
  { id: 'songs/twinkle', category: 'songs', title: 'Twinkle', supports: ['free'] },
];
const INSTANCES = [
  { id: 'scales/c-major@hands=2', axes: { hands: 2 }, supports: ['free', 'cued'] },
];

function serveBank({ seeds = SEEDS, instances = INSTANCES } = {}) {
  h.catalog.mockResolvedValue({ ok: true, status: 200, data: { seeds } });
  h.instances.mockResolvedValue({ ok: true, status: 200, data: { instances } });
}

const FLOOR = { timing: 'free', hands: 1, span: 1, difficulty: 'major', direction: 'ascending' };
/** One axis eased (timing) — a non-floor rung whose mode is `free`. */
const EASED_ONCE = { ...initialRung(), timing: 'free' };

function seedGateState(learnerId, value) {
  localStorage.setItem(gateStateKey(learnerId), typeof value === 'string' ? value : JSON.stringify(value));
}

function readStored(learnerId) {
  return JSON.parse(localStorage.getItem(gateStateKey(learnerId)));
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderGate({ learnerId = 'kid1', gateConfig = {}, onPassed = vi.fn(), onLeave = vi.fn() } = {}) {
  const utils = render(
    <MemoryRouter initialEntries={['/piano/games/tetris']}>
      <LocationProbe />
      <Routes>
        <Route
          path="/piano/games/:gameId"
          element={<GameGate learnerId={learnerId} gateConfig={gateConfig} onPassed={onPassed} onLeave={onLeave} />}
        />
        <Route path="*" element={<div>elsewhere</div>} />
      </Routes>
    </MemoryRouter>
  );
  return { ...utils, onPassed, onLeave };
}

/** Every event the gate emitted, as [name, data] pairs, across info and warn. */
function events() {
  return [...h.logger.info.mock.calls, ...h.logger.warn.mock.calls];
}
function eventNamed(name) {
  return events().find(([event]) => event === name);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.runProps.length = 0;
  localStorage.clear();
  // This browser's captured kiosk self-identity — the SSOT the gate resolves
  // `deviceId` from. A shared constant could not tell two tablets apart, which
  // is the one question the field is on every event to answer.
  localStorage.setItem(KIOSK_DEVICE_STORAGE_KEY, 'yellow-room-tablet');
  serveBank();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 1: the rung persists per learner', () => {
  it('resumes the stored rung for THIS learner and starts a different learner at the top', async () => {
    seedGateState('kid1', { rung: EASED_ONCE, failuresAtRung: 1, cleanPasses: 2 });

    renderGate({ learnerId: 'kid1' });
    await screen.findByTestId('exercise-run');
    // The eased rung's timing is `free`; the top of the ladder is `cued`.
    expect(h.runProps.at(-1).requirementOverride.mode).toBe('free');

    h.runProps.length = 0;
    renderGate({ learnerId: 'kid2' });
    await waitFor(() => expect(h.runProps.length).toBeGreaterThan(0));
    expect(h.runProps.at(-1).requirementOverride.mode).toBe('cued');
  });

  it('writes the rung back under the learner-scoped key after an outcome', async () => {
    renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-pass'));

    expect(readStored('kid1')).toEqual({ rung: initialRung(), failuresAtRung: 0, cleanPasses: 1 });
    expect(localStorage.getItem(gateStateKey('kid2'))).toBeNull();
  });

  it('falls back to initialRung() on corrupt JSON and on parseable-but-wrong shapes', () => {
    // Contract 1's failure mode. localStorage is a corruptible input: a
    // half-written value, a hand-edited one, or a value written by an older
    // shape must all land the child at the TOP of the ladder, never on
    // `undefined` axes that would degrade into nonsense.
    const fresh = { rung: initialRung(), failuresAtRung: 0, cleanPasses: 0 };
    const corrupt = [
      '{"rung":', 'not json at all', 'null', '[]', '"a string"',
      JSON.stringify({ rung: null, failuresAtRung: 0, cleanPasses: 0 }),
      JSON.stringify({ rung: { timing: 'free' }, failuresAtRung: 0, cleanPasses: 0 }),
      JSON.stringify({ rung: { ...initialRung(), timing: 'sideways' }, failuresAtRung: 0, cleanPasses: 0 }),
      JSON.stringify({ rung: initialRung(), failuresAtRung: -3, cleanPasses: 0 }),
      JSON.stringify({ rung: initialRung(), failuresAtRung: 0, cleanPasses: 'lots' }),
    ];
    for (const value of corrupt) {
      seedGateState('kid1', value);
      expect(readGateState('kid1')).toEqual(fresh);
    }

    // …and a well-formed value survives untouched.
    seedGateState('kid1', { rung: FLOOR, failuresAtRung: 2, cleanPasses: 1 });
    expect(readGateState('kid1')).toEqual({ rung: FLOOR, failuresAtRung: 2, cleanPasses: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('pickGateMaterial — contract 2: exercise entries only, mode-compatible', () => {
  it('picks a seed in the configured collections and an instance that supports the rung mode', async () => {
    const picked = await pickGateMaterial(
      GATE_CONFIG_DEFAULTS.material, EASED_ONCE, { passScore: 0.8, pick: (list) => list[0] },
    );

    expect(picked.ok).toBe(true);
    expect(picked.material).toEqual({ kind: 'exercise', instanceId: 'scales/c-major@hands=2' });
    expect(h.instances).toHaveBeenCalledWith('scales/c-major'); // never 'songs/twinkle'
    expect(picked.requirement.mode).toBe('free');
  });

  it('hands back a requirement carrying a FINITE passScore on a non-floor rung', async () => {
    // The whole gate rests on this number. `ExerciseRun` only judges on score
    // when `passScore != null && Number.isFinite(Number(passScore))`; anything
    // else falls back to `verdict.passed`, which is unconditionally true off
    // the floor — every child would pass at any score, including zero.
    const picked = await pickGateMaterial(GATE_CONFIG_DEFAULTS.material, EASED_ONCE, { passScore: 0.8 });
    expect(isFloor(EASED_ONCE)).toBe(false);
    expect(Number.isFinite(Number(picked.requirement.passScore))).toBe(true);
    expect(picked.requirement.passScore).toBe(0.8);
  });

  it('leaves the floor unfailable — null passScore, completeness-only rubric', async () => {
    const picked = await pickGateMaterial(GATE_CONFIG_DEFAULTS.material, FLOOR, { passScore: 0.8 });
    expect(picked.requirement.passScore).toBeNull();
    expect(picked.requirement.rubric).toEqual({ criteria: { completeness: 1 } });
  });

  it('skips a `score` entry with a reason instead of crashing on it', async () => {
    const picked = await pickGateMaterial(GATE_CONFIG_DEFAULTS.material, EASED_ONCE, { pick: (l) => l[0] });
    expect(picked.ok).toBe(true);
    expect(picked.skipped).toContainEqual({ kind: 'score', reason: 'score-material-phase-2' });
  });

  it('declines, rather than throws, when nothing usable can be resolved', async () => {
    expect((await pickGateMaterial(null, EASED_ONCE, {})).error).toBe('no-exercise-material-configured');
    expect((await pickGateMaterial([{ kind: 'score' }], EASED_ONCE, {})).error).toBe('no-exercise-material-configured');

    h.catalog.mockResolvedValue({ ok: false, status: 502, data: null });
    expect((await pickGateMaterial(GATE_CONFIG_DEFAULTS.material, EASED_ONCE, {})).error).toBe('catalog-unavailable');

    serveBank({ seeds: [{ id: 'songs/twinkle', category: 'songs', supports: ['free'] }] });
    expect((await pickGateMaterial(GATE_CONFIG_DEFAULTS.material, EASED_ONCE, {})).error).toBe('no-seed-for-rung');

    serveBank({ instances: [{ id: 'scales/c-major@x=1', supports: ['metronome'] }] });
    expect((await pickGateMaterial(GATE_CONFIG_DEFAULTS.material, EASED_ONCE, {})).error).toBe('no-instance-for-rung');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 3: infrastructure fails OPEN', () => {
  it.each([
    ['a 502 from the catalog', () => h.catalog.mockResolvedValue({ ok: false, status: 502, data: null })],
    ['a rejected fetch', () => h.catalog.mockRejectedValue(new Error('network down'))],
    ['an empty collection', () => serveBank({ seeds: [] })],
    ['a seed with no compatible instance', () => serveBank({ instances: [] })],
    ['a malformed material config', () => {}],
  ])('opens the gate and logs gate.unavailable on %s', async (label, arrange) => {
    arrange();
    const gateConfig = label === 'a malformed material config' ? { material: 'scales' } : {};
    const { onPassed } = renderGate({ gateConfig });

    await waitFor(() => expect(onPassed).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('exercise-run')).toBeNull();
    const [, data] = eventNamed('gate.unavailable');
    expect(data.learnerId).toBe('kid1');
    expect(typeof data.error).toBe('string');
    // The mount is anchored even here — a fail-open run is exactly the one
    // worth reconstructing, and it needs a beginning in the log.
    expect(eventNamed('gate.presented')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 4: passing', () => {
  it('opens the match, logs gate.passed with the score, and banks a clean pass', async () => {
    const { onPassed } = renderGate({ learnerId: 'kid1', gateConfig: { climbAfterCleanPasses: 3 } });
    fireEvent.click(await screen.findByText('stub-pass'));

    expect(onPassed).toHaveBeenCalledTimes(1);
    const [, data] = eventNamed('gate.passed');
    expect(data.score).toBe(0.91);
    expect(data.attemptId).toEqual(expect.any(String));
    expect(readStored('kid1').cleanPasses).toBe(1);
    expect(readStored('kid1').rung).toEqual(initialRung());
  });

  it('climbs the rung and resets the counter after climbAfterCleanPasses clean passes', async () => {
    const eased = degradeRung(initialRung()); // one axis down from the top
    seedGateState('kid1', { rung: eased, failuresAtRung: 0, cleanPasses: 2 });

    renderGate({ learnerId: 'kid1', gateConfig: { climbAfterCleanPasses: 3 } });
    fireEvent.click(await screen.findByText('stub-pass'));

    expect(readStored('kid1')).toEqual({ rung: initialRung(), failuresAtRung: 0, cleanPasses: 0 });
    const [, data] = eventNamed('gate.rung-changed');
    expect(data.direction).toBe('climb');
    expect(data.rung).toEqual(initialRung());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 5: failing offers exactly three ways out, none of them the match', () => {
  it('shows Try again · Practice this · Leave and no path to the game', async () => {
    const { onPassed } = renderGate();
    fireEvent.click(await screen.findByText('stub-fail'));

    const panel = await screen.findByRole('status');
    const labels = [...panel.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Try again', 'Practice this', 'Leave']);
    expect(onPassed).not.toHaveBeenCalled();
    // A completed failure has a score, and the panel shows it — the run
    // unmounts on failure, taking its own result readout with it.
    expect(eventNamed('gate.failed')[1].score).toBe(0.62);
    expect(panel.textContent).toContain('62%');
    expect(panel.textContent).toContain('80%');
  });

  it('Try again re-runs the challenge without granting the match', async () => {
    const { onPassed } = renderGate();
    fireEvent.click(await screen.findByText('stub-fail'));
    fireEvent.click(await screen.findByText('Try again'));

    await screen.findByTestId('exercise-run');
    expect(onPassed).not.toHaveBeenCalled();
    expect(events().filter(([name]) => name === 'gate.attempt')).toHaveLength(2);
  });

  it('degrades the rung after retriesBeforeDegrade failures, with the banner and gate.rung-changed', async () => {
    renderGate({ learnerId: 'kid1', gateConfig: { retriesBeforeDegrade: 3 } });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.click(await screen.findByText('stub-fail'));
      expect(screen.queryByText('We made it a little easier')).toBeNull();
      expect(readStored('kid1').rung).toEqual(initialRung());
      fireEvent.click(screen.getByText('Try again'));
    }
    fireEvent.click(await screen.findByText('stub-fail'));

    expect(await screen.findByText('We made it a little easier')).toBeTruthy();
    expect(readStored('kid1')).toEqual({ rung: degradeRung(initialRung()), failuresAtRung: 0, cleanPasses: 0 });
    const [, data] = eventNamed('gate.rung-changed');
    expect(data.direction).toBe('degrade');
    expect(data.rung).toEqual(degradeRung(initialRung()));

    // …and the EASED rung is what the next attempt is actually judged against.
    // Nothing else pinned this: the gate's resolve effect reads the rung out of
    // a ref, so a reordering that let it read a stale one would degrade the
    // ladder in the log while asking the child for the same hard thing.
    fireEvent.click(screen.getByText('Try again'));
    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).requirementOverride)
      .toEqual(requirementForRung(degradeRung(initialRung()), { passScore: 0.8 }));
  });

  it('D12: Practice this leaves for the unmetered practice route and never grants the match', async () => {
    const { onPassed } = renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-fail'));
    fireEvent.click(await screen.findByText('Practice this'));

    expect(screen.getByTestId('location').textContent)
      .toBe('/piano/exercises/run/scales%2Fc-major%40hands%3D2?intent=practice&mode=cued');
    expect(onPassed).not.toHaveBeenCalled();
    const [, data] = eventNamed('gate.practice-detour');
    expect(data.material).toBe('scales/c-major@hands=2');
    expect(data.mode).toBe('cued');
  });

  it('walking away is NOT a failure: the ladder does not move, however many times you Exit', async () => {
    // The bug this exists to prevent: if `onExit` counted toward
    // `retriesBeforeDegrade`, a child could press Exit three times per match
    // and arrive at the unfailable floor without ever touching a key — the gate
    // would become a formality that still logs like a gate.
    const { onPassed, onLeave } = renderGate({ learnerId: 'kid1', gateConfig: { retriesBeforeDegrade: 1 } });
    const exit = await screen.findByText('stub-exit');
    for (let visit = 0; visit < 4; visit += 1) fireEvent.click(exit);

    expect(onLeave).toHaveBeenCalledTimes(4);
    expect(onPassed).not.toHaveBeenCalled();
    expect(eventNamed('gate.abandoned')).toBeTruthy();
    expect(eventNamed('gate.failed')).toBeUndefined();
    expect(eventNamed('gate.rung-changed')).toBeUndefined();
    expect(readGateState('kid1')).toEqual({ rung: initialRung(), failuresAtRung: 0, cleanPasses: 0 });
  });

  it('offers a way out DURING the attempt, not only after it', async () => {
    // The run owns the screen while it is up. On a kiosk there is no browser
    // chrome and no keyboard, so a state neither component anticipated would
    // otherwise strand a child with nothing to press.
    const { onLeave, onPassed } = renderGate();
    await screen.findByTestId('exercise-run');

    fireEvent.click(screen.getByText('Leave'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onPassed).not.toHaveBeenCalled();
    expect(eventNamed('gate.abandoned')).toBeTruthy();
  });

  it('Leave calls onLeave and logs gate.abandoned — still not the match', async () => {
    const { onPassed, onLeave } = renderGate();
    fireEvent.click(await screen.findByText('stub-fail'));
    fireEvent.click(await screen.findByText('Leave'));

    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onPassed).not.toHaveBeenCalled();
    expect(eventNamed('gate.abandoned')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — the run’s own dead ends fail open too', () => {
  it('opens the gate when the run reports a terminal state it cannot leave', async () => {
    // The gate resolves material through `instances(seedId)`; the run then
    // re-resolves it through a DIFFERENT call, `instance(instanceId)`. A
    // backend restart between the two lands the child on "Exercise not found"
    // with no affordance and no callback — the fail-open would never fire and
    // the log would show a `gate.attempt` with nothing after it.
    const { onPassed } = renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-dead-end'));

    expect(onPassed).toHaveBeenCalledTimes(1);
    const [, data] = eventNamed('gate.unavailable');
    expect(data.error).toBe('run-instance-not-found');
    expect(data.material).toBe('scales/c-major@hands=2');
    expect(data.learnerId).toBe('kid1');
  });

  it('opens the match only once, however many ways the gate is told it is broken', async () => {
    const { onPassed } = renderGate();
    const deadEnd = await screen.findByText('stub-dead-end');
    fireEvent.click(deadEnd);
    fireEvent.click(deadEnd);
    expect(onPassed).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 6: the floor is announced once per arrival', () => {
  it('logs gate.floor-reached when the last axis eases, and not again while it sits there', async () => {
    // One axis short of the floor: the next degrade IS the arrival.
    const oneAbove = { ...FLOOR, timing: 'cued' };
    seedGateState('kid1', { rung: oneAbove, failuresAtRung: 0, cleanPasses: 0 });
    renderGate({ learnerId: 'kid1', gateConfig: { retriesBeforeDegrade: 1 } });

    fireEvent.click(await screen.findByText('stub-fail'));
    expect(readStored('kid1').rung).toEqual(FLOOR);
    expect(events().filter(([name]) => name === 'gate.floor-reached')).toHaveLength(1);

    fireEvent.click(screen.getByText('Try again'));
    fireEvent.click(await screen.findByText('stub-fail'));
    expect(events().filter(([name]) => name === 'gate.floor-reached')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 7: every event is reconstructable from one query', () => {
  it('stamps learnerId, deviceId, studyDate and sessionId on every gate event', async () => {
    const now = new Date(Date.now() - 4 * 3_600_000);
    const expectedStudyDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-fail'));
    fireEvent.click(await screen.findByText('Leave'));

    const gateEvents = events().filter(([name]) => name.startsWith('gate.'));
    expect(gateEvents.length).toBeGreaterThanOrEqual(4); // presented, attempt, failed, abandoned
    const sessionIds = new Set();
    for (const [name, data] of gateEvents) {
      expect(data, name).toMatchObject({
        learnerId: 'kid1', deviceId: 'yellow-room-tablet', studyDate: expectedStudyDate,
        sessionId: expect.any(String),
      });
      sessionIds.add(data.sessionId);
    }
    expect(sessionIds.size).toBe(1); // one gate mount, one session id
  });

  it('carries material, rung, mode and attemptId on the attempt-shaped events', async () => {
    renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-pass'));

    for (const name of ['gate.presented', 'gate.attempt', 'gate.passed']) {
      const [, data] = eventNamed(name);
      expect(data, name).toMatchObject({
        material: 'scales/c-major@hands=2', rung: initialRung(), mode: 'cued', attemptId: expect.any(String),
      });
    }
    expect(eventNamed('gate.passed')[1].score).toBe(0.91);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — a late-arriving learner keeps their place', () => {
  it('re-reads the ladder when the roster slug hydrates, instead of overwriting it', async () => {
    // `PianoUserContext` starts at null and hydrates asynchronously. On a
    // reload straight onto a games route the gate would otherwise resume at the
    // guest key (top of the ladder) and then write THAT over a struggling
    // child's hard-won position on the first outcome.
    seedGateState('kid1', { rung: EASED_ONCE, failuresAtRung: 1, cleanPasses: 0 });
    function Harness() {
      const [learnerId, setLearnerId] = useState(null);
      return (
        <>
          <button type="button" onClick={() => setLearnerId('kid1')}>hydrate</button>
          <GameGate learnerId={learnerId} gateConfig={{}} onPassed={() => {}} onLeave={() => {}} />
        </>
      );
    }
    render(<MemoryRouter><Harness /></MemoryRouter>);
    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).requirementOverride.mode).toBe('cued'); // guest: top of the ladder

    fireEvent.click(screen.getByText('hydrate'));
    // The resumed rung reaches the run: the child is judged on what they earned.
    await waitFor(() => expect(h.runProps.at(-1).requirementOverride.mode).toBe('free'));

    fireEvent.click(screen.getByText('stub-pass'));
    expect(readGateState('kid1')).toEqual({ rung: EASED_ONCE, failuresAtRung: 0, cleanPasses: 1 });
    // …and the events after hydration name the real child, not the null guest.
    expect(eventNamed('gate.passed')[1].learnerId).toBe('kid1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveGateConfig — a mistyped number must not become a broken gate', () => {
  it('rejects a passScore outside (0, 1] in BOTH directions', () => {
    // 80 is the percent-for-fraction mistake: finite, plausible, and it makes
    // `score >= 80` — never true. Every child fails to the floor on every match
    // while the logs read as ordinary `gate.failed`. The mirror is worse: "",
    // false and [] all coerce to 0, so `score >= 0` passes everyone at every
    // rung, logged as healthy `gate.passed`.
    for (const bad of [80, 100, 1.5, 0, -0.5, '', false, [], null, undefined, 'high', NaN, Infinity]) {
      expect(resolveGateConfig({ passScore: bad }).passScore, String(bad)).toBe(0.8);
    }
    for (const good of [0.5, 0.8, 1, '0.75']) {
      expect(resolveGateConfig({ passScore: good }).passScore, String(good)).toBe(Number(good));
    }
  });

  it('rejects a fractional retry/climb count instead of flooring it to zero', () => {
    // Validating the raw value and flooring afterwards turns 0.5 into 0:
    // degrade on the first failure, climb on every pass. Both read as "the
    // ladder is broken", and neither is visible in a log.
    expect(resolveGateConfig({ retriesBeforeDegrade: 0.5 }).retriesBeforeDegrade).toBe(3);
    expect(resolveGateConfig({ climbAfterCleanPasses: 0.5 }).climbAfterCleanPasses).toBe(3);
    expect(resolveGateConfig({ retriesBeforeDegrade: 0 }).retriesBeforeDegrade).toBe(3);
    expect(resolveGateConfig({ retriesBeforeDegrade: -2 }).retriesBeforeDegrade).toBe(3);
    expect(resolveGateConfig({ retriesBeforeDegrade: 5 }).retriesBeforeDegrade).toBe(5);
    expect(resolveGateConfig({ climbAfterCleanPasses: 2 }).climbAfterCleanPasses).toBe(2);
  });

  it('survives null and {} without throwing, and never self-enables', () => {
    for (const raw of [null, undefined, {}, 'nonsense', 42]) {
      expect(resolveGateConfig(raw)).toMatchObject({
        enabled: false, every: 'match', passScore: 0.8, retriesBeforeDegrade: 3,
        metered: false, climbAfterCleanPasses: 3,
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — config defaults', () => {
  it('runs off the design defaults when gateConfig is null or empty', async () => {
    renderGate({ gateConfig: null });
    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).requirementOverride.passScore).toBe(0.8);
    expect(h.runProps.at(-1).intent).toBe('challenge');
  });

  it('never rebuilds the material or requirement reference on a parent re-render', async () => {
    // Both land in ExerciseRun's load-effect dependencies. A fresh object
    // literal per render refetches the instance and rebuilds the attempt —
    // the run would restart under the child's hands, forever. The parent here
    // re-renders with FRESH prop literals, which is the realistic case.
    function Harness() {
      const [n, setN] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setN(n + 1)}>bump</button>
          <GameGate learnerId="kid1" gateConfig={{}} onPassed={() => {}} onLeave={() => {}} />
        </>
      );
    }
    render(<MemoryRouter><Harness /></MemoryRouter>);
    await screen.findByTestId('exercise-run');
    const before = h.runProps.at(-1);

    fireEvent.click(screen.getByText('bump'));
    await waitFor(() => expect(h.runProps.length).toBeGreaterThan(1));
    const after = h.runProps.at(-1);
    expect(after).not.toBe(before); // the run really did re-render
    expect(after.material).toBe(before.material);
    expect(after.requirementOverride).toBe(before.requirementOverride);
    // …and nothing re-resolved behind it: one mount, one bank read, one attempt.
    expect(h.catalog).toHaveBeenCalledTimes(1);
    expect(events().filter(([name]) => name === 'gate.attempt')).toHaveLength(1);
  });
});
