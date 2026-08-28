/**
 * useCheckpointGate — the school-side gate authority.
 *
 * Every case below is stated in terms of what a CHILD can do, because that is
 * the promise: a checkpoint must not be walkable-past. The pure core is tested
 * directly (it is where all the arithmetic lives) and the hook wrapper is
 * tested through `renderHook` for the two things only React can show: the log
 * fires on the EDGE rather than per render, and `dueCheckpoint` keeps its
 * identity across renders.
 *
 * Several assertions run the verdict through the REAL `resolvePause`. That is
 * deliberate: the failure this hook is most likely to have is a verdict that
 * blocks correctly but names itself wrong (`reason:` instead of `id:`), and
 * only the arbiter can see that.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { resolvePause, PAUSE_REASON } from '../../../lib/Player/gate/pauseArbiter.js';
import { GATE_ID } from '../../../lib/Player/gate/gateIds.js';
import { useCheckpointGate, deriveCheckpointGate, APPROACH_WINDOW_S } from './useCheckpointGate.js';

/** Authored shape as the lesson-session API hands it over: `{ id, at }`. */
const CPS = [
  { id: 'cp-100', at: 100, items: ['q1'] },
  { id: 'cp-200', at: 200, items: ['q2'] },
  { id: 'cp-300', at: 300, items: ['q3'] }
];

const fakeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()
});

describe('deriveCheckpointGate — the gate predicate', () => {
  it('does not block before the first checkpoint, but clamps the seek to it', () => {
    const { verdict, dueCheckpoint, approaching } = deriveCheckpointGate({
      position: 10, checkpoints: CPS, clearedIds: []
    });
    expect(verdict.blocked).toBe(false);
    expect(verdict.seekCeiling).toBe(100);
    expect(dueCheckpoint).toBeNull();
    expect(approaching).toBe(false);
  });

  it('blocks at EXACTLY the authored second — the boundary is inclusive', () => {
    const { verdict, dueCheckpoint } = deriveCheckpointGate({
      position: 100, checkpoints: CPS, clearedIds: []
    });
    expect(verdict.blocked).toBe(true);
    expect(dueCheckpoint.id).toBe('cp-100');
  });

  it('does not block one tick early', () => {
    expect(deriveCheckpointGate({ position: 99.9, checkpoints: CPS, clearedIds: [] }).verdict.blocked).toBe(false);
  });

  it('names itself with `id` so the arbiter can identify it (NOT `reason`)', () => {
    const { verdict } = deriveCheckpointGate({ position: 100, checkpoints: CPS, clearedIds: [] });
    expect(verdict.id).toBe(GATE_ID.CHECKPOINT);
    const decision = resolvePause({ gates: [verdict] });
    expect(decision.paused).toBe(true);
    expect(decision.reason).toBe(PAUSE_REASON.GATE);
    expect(decision.gate).toBe(GATE_ID.CHECKPOINT);   // not the 'gate' fallback
    expect(decision.seekCeiling).toBe(100);
  });

  it('releases once the due checkpoint is cleared, and moves the ceiling on', () => {
    const { verdict, dueCheckpoint } = deriveCheckpointGate({
      position: 100, checkpoints: CPS, clearedIds: ['cp-100']
    });
    expect(verdict.blocked).toBe(false);
    expect(dueCheckpoint).toBeNull();
    expect(verdict.seekCeiling).toBe(200);
  });

  it('is UNCLAMPED once every checkpoint is cleared (null, never 0)', () => {
    const { verdict } = deriveCheckpointGate({
      position: 500, checkpoints: CPS, clearedIds: ['cp-100', 'cp-200', 'cp-300']
    });
    expect(verdict.blocked).toBe(false);
    expect(verdict.seekCeiling).toBeNull();
  });

  it('owes the FIRST uncleared checkpoint, not the nearest — a child who seeks to the end still answers them all in order', () => {
    const { verdict, dueCheckpoint } = deriveCheckpointGate({
      position: 999, checkpoints: CPS, clearedIds: []
    });
    expect(verdict.blocked).toBe(true);
    expect(dueCheckpoint.id).toBe('cp-100');
    expect(verdict.seekCeiling).toBe(100);
  });

  it('accepts clearedIds as a Set as well as an array', () => {
    const asSet = deriveCheckpointGate({ position: 100, checkpoints: CPS, clearedIds: new Set(['cp-100']) });
    expect(asSet.verdict.blocked).toBe(false);
    expect(asSet.verdict.seekCeiling).toBe(200);
  });

  it('derives `cp-<at>` when the payload carries only `at` — the server spells ids the same way', () => {
    const bare = [{ at: 100 }, { at: 200 }];
    expect(deriveCheckpointGate({ position: 150, checkpoints: bare, clearedIds: [] }).dueCheckpoint.id).toBe('cp-100');
    expect(deriveCheckpointGate({ position: 150, checkpoints: bare, clearedIds: ['cp-100'] }).verdict.blocked).toBe(false);
  });
});

