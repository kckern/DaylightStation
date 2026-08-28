import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// ── Doubles ─────────────────────────────────────────────────────────────────
// ExerciseRun is stubbed to its four host callbacks, and the difference between
// them is the point:
//   onPassed      — a GENUINE pass (the surface judges it).
//   onFailed      — a COMPLETED attempt that missed the bar. The ONLY thing
//                   allowed to move the ladder.
//   onExit        — the player walked away. Nothing to judge, ladder unmoved;
//                   counting these would let a child press Exit their way to
//                   the unfailable floor without playing a note.
//   onUnavailable — the run hit a terminal state it cannot leave (its own
//                   instance fetch 502'd, the attempt would not build, guest).
// The stub also RECORDS its props, because the gate's most load-bearing output
// is not what it renders — it is what it hands the run. The requirement decides
// whether a child can fail at all (D9); `framing`, `ask` and `tier` decide
// whether the child can read what they are being asked for.
const h = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
  logger.child = () => logger;
  return {
    logger,
    runProps: [],
    catalog: vi.fn(),
    instances: vi.fn(),
    instance: vi.fn(),
  };
});

vi.mock('../../../../../lib/logging/Logger.js', () => ({ default: () => h.logger, getLogger: () => h.logger }));
vi.mock('../Exercises/pianoLearningApi.js', () => ({
  pianoLearningApi: { catalog: h.catalog, instances: h.instances, instance: h.instance },
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
        {/* A completed result with no usable number — an aborted attempt, or a
            free level, which carries no numeric bar at all. */}
        <button type="button" onClick={() => props.onFailed?.({})}>stub-fail-scoreless</button>
        <button type="button" onClick={() => props.onExit?.()}>stub-exit</button>
        <button type="button" onClick={() => props.onUnavailable?.('instance-not-found')}>stub-dead-end</button>
        <button type="button" onClick={() => props.onUnavailable?.('no-access')}>stub-no-access</button>
      </div>
    );
  },
}));

const {
  default: GameGate, GATE_CONFIG_DEFAULTS, gateStateKey, readGateState, resolveGateConfig,
} = await import('./GameGate.jsx');
const { pickGateMaterial } = await import('./gateMaterial.js');
const {
  BUILT_IN_FLOOR, FALLBACK_LEVEL, resolveRepertoire, startLevelFor, materialKey,
} = await import('./gateRepertoire.js');
const { requirementForLevel } = await import('./gateAsk.js');
const { KIOSK_DEVICE_STORAGE_KEY } = await import('../../kioskDeviceIdentity.js');

// ── Fixtures ────────────────────────────────────────────────────────────────
/**
 * The shape the shipped household config expresses: a one-key floor beneath a
 * C-major level, a three-root level above it, and a cued level at the top.
 * `resolveRepertoire` prepends the built-in floor, so the resolved list is
 * `[floor-key, L1, L2, L3]` and `startLevelFor` opens at L1.
 */
const REPERTOIRE = [
  { id: 'L1', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['C'], hands: 'right' }] },
  { id: 'L2', tier: 2, material: [{ kind: 'exercise', collection: 'scales', roots: ['G', 'D', 'F'], hands: 'right' }] },
  {
    id: 'L3',
    tier: 3,
    grading: { cleanliness: 0.8 },
    material: [{ kind: 'exercise', collection: 'scales', roots: ['C'], hands: 'right', cued: true }],
  },
];
const LEVELS = resolveRepertoire(REPERTOIRE);
const CONFIG = { repertoire: REPERTOIRE };

const scaleId = (root) => `scales/modes@root=${root},mode=ionian,direction=up,span_octaves=1`;

const SEEDS = [
  { id: 'scales/c-major', category: 'scales', title: 'C major', supports: ['free', 'metronome', 'cued'] },
  { id: 'songs/twinkle', category: 'songs', title: 'Twinkle', supports: ['free'] },
];
const INSTANCES = [
  { id: 'scales/c-major@hands=2', axes: { hands: 2 }, supports: ['free', 'cued'] },
];

/**
 * The bank as the gate meets it: `instance(id)` answers for any id it is asked
 * for, echoing the root back through `axes`/`key` the way the real bank does —
 * that is what `askForMaterial` reads to write the child's sentence.
 */
