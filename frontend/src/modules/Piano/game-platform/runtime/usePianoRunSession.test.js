import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const authority = vi.hoisted(() => {
  let nextId = 0;
  const create = vi.fn(async () => ({
    header: { session_id: `run:${nextId++}`, revision: 0, status: 'active' },
  }));
  const dispatch = vi.fn(async (sessionId, envelope) => ({
    header: {
      session_id: sessionId,
      revision: envelope.expected_revision + 1,
      status: envelope.command.phase === 'COMPLETE' ? 'complete' : 'active',
    },
  }));
  return { create, dispatch, reset: () => { nextId = 0; create.mockClear(); dispatch.mockClear(); } };
});

vi.mock('../../../Gaming/platform/authority/createEphemeralLocalAuthority.js', () => ({
  createEphemeralLocalAuthority: () => authority,
}));

import { usePianoRunSession } from './usePianoRunSession.js';

const props = (phase, score = 0, metrics = {}) => ({
  gameId: 'fixture', phase, initialPhase: 'IDLE', score, metrics,
  activePhases: ['IDLE', 'PLAYING'], terminalPhases: ['COMPLETE'], logger: { error: vi.fn() },
});

describe('usePianoRunSession', () => {
  beforeEach(() => authority.reset());

  it('commits native phases and gives a replay a new protocol session', async () => {
    const hook = renderHook(({ phase }) => usePianoRunSession(props(phase)), { initialProps: { phase: 'IDLE' } });
    await waitFor(() => expect(authority.dispatch).toHaveBeenCalledTimes(1));
    expect(authority.dispatch.mock.calls[0][0]).toBe('run:0');

    hook.rerender({ phase: 'COMPLETE' });
    await waitFor(() => expect(authority.dispatch).toHaveBeenCalledTimes(2));
    expect(authority.dispatch.mock.calls[1][0]).toBe('run:0');

    hook.rerender({ phase: 'IDLE' });
    await waitFor(() => expect(authority.dispatch).toHaveBeenCalledTimes(3));
    expect(authority.create).toHaveBeenCalledTimes(2);
    expect(authority.dispatch.mock.calls[2][0]).toBe('run:1');
    expect(authority.dispatch.mock.calls[2][1]).toMatchObject({ expected_revision: 0, command: { sequence: 0, phase: 'IDLE' } });
  });

  // A game's score advances every animation frame. Each dispatch appends to the
  // session journal, which the coordinator re-reads and fully replays on every
  // subsequent dispatch -- so syncing per frame is quadratic in frames and its
  // structuredClone eventually exhausts the tab. The protocol session records
  // the run's lifecycle, so only a phase change may commit.
  it('does not commit when only score or metrics move', async () => {
    const hook = renderHook(
      ({ phase, score, metrics }) => usePianoRunSession(props(phase, score, metrics)),
      { initialProps: { phase: 'PLAYING', score: 0, metrics: { health: 28 } } },
    );
    await waitFor(() => expect(authority.dispatch).toHaveBeenCalledTimes(1));

    for (let frame = 1; frame <= 120; frame += 1) {
      hook.rerender({ phase: 'PLAYING', score: frame * 1.5, metrics: { health: 28 - frame / 10 } });
    }
    await Promise.resolve();
    expect(authority.dispatch).toHaveBeenCalledTimes(1);
  });

  it('carries the score and metrics standing at the phase change', async () => {
    const hook = renderHook(
      ({ phase, score, metrics }) => usePianoRunSession(props(phase, score, metrics)),
      { initialProps: { phase: 'PLAYING', score: 0, metrics: { health: 28 } } },
    );
    await waitFor(() => expect(authority.dispatch).toHaveBeenCalledTimes(1));

    hook.rerender({ phase: 'PLAYING', score: 942, metrics: { health: 3, distance: undefined } });
    hook.rerender({ phase: 'COMPLETE', score: 942, metrics: { health: 3, distance: undefined } });
    await waitFor(() => expect(authority.dispatch).toHaveBeenCalledTimes(2));

    const command = authority.dispatch.mock.calls[1][1].command;
    expect(command).toMatchObject({ phase: 'COMPLETE', score: 942, metrics: { health: 3 } });
    // undefined-valued metrics are dropped, never handed to canonicalStringify
    expect(Object.keys(command.metrics)).toEqual(['health']);
  });
});
