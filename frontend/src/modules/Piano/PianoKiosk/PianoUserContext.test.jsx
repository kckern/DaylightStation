import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let rosterResponses = [];
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(() => {
    const next = rosterResponses.length ? rosterResponses.shift() : { users: [] };
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }),
}));
import { DaylightAPI } from '../../../lib/api.mjs';
import { PianoUserProvider, usePianoUser } from './PianoUserContext.jsx';

const ROSTER = { users: [{ id: 'kc', name: 'KC' }, { id: 'alice', name: 'Alice' }] };
const wrapper = ({ children }) => createElement(PianoUserProvider, { pianoId: 'test' }, children);

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  localStorage.clear();
  rosterResponses = [ROSTER];
  DaylightAPI.mockClear();
});

describe('PianoUserContext restore', () => {
  it('defaults to the first roster user when nothing is saved', async () => {
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await waitFor(() => expect(result.current.currentUser).toBe('kc'));
  });

  it('restores a saved roster id', async () => {
    localStorage.setItem('piano:user:test', 'alice');
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await waitFor(() => expect(result.current.currentUser).toBe('alice'));
  });

  it('honors an explicit known query user ahead of the saved kiosk user', async () => {
    window.history.replaceState({}, '', '/piano/games/card-game?user=alice');
    localStorage.setItem('piano:user:test', 'kc');
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await waitFor(() => expect(result.current.currentUser).toBe('alice'));
  });

  it('restores a saved Guest selection instead of silently crediting users[0] (F3)', async () => {
    localStorage.setItem('piano:user:test', 'guest');
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await waitFor(() => expect(result.current.currentUser).toBe('guest'));
    expect(result.current.currentProfile).toEqual({ id: 'guest', name: 'Guest' });
  });

  it('ignores a saved id that is not on the roster', async () => {
    localStorage.setItem('piano:user:test', 'stranger');
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await waitFor(() => expect(result.current.currentUser).toBe('kc'));
  });
});

describe('PianoUserContext roster retry (F6)', () => {
  afterEach(() => vi.useRealTimers());

  it('retries a failed roster fetch and recovers', async () => {
    vi.useFakeTimers();
    rosterResponses = [new Error('boom'), ROSTER];
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });       // flush the initial rejection
    expect(result.current.users).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });    // first backoff slot
    expect(result.current.users).toHaveLength(2);
    expect(DaylightAPI).toHaveBeenCalledTimes(2);
  });

  it('gives up after the backoff schedule is exhausted', async () => {
    vi.useFakeTimers();
    rosterResponses = [new Error('a'), new Error('b'), new Error('c'), new Error('d'), new Error('e')];
    const { result } = renderHook(() => usePianoUser(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000 + 5000 + 15000 + 30000 + 1000); });
    expect(DaylightAPI).toHaveBeenCalledTimes(5); // initial + 4 retries, then stop
    expect(result.current.users).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(DaylightAPI).toHaveBeenCalledTimes(5); // no further attempts
  });
});