describe('deriveCheckpointGate — the approach signal', () => {
  it('pulses inside the window, at its far edge', () => {
    expect(deriveCheckpointGate({ position: 100 - APPROACH_WINDOW_S, checkpoints: CPS, clearedIds: [] }).approaching).toBe(true);
    expect(deriveCheckpointGate({ position: 96, checkpoints: CPS, clearedIds: [] }).approaching).toBe(true);
  });

  it('does not pulse before the window opens', () => {
    expect(deriveCheckpointGate({ position: 94.9, checkpoints: CPS, clearedIds: [] }).approaching).toBe(false);
  });

  it('stops pulsing once the checkpoint has actually fired — the pulse is a WARNING, not a state', () => {
    expect(deriveCheckpointGate({ position: 100, checkpoints: CPS, clearedIds: [] }).approaching).toBe(false);
  });

  it('never pulses for a checkpoint the child already cleared (the rewind case)', () => {
    // Child cleared cp-100, chose "rewind and rewatch", and is now replaying at 97.
    // A ✓ node that pulses teaches the child the warning means nothing.
    const { approaching, verdict } = deriveCheckpointGate({
      position: 97, checkpoints: CPS, clearedIds: ['cp-100']
    });
    expect(approaching).toBe(false);
    expect(verdict.seekCeiling).toBe(200);
  });

  it('pulses for the next UNCLEARED checkpoint when the previous one is cleared', () => {
    expect(deriveCheckpointGate({ position: 197, checkpoints: CPS, clearedIds: ['cp-100'] }).approaching).toBe(true);
  });
});

describe('deriveCheckpointGate — malformed input on a kiosk', () => {
  it.each([
    ['no argument at all', undefined],
    ['null checkpoints', { position: 100, checkpoints: null }],
    ['undefined checkpoints', { position: 100 }],
    ['empty checkpoints', { position: 100, checkpoints: [] }],
    ['a non-array', { position: 100, checkpoints: { at: 100 } }],
    ['null entries', { position: 100, checkpoints: [null, undefined] }],
    ['entries with no `at`', { position: 100, checkpoints: [{ id: 'cp-x' }] }],
    ['a NaN `at`', { position: 100, checkpoints: [{ id: 'cp-x', at: NaN }] }],
    ['a string `at`', { position: 100, checkpoints: [{ id: 'cp-x', at: '100' }] }],
    ['a null clearedIds', { position: 100, checkpoints: CPS, clearedIds: null }],
    ['a garbage clearedIds', { position: 100, checkpoints: CPS, clearedIds: 42 }]
  ])('never throws on %s', (_label, input) => {
    expect(() => deriveCheckpointGate(input)).not.toThrow();
    const out = deriveCheckpointGate(input);
    expect(typeof out.verdict.blocked).toBe('boolean');
    expect(out.verdict.id).toBe(GATE_ID.CHECKPOINT);
  });

  it('an unusable checkpoint LIST leaves playback ungated — there is no question to ask, and the backend still refuses completion', () => {
    for (const checkpoints of [null, undefined, [], { at: 1 }, 'nope']) {
      const { verdict } = deriveCheckpointGate({ position: 500, checkpoints, clearedIds: [] });
      expect(verdict.blocked).toBe(false);
      expect(verdict.seekCeiling).toBeNull();
    }
  });

  it('a garbage clearedIds means NOTHING is cleared — the safe direction is to re-ask', () => {
    for (const clearedIds of [null, undefined, 42, 'cp-100', { 'cp-100': true }]) {
      const { verdict, dueCheckpoint } = deriveCheckpointGate({ position: 100, checkpoints: CPS, clearedIds });
      expect(verdict.blocked).toBe(true);
      expect(dueCheckpoint.id).toBe('cp-100');
    }
  });

  it('skips an entry with no usable `at` but still honours its neighbours', () => {
    const mixed = [{ id: 'bad' }, { id: 'cp-200', at: 200 }];
    const { verdict, dueCheckpoint } = deriveCheckpointGate({ position: 250, checkpoints: mixed, clearedIds: [] });
    expect(verdict.blocked).toBe(true);
    expect(dueCheckpoint.id).toBe('cp-200');
    expect(verdict.seekCeiling).toBe(200);
  });

  it('an unknown position blocks nothing but still reports the ceiling', () => {
    for (const position of [undefined, null, NaN, Infinity, '100']) {
      const { verdict, dueCheckpoint, approaching } = deriveCheckpointGate({ position, checkpoints: CPS, clearedIds: [] });
      expect(verdict.blocked).toBe(false);
      expect(dueCheckpoint).toBeNull();
      expect(approaching).toBe(false);
      expect(verdict.seekCeiling).toBe(100);
    }
  });
});

