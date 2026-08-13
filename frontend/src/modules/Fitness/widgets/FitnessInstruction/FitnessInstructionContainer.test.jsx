import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import FitnessInstructionContainer from './FitnessInstructionContainer.jsx';
import { getModule, getModuleManifest } from '@/modules/Fitness/index.js';
import { manifest } from './index.jsx';

// The runner walks whatever `expandWorkout` produces, and so does the report it
// hands back. Deriving the fixture from the domain rather than hand-writing a step
// list keeps the "what got filed" assertions pinned to the real expansion.
import { expandWorkout } from '../../../../../../backend/src/2_domains/fitness/workout/workout.mjs';

// Capture what the container logs — CLAUDE.md requires the framework logger
// (never console.*), `mounted` at info and every transition at debug.
// The registry import below pulls in every fitness widget (and, transitively,
// Player modules that build module-scope loggers at import time), so the mock
// has to stand in for the whole Logger module and tag each call with the child
// component the assertions filter on.
const logCalls = vi.hoisted(() => ({ debug: [], info: [], warn: [], error: [] }));
vi.mock('@/lib/logging/Logger.js', () => {
  const makeLogger = (ctx = {}) => {
    const push = (bucket) => (event, data) =>
      logCalls[bucket].push({ component: ctx.component ?? null, event, data });
    return {
      debug: push('debug'),
      info: push('info'),
      warn: push('warn'),
      error: push('error'),
      sampled: push('debug'),
      child: (childCtx = {}) => makeLogger({ ...ctx, ...childCtx })
    };
  };
  const getLogger = () => makeLogger();
  const noop = () => {};
  return {
    default: getLogger,
    getLogger,
    configure: noop,
    resetSamplingState: noop,
    getRecentEvents: () => [],
    getConfig: () => ({}),
    startDiagnostics: noop,
    stopDiagnostics: noop,
    perfSnapshot: () => ({}),
    getStatus: () => ({})
  };
});

// The browse state now mounts the real ExerciseBrowser, which fetches the corpus
// and the taxonomy on mount. This suite is about the container's STATE MACHINE,
// not about corpus data, so the API is pinned to a request that never settles:
// the browser stays in its loading state, its header (which owns the
// `fitness-instruction-to-build` target) still renders, and no response lands
// outside act() to muddy these assertions. ExerciseBrowser.test.jsx covers what
// happens when the data arrives.
//
// The ONE exception is the run endpoint: build -> run is a server round trip now
// (the server expands the plan into the runner's ordered step list), so hanging
// that request would hang the state machine this suite exists to test. The tray
// here is empty, so the expanded plan is legitimately empty too — except in the
// "filing a finished run" suite at the bottom, which needs steps to walk and
// swaps `runResponse.steps` for a real expansion.
const runResponse = vi.hoisted(() => ({
  ok: true, workout: { id: null, title: null }, steps: [], exercises: {}, missingSlugs: []
}));
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: (path) => (String(path).endsWith('/workouts/run')
    ? Promise.resolve({ ...runResponse })
    : new Promise(() => {})),
  DaylightAPIText: () => new Promise(() => {}),
  DaylightMediaPath: (p) => `https://kiosk.test/${String(p).replace(/^\/|\/$/g, '')}`,
  DaylightImagePath: (k) => `https://kiosk.test/api/v1/static/img/${k}`,
  DaylightStatusCheck: async () => 200,
  DaylightHostPath: () => 'https://kiosk.test',
  ContentDisplayUrl: () => '',
  normalizeImageUrl: (u) => u,
  DaylightWebsocketSubscribe: () => () => {},
  DaylightWebsocketUnsubscribe: () => () => {}
}));

// The fitness session the module attributes a run to. `null` is the honest default
// here — the container is rendered outside a FitnessProvider in this suite, which
// is exactly the "no fitness app around me" case it has to survive.
const fitnessCtx = vi.hoisted(() => ({ value: null }));
vi.mock('@/context/FitnessContext.jsx', async (importOriginal) => ({
  ...(await importOriginal()),
  useOptionalFitnessContext: () => fitnessCtx.value
}));

const logsFor = (bucket, event) =>
  logCalls[bucket].filter((l) => l.component === 'fitness-instruction' && l.event === event);