function serveBank({ seeds = SEEDS, instances = INSTANCES } = {}) {
  h.catalog.mockResolvedValue({ ok: true, status: 200, data: { seeds } });
  h.instances.mockResolvedValue({ ok: true, status: 200, data: { instances } });
  h.instance.mockImplementation(async (id) => {
    const root = /root=([^,]+)/.exec(id)?.[1] ?? 'C';
    return {
      ok: true,
      status: 200,
      data: {
        id,
        title: `${root} major`,
        key: root,
        ordering: 'strict',
        axes: { root, mode: 'ionian' },
        supports: ['free', 'metronome', 'cued'],
        events: [{ id: 'e1', value: 'quarter', notes: [{ midi: 60, hand: 'right' }] }],
      },
    };
  });
}

function seedGateState(learnerId, value) {
  localStorage.setItem(gateStateKey(learnerId), typeof value === 'string' ? value : JSON.stringify(value));
}

function readStored(learnerId) {
  return JSON.parse(localStorage.getItem(gateStateKey(learnerId)));
}

/** The level a stored state opens at, with the repertoire resolved for it. */
const stateFor = (learnerId, config = CONFIG) => readGateState(learnerId, resolveRepertoire(config.repertoire), config);

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderGate({
  learnerId = 'kid1', gateConfig = CONFIG, gameLabel = 'Tetris', onPassed = vi.fn(), onLeave = vi.fn(),
} = {}) {
  const utils = render(
    <MemoryRouter initialEntries={['/piano/games/tetris']}>
      <LocationProbe />
      <Routes>
        <Route
          path="/piano/games/:gameId"
          element={(
            <GameGate
              learnerId={learnerId}
              gateConfig={gateConfig}
              gameLabel={gameLabel}
              onPassed={onPassed}
              onLeave={onLeave}
            />
          )}
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
describe('GameGate — contract 1: the level persists per learner', () => {
  it('resumes the stored level for THIS learner and starts a different learner at the start level', async () => {
    seedGateState('kid1', {
      levelId: 'L3', failuresAtLevel: 1, cleanPasses: 2, lastMaterialId: null, pickIndex: 0,
    });

    renderGate({ learnerId: 'kid1' });
    await screen.findByTestId('exercise-run');
    // L3 is the cued level; the start level (L1) is free.
    expect(h.runProps.at(-1).requirementOverride.mode).toBe('cued');
    expect(h.runProps.at(-1).tier).toBe(3);

    h.runProps.length = 0;
    renderGate({ learnerId: 'kid2' });
    await waitFor(() => expect(h.runProps.length).toBeGreaterThan(0));
    expect(h.runProps.at(-1).requirementOverride.mode).toBe('free');
    expect(h.runProps.at(-1).tier).toBe(2);
  });

  it('writes v2 state back under the learner-scoped key after an outcome', async () => {
    renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-pass'));

    expect(readStored('kid1')).toMatchObject({
      levelId: 'L1', failuresAtLevel: 0, cleanPasses: 1,
      // The served material is remembered so the next gate can avoid it.
      lastMaterialId: materialKey(REPERTOIRE[0].material[0]),
    });
    expect(localStorage.getItem(gateStateKey('kid2'))).toBeNull();
  });

  it('falls back to the start level on corrupt JSON, on wrong shapes, and on every OLD five-axis rung', () => {
    // localStorage is a corruptible input: a half-written value, a hand-edited
    // one, or a value written by an older shape must all land the child at the
    // configured start level, never on a level id nothing can resolve.
    //
    // The five-axis entry is the migration case and it is not hypothetical —
    // every kiosk that ran the previous ladder has one of these on disk today.
    const oldRung = { rung: { timing: 'cued', hands: 2, span: 2, difficulty: 'exotic', direction: 'both' }, failuresAtRung: 2, cleanPasses: 1 };
    const corrupt = [
      '{"levelId":', 'not json at all', 'null', '[]', '"a string"',
      JSON.stringify(oldRung),
      JSON.stringify({ levelId: null, failuresAtLevel: 0, cleanPasses: 0 }),
      JSON.stringify({ levelId: 'L9-that-was-renamed', failuresAtLevel: 0, cleanPasses: 0 }),
      JSON.stringify({ levelId: 'L1', failuresAtLevel: -3, cleanPasses: 0 }),
      JSON.stringify({ levelId: 'L1', failuresAtLevel: 0, cleanPasses: 'lots' }),
    ];
    const fresh = {
      levelId: startLevelFor(LEVELS, CONFIG).id, failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0,
    };
    for (const value of corrupt) {
      seedGateState('kid1', value);
      expect(stateFor('kid1'), String(value).slice(0, 40)).toEqual(fresh);
    }

    // …and a well-formed value survives untouched.
    const stored = { levelId: 'L2', failuresAtLevel: 2, cleanPasses: 1, lastMaterialId: 'exercise|scales|G|right|', pickIndex: 5 };
    seedGateState('kid1', stored);
    expect(stateFor('kid1')).toEqual(stored);
  });

  it('zeroes a damaged pickIndex but KEEPS the level the child earned', () => {
    // `pickIndex` is a rotation hint, not a position. Resetting the whole state
    // over one would send a child who had walked down to L1 back to the start
    // level for the sake of a counter that only decides which scale is next.
    for (const pickIndex of ['banana', -1, 2.5, null, undefined, {}]) {
      seedGateState('kid1', {
        levelId: 'L2', failuresAtLevel: 2, cleanPasses: 1, lastMaterialId: null, pickIndex,
      });
      expect(stateFor('kid1'), String(pickIndex)).toEqual({
        levelId: 'L2', failuresAtLevel: 2, cleanPasses: 1, lastMaterialId: null, pickIndex: 0,
      });
    }
  });

  it('honours config.startLevel, so a preschooler can open at lit keys', () => {
    const config = { repertoire: REPERTOIRE, startLevel: BUILT_IN_FLOOR.id };
    expect(stateFor('miles', config).levelId).toBe(BUILT_IN_FLOOR.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('pickGateMaterial — contract 2: a level resolves to something gradable', () => {
  it('addresses the scales bank directly for a collection/roots level', async () => {
    const picked = await pickGateMaterial(LEVELS[1], { pickIndex: 0, mode: 'free' });

    expect(picked.ok).toBe(true);
    expect(picked.material).toMatchObject({ kind: 'exercise', instanceId: scaleId('C') });
    expect(picked.instance.axes).toEqual({ root: 'C', mode: 'ionian' });
  });

  it('synthesizes the floor’s lit key without a single bank call', async () => {
    const picked = await pickGateMaterial(BUILT_IN_FLOOR, { pickIndex: 0, mode: 'free' });

    expect(picked.ok).toBe(true);
    expect(picked.instance.events).toHaveLength(1);
    expect(picked.instance.events[0].notes).toHaveLength(1);
    expect(h.instance).not.toHaveBeenCalled();
    expect(h.instances).not.toHaveBeenCalled();
    expect(h.catalog).not.toHaveBeenCalled();
  });

  it('leaves every level below tier 3 unfailable — null passScore, completeness-only rubric', async () => {
    const requirement = requirementForLevel(BUILT_IN_FLOOR);
    expect(requirement.passScore).toBeNull();
    expect(requirement.rubric).toEqual({ criteria: { completeness: 1 } });
    // …and the level the child starts on says the same thing.
    expect(requirementForLevel(LEVELS[1]).rubric).toEqual({ criteria: { completeness: 1 } });
  });

  it('skips a `score` entry naming no document, with a reason instead of crashing on it', async () => {
    // A score that names a source resolves and runs (the `ScorePassage` stage).
    // One that names none is a config mistake, and the level's other material
    // must still be served rather than the gate failing over the typo.
    const mixed = {
      ...LEVELS[1],
      material: [...LEVELS[1].material, { kind: 'score', measures: [1, 4] }],
    };
    const picked = await pickGateMaterial(mixed, { pickIndex: 1, mode: 'free' });
    expect(picked.ok).toBe(true);
    expect(picked.skipped).toContainEqual({ kind: 'score', reason: 'no-score-source' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 3: infrastructure fails OPEN', () => {
  it.each([
    ['a 502 from the bank', () => h.instance.mockResolvedValue({ ok: false, status: 502, data: null })],
    ['a rejected fetch', () => h.instance.mockRejectedValue(new Error('network down'))],
    ['a level whose only material names nothing', () => {}],
  ])('opens the gate and logs gate.unavailable on %s', async (label, arrange) => {
    arrange();
    const gateConfig = label === 'a level whose only material names nothing'
      ? { repertoire: [{ id: 'score-only', tier: 2, material: [{ kind: 'score', measures: [1, 4] }] }] }
      : CONFIG;
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

  it('a repertoire nobody can read falls back to a playable level rather than opening the gate', async () => {
    // A malformed `repertoire` is a config mistake, not an outage. Failing open
    // on it would hand out free matches for as long as the typo survives.
    const { onPassed } = renderGate({ gateConfig: { repertoire: 'scales' } });
    await screen.findByTestId('exercise-run');

    expect(onPassed).not.toHaveBeenCalled();
    expect(h.runProps.at(-1).material.instanceId).toBe(FALLBACK_LEVEL.material[0].instanceId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 4: passing', () => {
  it('opens the match, logs gate.passed with the score, and banks a clean pass', async () => {
    const { onPassed } = renderGate({ learnerId: 'kid1', gateConfig: CONFIG });
    fireEvent.click(await screen.findByText('stub-pass'));

    expect(onPassed).toHaveBeenCalledTimes(1);
    const [, data] = eventNamed('gate.passed');
    expect(data.score).toBe(0.91);
    expect(data.attemptId).toEqual(expect.any(String));
    expect(readStored('kid1').cleanPasses).toBe(1);
    expect(readStored('kid1').levelId).toBe('L1');
  });

  it('climbs a level and resets the counter after climbAfterCleanPasses clean passes', async () => {
    seedGateState('kid1', { levelId: 'L1', failuresAtLevel: 0, cleanPasses: 2, lastMaterialId: null, pickIndex: 0 });

    renderGate({ learnerId: 'kid1', gateConfig: { ...CONFIG, climbAfterCleanPasses: 3 } });
    fireEvent.click(await screen.findByText('stub-pass'));

    expect(readStored('kid1')).toMatchObject({ levelId: 'L2', failuresAtLevel: 0, cleanPasses: 0 });
    const [, data] = eventNamed('gate.rung-changed');
    expect(data.direction).toBe('climb');
    expect(data.from).toBe('L1');
    expect(data.to).toBe('L2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 5: failing offers ways out, none of them the match', () => {
  it('shows Try again · Practice this · Leave and no path to the game', async () => {
    const { onPassed } = renderGate();
    fireEvent.click(await screen.findByText('stub-fail'));

    const panel = await screen.findByRole('status');
    const labels = [...panel.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['Try again', 'Practice this', 'Leave']);
    expect(onPassed).not.toHaveBeenCalled();
    // The score reaches the LOG, where an adult tuning the ladder can read it.
    expect(eventNamed('gate.failed')[1].score).toBe(0.62);
    // It does not reach the child. Every repertoire level is verdict-driven
    // (`passScore: null`), so a bare percentage on the panel would invite
    // comparison against a target that does not exist — "62%" reads as failing
    // something, and the words are what say what to do instead.
    expect(panel.textContent).not.toContain('%');
    expect(panel.textContent).toContain('Play it once more, work on it first, or come back later.');
  });

  it('still says what to do when the result carries no usable score', async () => {
    // Gating the panel's only words behind a number reduced it to a bare
    // heading over three unexplained buttons. Every level below tier 3 now
    // completes without a numeric bar, so this is the ordinary case.
    renderGate();
    fireEvent.click(await screen.findByText('stub-fail-scoreless'));

    const panel = await screen.findByRole('status');
    expect(panel.textContent).toContain('Play it once more, work on it first, or come back later.');
    expect(panel.textContent).not.toContain('%');
    expect([...panel.querySelectorAll('button')].map((b) => b.textContent))
      .toEqual(['Try again', 'Practice this', 'Leave']);
  });

  it('drops Practice this at the lit-key floor, where there is no exercise to go practise', async () => {
    // The detour route addresses an exercise-bank instance. A synthesized lit
    // key has no id in the bank, so the button would navigate to
    // `/exercises/run/undefined` — a dead end dressed as a way out.
    seedGateState('kid1', {
      levelId: BUILT_IN_FLOOR.id, failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0,
    });
    renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-fail'));

    const panel = await screen.findByRole('status');
    expect([...panel.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Try again', 'Leave']);
  });

  it('Try again re-runs the challenge without granting the match', async () => {
    const { onPassed } = renderGate();
    fireEvent.click(await screen.findByText('stub-fail'));
    fireEvent.click(await screen.findByText('Try again'));

    await screen.findByTestId('exercise-run');
    expect(onPassed).not.toHaveBeenCalled();
    expect(events().filter(([name]) => name === 'gate.attempt')).toHaveLength(2);
  });

  it('walks the ladder down a level at a time — L2 to L1 to the floor — and says so each step', async () => {
    // Every degrade now changes the level, which is what makes the banner
    // ("We made it a little easier") true rather than aspirational.
    seedGateState('kid1', { levelId: 'L2', failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0 });
    renderGate({ learnerId: 'kid1', gateConfig: { ...CONFIG, retriesBeforeDegrade: 1 } });

    const walk = [];
    for (let step = 0; step < 2; step += 1) {
      fireEvent.click(await screen.findByText('stub-fail'));
      expect(await screen.findByText('We made it a little easier')).toBeTruthy();
      walk.push(readStored('kid1').levelId);
      fireEvent.click(screen.getByText('Try again'));
      await screen.findByTestId('exercise-run');
    }
    // A third miss at the floor moves nothing, and must not promise it did.
    fireEvent.click(await screen.findByText('stub-fail'));
    await screen.findByRole('status');
    expect(screen.queryByText('We made it a little easier')).toBeNull();
    walk.push(readStored('kid1').levelId);

    expect(walk).toEqual(['L1', BUILT_IN_FLOOR.id, BUILT_IN_FLOOR.id]);
    const changes = events().filter(([name]) => name === 'gate.rung-changed').map(([, data]) => data);
    expect(changes.map(({ from, to, direction }) => ({ from, to, direction }))).toEqual([
      { from: 'L2', to: 'L1', direction: 'degrade' },
      { from: 'L1', to: BUILT_IN_FLOOR.id, direction: 'degrade' },
    ]);
  });

  it('judges the next attempt against the EASED level, not the one that was failed', async () => {
    // Nothing else pins this: the gate's resolve effect reads the level out of
    // a ref, so a reordering that let it read a stale one would move the ladder
    // in the log while asking the child for the same hard thing.
    seedGateState('kid1', { levelId: 'L3', failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0 });
    renderGate({ learnerId: 'kid1', gateConfig: { ...CONFIG, retriesBeforeDegrade: 1 } });

    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).requirementOverride.mode).toBe('cued'); // L3
    fireEvent.click(screen.getByText('stub-fail'));
    fireEvent.click(await screen.findByText('Try again'));

    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).requirementOverride).toEqual(requirementForLevel(LEVELS[2]));
    expect(h.runProps.at(-1).tier).toBe(2);
  });

  it('D12: Practice this leaves for the unmetered practice route and never grants the match', async () => {
    const { onPassed } = renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-fail'));
    fireEvent.click(await screen.findByText('Practice this'));

    expect(screen.getByTestId('location').textContent)
      .toBe(`/piano/exercises/run/${encodeURIComponent(scaleId('C'))}?intent=practice&mode=free`);
    expect(onPassed).not.toHaveBeenCalled();
    const [, data] = eventNamed('gate.practice-detour');
    expect(data.material).toBe(scaleId('C'));
    expect(data.mode).toBe('free');
  });

  it('walking away is NOT a failure: the ladder does not move, however many times you Exit', async () => {
    // The bug this exists to prevent: if `onExit` counted toward
    // `retriesBeforeDegrade`, a child could press Exit three times per match
    // and arrive at the unfailable floor without ever touching a key — the gate
    // would become a formality that still logs like a gate.
    const { onPassed, onLeave } = renderGate({ learnerId: 'kid1', gateConfig: { ...CONFIG, retriesBeforeDegrade: 1 } });
    const exit = await screen.findByText('stub-exit');
    for (let visit = 0; visit < 4; visit += 1) fireEvent.click(exit);

    expect(onLeave).toHaveBeenCalledTimes(4);
    expect(onPassed).not.toHaveBeenCalled();
    expect(eventNamed('gate.abandoned')).toBeTruthy();
    expect(eventNamed('gate.failed')).toBeUndefined();
    expect(eventNamed('gate.rung-changed')).toBeUndefined();
    expect(stateFor('kid1')).toMatchObject({ levelId: 'L1', failuresAtLevel: 0, cleanPasses: 0 });
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
describe('GameGate — contract 6: what the child is asked, in words they can read', () => {
  it('hands the run its framing, its ask and the level’s tier', async () => {
    renderGate({ learnerId: 'kid1', gameLabel: 'Chess' });
    await screen.findByTestId('exercise-run');

    const props = h.runProps.at(-1);
    expect(props.framing).toBe('Play this to start Chess');
    expect(props.ask).toBe('C major scale, right hand.');
    // A NUMBER. `ExerciseRun` warns and derives its own band for anything else,
    // and a YAML tier arriving as a string would silently take that path.
    expect(props.tier).toBe(2);
    expect(typeof props.tier).toBe('number');
  });

  it('says nothing about a game it was not told the name of, rather than naming `undefined`', async () => {
    // `null` is what a host that has no label hands over, and it is also the
    // component's own default for the prop.
    renderGate({ learnerId: 'kid1', gameLabel: null });
    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).framing).toBeNull();
  });

  it('asks for a lit key at the floor, and hands over a tier-0 synthesized instance', async () => {
    seedGateState('kid1', {
      levelId: BUILT_IN_FLOOR.id, failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0,
    });
    renderGate({ learnerId: 'kid1' });
    await screen.findByTestId('exercise-run');

    const props = h.runProps.at(-1);
    expect(props.ask).toBe('Press the lit key.');
    expect(props.tier).toBe(0);
    expect(props.material.kind).toBe('keys');
    expect(props.material.instance.events).toHaveLength(1);
    // Not one network call between the gate mounting and the key lighting up.
    expect(h.instance).not.toHaveBeenCalled();
    expect(h.instances).not.toHaveBeenCalled();
    expect(h.catalog).not.toHaveBeenCalled();
  });

  it('Try again is a second go at the SAME scale, not the next one along', async () => {
    // The serve advances the rotation counter so a child who walks away does
    // not meet the same ask forever. Re-picking on retry would spend that
    // advance immediately: miss G major, press Try again, be handed D major,
    // and never get the second attempt the button promises.
    seedGateState('kid1', { levelId: 'L2', failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0 });
    renderGate({ learnerId: 'kid1', gateConfig: { ...CONFIG, retriesBeforeDegrade: 3 } });

    await screen.findByTestId('exercise-run');
    const served = h.runProps.at(-1).material.instanceId;
    expect(served).toBe(scaleId('G'));

    for (let go = 0; go < 2; go += 1) {
      fireEvent.click(screen.getByText('stub-fail'));
      fireEvent.click(await screen.findByText('Try again'));
      await screen.findByTestId('exercise-run');
      expect(h.runProps.at(-1).material.instanceId, `retry ${go + 1}`).toBe(served);
      expect(h.runProps.at(-1).ask, `retry ${go + 1}`).toBe('G major scale, right hand.');
    }
    // The retry is still its own attempt in the log — same material, new id.
    const attemptIds = events().filter(([name]) => name === 'gate.attempt').map(([, d]) => d.attemptId);
    expect(attemptIds).toHaveLength(3);
    expect(new Set(attemptIds).size).toBe(3);

    // …and the retries did not SPEND the rotation: the next gate still moves on.
    fireEvent.click(screen.getByText('stub-pass'));
    renderGate({ learnerId: 'kid1' });
    await waitFor(() => expect(h.runProps.at(-1).material.instanceId).toBe(scaleId('D')));
  });

  it('Try again after an EASE serves the eased level’s material, not the held one', async () => {
    // The one case where the material must change: the ladder moved, so the ask
    // is a different ask by definition. Reusing the held attempt here would
    // judge a child against the level they were just moved off.
    seedGateState('kid1', { levelId: 'L2', failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0 });
    renderGate({ learnerId: 'kid1', gateConfig: { ...CONFIG, retriesBeforeDegrade: 1 } });

    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).material.instanceId).toBe(scaleId('G'));
    fireEvent.click(screen.getByText('stub-fail'));
    fireEvent.click(await screen.findByText('Try again'));

    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).material.instanceId).toBe(scaleId('C')); // L1
  });

  it('Try again at the floor lights the SAME key, not the next one', async () => {
    seedGateState('kid1', {
      levelId: BUILT_IN_FLOOR.id, failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0,
    });
    renderGate({ learnerId: 'kid1', gateConfig: { ...CONFIG, retriesBeforeDegrade: 3 } });

    await screen.findByTestId('exercise-run');
    const lit = h.runProps.at(-1).material.instance.events[0].notes[0].midi;
    fireEvent.click(screen.getByText('stub-fail'));
    fireEvent.click(await screen.findByText('Try again'));

    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).material.instance.events[0].notes[0].midi).toBe(lit);
  });

  it('rotates the root, so two consecutive gates at L2 are not the same scale', async () => {
    // A level with three roots that always served the first one would be a
    // three-root level in the config and a one-root level in the child's week.
    seedGateState('kid1', { levelId: 'L2', failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0 });

    const first = renderGate({ learnerId: 'kid1' });
    await screen.findByTestId('exercise-run');
    const firstId = h.runProps.at(-1).material.instanceId;
    first.unmount();

    renderGate({ learnerId: 'kid1' });
    await waitFor(() => expect(h.runProps.at(-1).material.instanceId).not.toBe(firstId));
    const secondId = h.runProps.at(-1).material.instanceId;

    expect([firstId, secondId]).toEqual([scaleId('G'), scaleId('D')]);
    // …and the ask moved with it: the sentence names the scale on the stand.
    expect(h.runProps.at(-1).ask).toBe('D major scale, right hand.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — the run’s own dead ends fail open too', () => {
  it('opens the gate when the run reports a terminal state it cannot leave', async () => {
    const { onPassed } = renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-dead-end'));

    expect(onPassed).toHaveBeenCalledTimes(1);
    const [, data] = eventNamed('gate.unavailable');
    expect(data.error).toBe('run-instance-not-found');
    expect(data.material).toBe(scaleId('C'));
    expect(data.learnerId).toBe('kid1');
  });

  it('does NOT open the match when nobody has chosen a player', async () => {
    // `no-access` is permanent, known, and fixed by one tap — not
    // infrastructure. Failing open on it would make picking Guest a reliable
    // one-tap bypass of the entire gate, which any child who noticed would use
    // every time. D12 holds: this does not reach a match.
    const { onPassed, onLeave } = renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-no-access'));

    expect(onPassed).not.toHaveBeenCalled();
    expect(await screen.findByText('Choose a player first')).toBeTruthy();
    expect(screen.queryByTestId('exercise-run')).toBeNull();
    expect(eventNamed('gate.unavailable')).toBeUndefined();
    expect(eventNamed('gate.blocked')[1].reason).toBe('no-access');

    // …and the panel is escapable, which is what makes refusing to grant fair.
    fireEvent.click(screen.getByText('Leave'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onPassed).not.toHaveBeenCalled();
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
describe('GameGate — contract 7: the floor is announced once per arrival', () => {
  it('logs gate.floor-reached on arriving there, and not again while it sits there', async () => {
    seedGateState('kid1', { levelId: 'L1', failuresAtLevel: 0, cleanPasses: 0, lastMaterialId: null, pickIndex: 0 });
    renderGate({ learnerId: 'kid1', gateConfig: { ...CONFIG, retriesBeforeDegrade: 1 } });

    fireEvent.click(await screen.findByText('stub-fail'));
    expect(readStored('kid1').levelId).toBe(BUILT_IN_FLOOR.id);
    expect(events().filter(([name]) => name === 'gate.floor-reached')).toHaveLength(1);

    fireEvent.click(screen.getByText('Try again'));
    fireEvent.click(await screen.findByText('stub-fail'));
    expect(events().filter(([name]) => name === 'gate.floor-reached')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — contract 8: every event is reconstructable from one query', () => {
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

  it('carries material, level, tier, mode and attemptId on the attempt-shaped events', async () => {
    renderGate({ learnerId: 'kid1' });
    fireEvent.click(await screen.findByText('stub-pass'));

    for (const name of ['gate.presented', 'gate.attempt', 'gate.passed']) {
      const [, data] = eventNamed(name);
      expect(data, name).toMatchObject({
        material: scaleId('C'), rung: 'L1', tier: 2, mode: 'free', attemptId: expect.any(String),
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
    // guest key (the start level) and then write THAT over a struggling child's
    // hard-won position on the first outcome.
    seedGateState('kid1', { levelId: 'L3', failuresAtLevel: 1, cleanPasses: 0, lastMaterialId: null, pickIndex: 0 });
    function Harness() {
      const [learnerId, setLearnerId] = useState(null);
      return (
        <>
          <button type="button" onClick={() => setLearnerId('kid1')}>hydrate</button>
          <GameGate learnerId={learnerId} gateConfig={CONFIG} gameLabel="Tetris" onPassed={() => {}} onLeave={() => {}} />
        </>
      );
    }
    render(<MemoryRouter><Harness /></MemoryRouter>);
    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).requirementOverride.mode).toBe('free'); // guest: the start level

    fireEvent.click(screen.getByText('hydrate'));
    // The resumed level reaches the run: the child is judged on what they earned.
    await waitFor(() => expect(h.runProps.at(-1).requirementOverride.mode).toBe('cued'));

    fireEvent.click(screen.getByText('stub-pass'));
    expect(stateFor('kid1')).toMatchObject({ levelId: 'L3', failuresAtLevel: 0, cleanPasses: 1 });
    // …and the events after hydration name the real child, not the null guest.
    expect(eventNamed('gate.passed')[1].learnerId).toBe('kid1');
  });

  it('stamps the hydrated learner on events even when the resumed level is unchanged', async () => {
    // The case the re-resolve branch does NOT cover, and the one that is
    // common: a new learner, or one still at the start level, resumes the same
    // level already on screen — so `round` is not bumped and the in-flight
    // resolution finishes with whatever `emit` it started with. Capturing
    // `emit` once would send `gate.presented`/`gate.attempt` out stamped
    // `learnerId: null`.
    function Harness() {
      const [learnerId, setLearnerId] = useState(null);
      return (
        <>
          <button type="button" onClick={() => setLearnerId('kid9')}>hydrate</button>
          <GameGate learnerId={learnerId} gateConfig={CONFIG} gameLabel="Tetris" onPassed={() => {}} onLeave={() => {}} />
        </>
      );
    }
    // Hydrate BEFORE the resolution settles — the real race.
    let release;
    h.instance.mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ ok: true, status: 200, data: { id: scaleId('C'), key: 'C', axes: { root: 'C', mode: 'ionian' }, events: [] } });
    }));
    render(<MemoryRouter><Harness /></MemoryRouter>);
    fireEvent.click(screen.getByText('hydrate'));
    release();
    await screen.findByTestId('exercise-run');

    // Same level on both sides, so nothing re-resolved…
    expect(events().filter(([name]) => name === 'gate.attempt')).toHaveLength(1);
    // …and the one attempt still names the child.
    for (const name of ['gate.presented', 'gate.attempt']) {
      expect(eventNamed(name)[1].learnerId, name).toBe('kid9');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveGateConfig — a mistyped number must not become a broken gate', () => {
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

  it('passes the repertoire and startLevel through untouched — the repertoire module validates them', () => {
    // A second validator here would drift from `resolveRepertoire`'s the first
    // time the level schema moved, and a validator that drifts silently sends a
    // child to the wrong level.
    expect(resolveGateConfig({ repertoire: REPERTOIRE }).repertoire).toBe(REPERTOIRE);
    expect(resolveGateConfig({ startLevel: 'L2' }).startLevel).toBe('L2');
    expect(resolveGateConfig({ startLevel: 42 }).startLevel).toBeNull();
    expect(resolveGateConfig({}).repertoire).toBeNull();
  });

  it('survives null and {} without throwing, and never self-enables', () => {
    for (const raw of [null, undefined, {}, 'nonsense', 42]) {
      expect(resolveGateConfig(raw)).toMatchObject({
        enabled: false, every: 'match', retriesBeforeDegrade: 3,
        metered: false, climbAfterCleanPasses: 3,
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GameGate — config defaults', () => {
  it('runs off the built-in fallback level when gateConfig is null or empty', async () => {
    renderGate({ gateConfig: null });
    await screen.findByTestId('exercise-run');
    expect(h.runProps.at(-1).material.instanceId).toBe(FALLBACK_LEVEL.material[0].instanceId);
    expect(h.runProps.at(-1).requirementOverride).toEqual(requirementForLevel(FALLBACK_LEVEL));
    expect(h.runProps.at(-1).intent).toBe('challenge');
    expect(GATE_CONFIG_DEFAULTS.enabled).toBe(false);
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
          <GameGate learnerId="kid1" gateConfig={CONFIG} gameLabel="Tetris" onPassed={() => {}} onLeave={() => {}} />
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
    expect(after.framing).toBe(before.framing);
    // …and nothing re-resolved behind it: one mount, one bank read, one attempt.
    expect(h.instance).toHaveBeenCalledTimes(1);
    expect(events().filter(([name]) => name === 'gate.attempt')).toHaveLength(1);
  });
});