/**
 * TWIN PARITY — the whole reason this file's arithmetic is duplicated by hand.
 *
 * The TEST may import the backend domain module even though the runtime module
 * may not (a bundler pulling backend code into the browser is the thing the
 * duplication exists to avoid). So the copy is checked against the original
 * directly, over a table that includes the shapes a validator would reject —
 * the API is not obliged to send only valid lists, and a divergence on those
 * is exactly the kind that goes unnoticed until a child walks past a gate.
 */
describe('parity with the backend twin (mediaCheckpoints.mjs)', () => {
  const CASES = [
    ['before the first', 10, CPS, []],
    ['exactly on it', 100, CPS, []],
    ['a hair before', 99.999, CPS, []],
    ['past everything, nothing cleared', 9999, CPS, []],
    ['first cleared', 150, CPS, ['cp-100']],
    ['all cleared', 9999, CPS, ['cp-100', 'cp-200', 'cp-300']],
    ['middle cleared, earlier one still owed', 250, CPS, ['cp-200']],
    // Not ascending: the validator refuses to publish this, but nothing stops
    // the API from serving it, and the two must still agree.
    ['out of order', 150, [{ id: 'cp-300', at: 300 }, { id: 'cp-100', at: 100 }], []],
    ['out of order, first cleared', 150, [{ id: 'cp-300', at: 300 }, { id: 'cp-100', at: 100 }], ['cp-300']],
    ['empty list', 150, [], []],
    ['zero position', 0, CPS, []]
  ];

  it.each(CASES)('agrees on %s', async (_label, position, checkpoints, cleared) => {
    const twin = await import('../../../../../backend/src/2_domains/school/mediaCheckpoints.mjs');
    const clearedSet = new Set(cleared);
    const mine = deriveCheckpointGate({ position, checkpoints, clearedIds: cleared });
    const theirs = twin.dueCheckpoint(position, checkpoints, clearedSet);

    expect(mine.dueCheckpoint?.id ?? null).toBe(theirs?.id ?? null);
    expect(mine.verdict.blocked).toBe(theirs !== null);
    expect(mine.verdict.seekCeiling).toBe(twin.seekCeilingFor(checkpoints, clearedSet));
  });
});