/**
 * Tap Start and wait for the run screen. Start is a round trip (the server expands the
 * plan), so the transition lands a tick later — a synchronous assertion would read the
 * builder still on screen.
 */
const startRun = async (q) => {
  fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-run'));
  await q.findByTestId('fitness-instruction-run');
};

// Assert exactly one state is on screen — a transition that lands anywhere else
// (or renders two panels at once) fails here, not just on the panel it expected.
const expectOnlyState = (queries, state) => {
  const { getByTestId, queryByTestId } = queries;
  expect(getByTestId('fitness-instruction').getAttribute('data-state')).toBe(state);
  ['browse', 'build', 'run'].forEach((s) => {
    const panel = queryByTestId(`fitness-instruction-${s}`);
    if (s === state) expect(panel).toBeTruthy();
    else expect(panel).toBeNull();
  });
};

describe('FitnessInstructionContainer', () => {
  beforeEach(() => {
    logCalls.debug.length = 0;
    logCalls.info.length = 0;
    logCalls.warn.length = 0;
    logCalls.error.length = 0;
  });

  it('starts in browse', () => {
    const q = render(<FitnessInstructionContainer />);
    expectOnlyState(q, 'browse');
  });

  it('logs mounted at info', () => {
    render(<FitnessInstructionContainer />);
    const mounted = logsFor('info', 'mounted');
    expect(mounted).toHaveLength(1);
    expect(mounted[0].data).toEqual({ view: 'browse' });
  });

  it('browse -> build when a workout is started', () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    expectOnlyState(q, 'build');
  });

  it('mounts the real builder in build, not a placeholder', () => {
    // The browse mock never resolves, so the tray it hands over is empty — the builder
    // still has to render (and still has to offer the two exits), which is what the
    // state machine tests below then drive.
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    expect(q.getByTestId('workout-builder')).toBeTruthy();
    expect(q.getByTestId('workout-builder-empty')).toBeTruthy();
  });

  it('build -> run when the built workout is started', async () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    await startRun(q);
    expectOnlyState(q, 'run');
  });

  it('run -> browse when the run ends', async () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    await startRun(q);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
    expectOnlyState(q, 'browse');
  });

  it('build -> browse when backing out', () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-build-back'));
    expectOnlyState(q, 'browse');
  });

  it('logs each transition at debug with { from, to }', async () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    await startRun(q);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
    const transitions = logsFor('debug', 'state-transition').map((l) => l.data);
    expect(transitions).toEqual([
      { from: 'browse', to: 'build' },
      { from: 'build', to: 'run' },
      { from: 'run', to: 'browse' }
    ]);
  });

  it('does not advance on a bare click (controls are onPointerDown, not onClick)', () => {
    // A click-only activation would mean the control was wired to onClick — the
    // tap-latency mistake the note at the top of FitnessApp.jsx warns about.
    const q = render(<FitnessInstructionContainer />);
    fireEvent.click(q.getByTestId('fitness-instruction-to-build'));
    expectOnlyState(q, 'browse');
  });

  it('activates on Enter', () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.keyDown(q.getByTestId('fitness-instruction-to-build'), { key: 'Enter' });
    expectOnlyState(q, 'build');
  });

  it('activates on Space', () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.keyDown(q.getByTestId('fitness-instruction-to-build'), { key: ' ' });
    expectOnlyState(q, 'build');
  });

  it('exposes only the legal moves out of each state', async () => {
    const q = render(<FitnessInstructionContainer />);
    // browse: build only
    expect(q.queryByTestId('fitness-instruction-to-build')).toBeTruthy();
    expect(q.queryByTestId('fitness-instruction-to-run')).toBeNull();
    // build: run + back
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    expect(q.queryByTestId('fitness-instruction-to-run')).toBeTruthy();
    expect(q.queryByTestId('fitness-instruction-build-back')).toBeTruthy();
    // run: exit only
    await startRun(q);
    expect(q.queryByTestId('fitness-instruction-run-exit')).toBeTruthy();
    expect(q.queryByTestId('fitness-instruction-to-build')).toBeNull();
  });

  it('calls onMount once', () => {
    const onMount = vi.fn();
    render(<FitnessInstructionContainer onMount={onMount} />);
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('does not re-mount when the parent passes a fresh onMount identity', () => {
    // FitnessModuleContainer supplies an inline arrow, so this happens on every
    // parent render.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<FitnessInstructionContainer onMount={first} />);
    rerender(<FitnessInstructionContainer onMount={second} />);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(logsFor('info', 'mounted')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Filing the finished run.
//
// This is the leg the live flow test (tests/live/flow/fitness/exercise-library
// .runtime.test.mjs, test 6) was red on: the runner had an `onComplete` prop that
// nothing passed, so a finished workout left no trace on any session record. The
// assertions below are the unit-level guard for that wire — drop it and the first
// test here dies.
// ═══════════════════════════════════════════════════════════════════════════
describe('FitnessInstructionContainer — filing a finished run', () => {
  // A superset with no authored rest: 2 exercises x 2 rounds = 4 work steps and
  // nothing else, so the walk below is four taps and the report is unambiguous.
  const PLAN = {
    groups: [{
      rounds: 2,
      exercises: [
        { slug: 'back-squat', sets: 1, reps: 5, restSeconds: 0 },
        { slug: 'push-up', sets: 1, reps: 10, restSeconds: 0 }
      ]
    }]
  };
  const STEPS = expandWorkout(PLAN);

  /** Reach the runner and clear every step. */
  const runToCompletion = async (q) => {
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    await startRun(q);
    for (let i = 0; i < STEPS.length; i += 1) {
      fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
    }
    await q.findByTestId('workout-runner-complete');
  };

  beforeEach(() => {
    ['debug', 'info', 'warn', 'error'].forEach((b) => { logCalls[b].length = 0; });
    fitnessCtx.value = null;
    runResponse.steps = STEPS;
    runResponse.exercises = {};
  });

  it('reports the finished run — the wire the live flow test was red on', async () => {
    const logRun = vi.fn(async () => ({ ok: true, sessionId: 'fs_1', workoutId: 'w1', sets: 4 }));
    const q = render(<FitnessInstructionContainer logRun={logRun} />);
    await runToCompletion(q);

    await waitFor(() => expect(logRun).toHaveBeenCalledTimes(1));
    const [call] = logRun.mock.calls[0];
    expect(call.workout).toBeTruthy();
    expect(call.completedSteps).toHaveLength(4);
  });

  it('files the sets PERFORMED, not the plan', async () => {
    const logRun = vi.fn(async () => ({ ok: true }));
    const q = render(<FitnessInstructionContainer logRun={logRun} />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    await startRun(q);
    // Bail after two of the four sets by ending the run... except an abandoned run
    // is not a completion, so instead walk every step and check the report is the
    // WALKED steps rather than the workout's own group list.
    for (let i = 0; i < STEPS.length; i += 1) {
      fireEvent.pointerDown(q.getByTestId('workout-runner-done'));
    }
    await q.findByTestId('workout-runner-complete');

    await waitFor(() => expect(logRun).toHaveBeenCalled());
    const { completedSteps } = logRun.mock.calls[0][0];
    // Every reported step is one the runner actually walked, and carries the
    // (groupIndex, slug) pair the session record tallies on.
    completedSteps.forEach((s) => {
      expect(STEPS).toContain(s);
      expect(s.kind).toBe('work');
      expect(Number.isInteger(s.groupIndex)).toBe(true);
      expect(typeof s.slug).toBe('string');
    });
    expect(completedSteps.map((s) => s.slug))
      .toEqual(['back-squat', 'push-up', 'back-squat', 'push-up']);
  });

  it('hands over the live fitness session when there is one', async () => {
    const session = { sessionId: 'fs_20260811120000' };
    fitnessCtx.value = { fitnessSessionInstance: session };
    const logRun = vi.fn(async () => ({ ok: true }));
    const q = render(<FitnessInstructionContainer logRun={logRun} />);
    await runToCompletion(q);

    await waitFor(() => expect(logRun).toHaveBeenCalled());
    expect(logRun.mock.calls[0][0].session).toBe(session);
  });

  it('passes a null session through rather than crashing outside a provider', async () => {
    const logRun = vi.fn(async () => ({ ok: true }));
    const q = render(<FitnessInstructionContainer logRun={logRun} />);
    await runToCompletion(q);
    await waitFor(() => expect(logRun).toHaveBeenCalled());
    expect(logRun.mock.calls[0][0].session).toBeNull();
  });

  it('confirms on screen once the run is on the record', async () => {
    const logRun = vi.fn(async () => ({ ok: true, sessionId: 'fs_1', sets: 4 }));
    const q = render(<FitnessInstructionContainer logRun={logRun} />);
    await runToCompletion(q);

    await waitFor(() =>
      expect(q.getByTestId('workout-runner-log').getAttribute('data-log-status')).toBe('ok'));
    expect(logsFor('info', 'run-logged')).toHaveLength(1);
  });

  it('shows a failed filing as a failure — never swallowed into "nice work"', async () => {
    const logRun = vi.fn(async () => ({
      ok: false, reason: 'no_session', message: 'No workout session could be opened.'
    }));
    const q = render(<FitnessInstructionContainer logRun={logRun} />);
    await runToCompletion(q);

    await waitFor(() =>
      expect(q.getByTestId('workout-runner-log').getAttribute('data-log-status')).toBe('failed'));
    expect(q.getByTestId('workout-runner-log-error').textContent)
      .toBe('No workout session could be opened.');
    // And it is on the record as an error, not a debug line nobody reads.
    const failures = logsFor('error', 'run-log-failed');
    expect(failures).toHaveLength(1);
    expect(failures[0].data.reason).toBe('no_session');
  });

  it('surfaces an unexpected throw as a failure too', async () => {
    const logRun = vi.fn(async () => { throw new Error('boom'); });
    const q = render(<FitnessInstructionContainer logRun={logRun} />);
    await runToCompletion(q);

    await waitFor(() =>
      expect(q.getByTestId('workout-runner-log').getAttribute('data-log-status')).toBe('failed'));
    expect(q.getByTestId('workout-runner-log-error').textContent).toBe('boom');
  });

  it('retries the same sets and can succeed the second time', async () => {
    let attempt = 0;
    const logRun = vi.fn(async () => {
      attempt += 1;
      return attempt === 1
        ? { ok: false, reason: 'unknown_session', message: 'not saved yet' }
        : { ok: true, sessionId: 'fs_1' };
    });
    const q = render(<FitnessInstructionContainer logRun={logRun} />);
    await runToCompletion(q);

    await waitFor(() =>
      expect(q.getByTestId('workout-runner-log').getAttribute('data-log-status')).toBe('failed'));
    fireEvent.pointerDown(q.getByTestId('workout-runner-log-retry'));

    await waitFor(() =>
      expect(q.getByTestId('workout-runner-log').getAttribute('data-log-status')).toBe('ok'));
    expect(logRun).toHaveBeenCalledTimes(2);
    expect(logRun.mock.calls[1][0].completedSteps).toHaveLength(4);
  });

  it('clears the recording state when the run screen is left', async () => {
    const logRun = vi.fn(async () => ({ ok: false, reason: 'no_session', message: 'nope' }));
    const q = render(<FitnessInstructionContainer logRun={logRun} />);
    await runToCompletion(q);
    await waitFor(() =>
      expect(q.getByTestId('workout-runner-log').getAttribute('data-log-status')).toBe('failed'));

    fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
    expectOnlyState(q, 'browse');
  });
});

describe('FitnessInstruction registry wiring', () => {
  it('resolves under the namespaced key fitness:instruction', () => {
    expect(getModule('fitness:instruction')).toBe(FitnessInstructionContainer);
    expect(getModuleManifest('fitness:instruction')).toBe(manifest);
  });

  it('resolves under the legacy id fitness_instruction', () => {
    expect(getModule('fitness_instruction')).toBe(FitnessInstructionContainer);
    expect(getModuleManifest('fitness_instruction')?.id).toBe('fitness_instruction');
  });

  it('carries the module manifest fields', () => {
    expect(manifest).toEqual({
      id: 'fitness_instruction',
      name: 'Exercise Library',
      icon: '💪',
      description: 'Browse exercises, build a workout, run it.'
    });
  });
});
