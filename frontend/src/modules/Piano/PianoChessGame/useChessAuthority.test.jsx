import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import incident from '@shared-gaming/rulesets/chess/__fixtures__/incident-74ply.json';
import { useChessAuthority, RESUME_MAX_IDLE_MS } from './useChessAuthority.js';

const USER = 'learner';
const E4 = { from: 'e2', to: 'e4' };
const serverReply = (over = {}) => async () => ({
  window_days: 3,
  game: { game_id: incident.game_id, pinned: false, age_ms: 45776902, record: incident, ...over },
});

beforeEach(() => { window.localStorage.clear(); });

describe('durable resume from the server copy', () => {
  it('rebuilds the exact final position of the real incident game when there is no local checkpoint', async () => {
    const { result } = renderHook(() => useChessAuthority({ userId: USER, seed: 7, fetchResumable: serverReply() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    const history = result.current.session.state.history;
    expect(history).toHaveLength(74);
    expect(history.at(-1)).toMatchObject({ from: 'e4', to: 'd5' });
    expect(result.current.resumeInfo).toMatchObject({ source: 'server', gameId: incident.game_id, plies: 74 });
    // The authority's own board must be the archived one, move for move.
    const { applyMove } = await import('@shared-gaming/rulesets/chess/engine.mjs');
    let fen = incident.initial_fen;
    for (const m of history) fen = applyMove(fen, { from: m.from, to: m.to, promotion: m.promotion }).fen;
    expect(fen).toBe(incident.final_fen);
  });

  it('the incident: a checkpoint idle 12.7h defers to the server copy', async () => {
    const first = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: async () => null }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { await first.result.current.move(E4); });
    first.unmount();
    const realNow = Date.now;
    Date.now = () => realNow() + 12.7 * 3600e3;
    try {
      const second = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: serverReply() }));
      await waitFor(() => expect(second.result.current.ready).toBe(true));
      expect(second.result.current.session.state.history).toHaveLength(74);
    } finally { Date.now = realNow; }
  });

  it('a fresh local checkpoint that continues the server game is used, and the server copy is left alone', async () => {
    const first = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: async () => null }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { await first.result.current.move({ from: incident.moves[0].from, to: incident.moves[0].to }); });
    first.unmount();
    const short = { ...incident, moves: incident.moves.slice(0, 1) };
    const second = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: serverReply({ record: short }) }));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.session.state.history).toHaveLength(1);
    expect(second.result.current.resumeInfo).toBeNull();
  });

  it('a pinned server game beats even a fresh local checkpoint', async () => {
    const first = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: async () => null }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { await first.result.current.move(E4); });
    first.unmount();
    const second = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: serverReply({ pinned: true }) }));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.session.state.history).toHaveLength(74);
    expect(second.result.current.resumeInfo.pinned).toBe(true);
  });

  it('an unusable server copy (wrong player colour) is ignored and starts a new game', async () => {
    const { result } = renderHook(() => useChessAuthority({
      userId: USER, seed: 1, playerColor: 'b', fetchResumable: serverReply(),
    }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.session.state.history).toEqual([]);
  });

  it('a guest never asks the server', async () => {
    const ask = vi.fn(async () => null);
    const { result } = renderHook(() => useChessAuthority({ seed: 1, fetchResumable: ask }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(ask).not.toHaveBeenCalled();
  });

  it('play again after a resume gives an empty board', async () => {
    const { result } = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: serverReply() }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.reset(9); });
    expect(result.current.session.state.history).toEqual([]);
    expect(RESUME_MAX_IDLE_MS).toBeGreaterThan(0);
  });
});


describe('identity arrives late and the decision log', () => {
    it('household start then learner: server game resumed, one decision per resolved start', async () => {
    const ask = vi.fn(serverReply());
    const { result, rerender } = renderHook(({ u }) => useChessAuthority({ userId: u, seed: 7, fetchResumable: ask }), { initialProps: { u: 'household' } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(ask).not.toHaveBeenCalled();
    rerender({ u: 'test-learner' });
    await waitFor(() => expect(result.current.session.state.history).toHaveLength(74));
    expect(ask).toHaveBeenCalledWith('test-learner');
    expect(result.current.resumeInfo).toMatchObject({ source: 'server' });
  });

  it('a board with moves is never replaced by a late identity', async () => {
    const ask = vi.fn(serverReply());
    const { result, rerender } = renderHook(({ u }) => useChessAuthority({ userId: u, seed: 7, fetchResumable: ask }), { initialProps: { u: 'household' } });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.move(E4); });
    rerender({ u: 'test-learner' });
    await new Promise((r) => setTimeout(r, 50));
    expect(ask).not.toHaveBeenCalled();
    expect(result.current.session.state.history).toHaveLength(1);
  });

  it('an unrelated fresh local checkpoint loses to the open server game (2026-10-09 tablet)', async () => {
    const first = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: async () => null }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { await first.result.current.move({ from: 'd2', to: 'd4' }); });
    first.unmount();
    const second = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: serverReply() }));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.session.state.history).toHaveLength(74);
  });

  it('a server timeout still starts a game', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: () => new Promise(() => {}) }));
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.session.state.history).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
