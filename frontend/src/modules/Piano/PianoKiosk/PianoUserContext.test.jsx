import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
