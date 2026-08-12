import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import FitnessInstructionContainer from './FitnessInstructionContainer.jsx';
import { getModule, getModuleManifest } from '@/modules/Fitness/index.js';
import { manifest } from './index.jsx';

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
vi.mock('@/lib/api.mjs', () => ({
  DaylightAPI: () => new Promise(() => {}),
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

const logsFor = (bucket, event) =>
  logCalls[bucket].filter((l) => l.component === 'fitness-instruction' && l.event === event);

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

  it('build -> run when the built workout is started', () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-run'));
    expectOnlyState(q, 'run');
  });

  it('run -> browse when the run ends', () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-run'));
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-run-exit'));
    expectOnlyState(q, 'browse');
  });

  it('build -> browse when backing out', () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-build-back'));
    expectOnlyState(q, 'browse');
  });

  it('logs each transition at debug with { from, to }', () => {
    const q = render(<FitnessInstructionContainer />);
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-run'));
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

  it('exposes only the legal moves out of each state', () => {
    const q = render(<FitnessInstructionContainer />);
    // browse: build only
    expect(q.queryByTestId('fitness-instruction-to-build')).toBeTruthy();
    expect(q.queryByTestId('fitness-instruction-to-run')).toBeNull();
    // build: run + back
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-build'));
    expect(q.queryByTestId('fitness-instruction-to-run')).toBeTruthy();
    expect(q.queryByTestId('fitness-instruction-build-back')).toBeTruthy();
    // run: exit only
    fireEvent.pointerDown(q.getByTestId('fitness-instruction-to-run'));
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