describe('useCheckpointGate — the hook wrapper', () => {
  it('returns the same derivation as the pure core', () => {
    const { result } = renderHook(() => useCheckpointGate({ position: 100, checkpoints: CPS, clearedIds: [] }));
    expect(result.current.verdict).toEqual({ blocked: true, id: GATE_ID.CHECKPOINT, seekCeiling: 100 });
    expect(result.current.dueCheckpoint.id).toBe('cp-100');
  });

  it('hands back the AUTHORED entry, identically, across renders — so a consumer may depend on its identity', () => {
    const { result, rerender } = renderHook((props) => useCheckpointGate(props), {
      initialProps: { position: 100, checkpoints: CPS, clearedIds: [] }
    });
    const first = result.current.dueCheckpoint;
    expect(first).toBe(CPS[0]);
    rerender({ position: 101, checkpoints: CPS, clearedIds: [] });
    expect(result.current.dueCheckpoint).toBe(first);
  });

  it('logs the block ONCE on the edge, not once per position tick, and logs the release', () => {
    const logger = fakeLogger();
    const { rerender } = renderHook((props) => useCheckpointGate(props), {
      initialProps: { position: 10, checkpoints: CPS, clearedIds: [], logger }
    });
    expect(logger.info).not.toHaveBeenCalled();

    rerender({ position: 100, checkpoints: CPS, clearedIds: [], logger });
    rerender({ position: 100.25, checkpoints: CPS, clearedIds: [], logger });
    rerender({ position: 100.5, checkpoints: CPS, clearedIds: [], logger });
    const blocks = logger.info.mock.calls.filter(([event]) => event === 'checkpoint.gate.blocked');
    expect(blocks).toHaveLength(1);
    expect(blocks[0][1]).toMatchObject({ checkpointId: 'cp-100', at: 100 });

    rerender({ position: 100.5, checkpoints: CPS, clearedIds: ['cp-100'], logger });
    const releases = logger.info.mock.calls.filter(([event]) => event === 'checkpoint.gate.released');
    expect(releases).toHaveLength(1);
    expect(releases[0][1]).toMatchObject({ checkpointId: 'cp-100' });
  });

  it('does not re-announce the SAME checkpoint when something else in the verdict moves', () => {
    // The effect is keyed on the ceiling too, so a ceiling that moves while the
    // same checkpoint stays due re-runs it. Without the announced-id guard that
    // re-run would log a release AND a second block for a checkpoint the child
    // never got past. (Reachable with an out-of-order list — the validator
    // refuses to publish one, but the hook is fed by an API, not the validator.)
    const logger = fakeLogger();
    const outOfOrder = [{ id: 'cp-300', at: 300 }, { id: 'cp-100', at: 100 }];
    const { result, rerender } = renderHook((props) => useCheckpointGate(props), {
      initialProps: { position: 150, checkpoints: outOfOrder, clearedIds: [], logger }
    });
    expect(result.current.dueCheckpoint.id).toBe('cp-100');
    expect(result.current.verdict.seekCeiling).toBe(300);

    rerender({ position: 150, checkpoints: outOfOrder, clearedIds: ['cp-300'], logger });
    expect(result.current.dueCheckpoint.id).toBe('cp-100');   // still owed
    expect(result.current.verdict.seekCeiling).toBe(100);     // ceiling moved

    expect(logger.info.mock.calls.filter(([e]) => e === 'checkpoint.gate.blocked')).toHaveLength(1);
    expect(logger.info.mock.calls.filter(([e]) => e === 'checkpoint.gate.released')).toHaveLength(0);
  });

  it('logs a SECOND block when a different checkpoint fires', () => {
    const logger = fakeLogger();
    const { rerender } = renderHook((props) => useCheckpointGate(props), {
      initialProps: { position: 100, checkpoints: CPS, clearedIds: [], logger }
    });
    rerender({ position: 200, checkpoints: CPS, clearedIds: ['cp-100'], logger });
    const blocks = logger.info.mock.calls.filter(([event]) => event === 'checkpoint.gate.blocked');
    expect(blocks.map(([, data]) => data.checkpointId)).toEqual(['cp-100', 'cp-200']);
  });

  it('does not throw when called with nothing at all', () => {
    const { result } = renderHook(() => useCheckpointGate());
    expect(result.current.verdict.blocked).toBe(false);
    expect(result.current.verdict.seekCeiling).toBeNull();
  });
});
