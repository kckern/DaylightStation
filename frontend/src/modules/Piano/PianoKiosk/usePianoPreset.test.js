import { act, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let server = {};
let getFailure = false;
let putFailures = 0;
const calls = [];
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: vi.fn(async (path, data = {}, method = 'GET') => {
  calls.push({ path, data, method });
  if (method === 'GET') { if (getFailure) throw new Error('offline'); return structuredClone(server); }
  if (putFailures-- > 0) throw new Error('write failed');
  server = { ...server, ...data };
  return structuredClone(server);
}) }));

let currentUser = 'user_1';
vi.mock('./PianoUserContext.jsx', () => ({ usePianoUser: () => ({ currentUser, currentProfile: currentUser === 'guest' ? { name: 'Guest' } : { name: 'Alex' } }) }));
let currentBundle = { voice: { pc: 0, bank: 0, name: 'Grand' }, reverb: null, chorus: null };
const applyBundle = vi.fn();
vi.mock('./usePianoSoundBundle.js', () => ({ usePianoSoundBundle: () => ({ applyBundle, currentBundle }) }));

import { PianoPresetProvider, sameSoundPreset, sanitizeSoundPreset, usePianoPreset } from './usePianoPreset.js';

const wrapper = ({ children }) => createElement(PianoPresetProvider, null, children);
const sound = (pc, bank = 0, extra = {}) => ({ voice: { pc, bank, name: `Voice ${pc}` }, reverb: null, chorus: null, ...extra });

beforeEach(() => {
  server = {}; getFailure = false; putFailures = 0; calls.length = 0; currentUser = 'user_1';
  currentBundle = sound(0); applyBundle.mockClear(); vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('sanitizeSoundPreset', () => {
  it('normalizes bank and discards legacy volume', () => expect(sanitizeSoundPreset({ voice: { pc: 4 }, reverb: null, chorus: null, volume: 0.2 })).toEqual(sound(4, 0, { voice: { pc: 4, bank: 0 } })));
  it('compares semantic voice/effect state independent of object key order and metadata', () => {
    expect(sameSoundPreset(
      { voice: { pc: 4 }, reverb: { on: true, level: 64, type: 2, label: 'Hall' }, chorus: null },
      { voice: { bank: 0, pc: 4, name: 'Piano' }, reverb: { type: 2, level: 64, on: true }, chorus: null },
    )).toBe(true);
  });
});

describe('usePianoPreset', () => {
  it('hydrates and applies the named player last sound without volume', async () => {
    server = { default: { ...sound(4), volume: 0.25 }, favorites: [{ ...sound(8), volume: 1 }] };
    const { result } = renderHook(() => usePianoPreset(), { wrapper });
    await act(async () => {});
    expect(result.current.loaded).toBe(true);
    expect(result.current.preset.default).not.toHaveProperty('volume');
    expect(result.current.preset.favorites[0]).not.toHaveProperty('volume');
    expect(applyBundle).toHaveBeenCalledWith(sound(4));
  });

  it('debounces edits for 750ms and skips initial hydration', async () => {
    const { result, rerender } = renderHook(() => usePianoPreset(), { wrapper });
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    currentBundle = sound(5); rerender();
    await act(async () => { vi.advanceTimersByTime(749); });
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1); });
    await act(async () => {});
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(result.current.persistenceState).toBe('remembered');
    expect(calls.find((call) => call.method === 'PUT').data.default).not.toHaveProperty('volume');
  });

  it('never writes after failed hydration', async () => {
    getFailure = true;
    renderHook(() => usePianoPreset(), { wrapper });
    await act(async () => {});
    currentBundle = sound(9);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('cancels a pending write on player switch', async () => {
    const { rerender } = renderHook(() => usePianoPreset(), { wrapper });
    await act(async () => {});
    currentBundle = sound(3); rerender();
    currentUser = 'user_2'; rerender();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(calls.filter((call) => call.method === 'PUT' && call.path.includes('user_1'))).toHaveLength(0);
  });

  it('Guest performs no fetch, writes, or optimistic mutations', async () => {
    currentUser = 'guest';
    const { result } = renderHook(() => usePianoPreset(), { wrapper });
    await act(async () => {});
    const before = result.current.preset;
    await act(async () => { await result.current.saveFavorite(sound(2)); await result.current.removeFavorite(sound(2)); await result.current.saveDefault(sound(2)); });
    expect(calls).toHaveLength(0);
    expect(result.current.preset).toEqual(before);
  });

  it('reports a failed last-sound write and retries it', async () => {
    putFailures = 1;
    const { result, rerender } = renderHook(() => usePianoPreset(), { wrapper });
    await act(async () => {});
    currentBundle = sound(6); rerender();
    await act(async () => { vi.advanceTimersByTime(750); });
    await act(async () => {});
    expect(result.current.persistenceState).toBe('failed');
    await act(async () => { await result.current.retryLastSound(); });
    expect(result.current.persistenceState).toBe('remembered');
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(2);
  });

  it('updates one favorite per normalized instrument, removes it, and enforces eight new instruments', async () => {
    server = { favorites: Array.from({ length: 8 }, (_, pc) => sound(pc)) };
    const { result } = renderHook(() => usePianoPreset(), { wrapper });
    await act(async () => {});
    await act(async () => { expect(await result.current.saveFavorite(sound(9))).toMatchObject({ ok: false, reason: 'limit' }); });
    await act(async () => { expect((await result.current.saveFavorite(sound(0, undefined, { reverb: { type: 1, level: 32, on: true } }))).ok).toBe(true); });
    expect(result.current.preset.favorites).toHaveLength(8);
    expect(result.current.preset.favorites.filter((favorite) => favorite.voice.pc === 0)).toHaveLength(1);
    await act(async () => { await result.current.removeFavorite(sound(0)); });
    expect(result.current.preset.favorites).toHaveLength(7);
  });
});
