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

const props = (phase) => ({
  gameId: 'fixture', phase, initialPhase: 'IDLE', score: 0, metrics: {},
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
});
