import { describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePlaybackUnlockGate } from './usePlaybackUnlockGate.js';

const RULES = { lock: 'kids_playback', labels: ['KidsFun'], libraries: ['TV Shows'] };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function setup({ item, fetchInfo = vi.fn(async () => ({})), active = true, preGranted = false }) {
  const scans = [];
  const registerUnlock = vi.fn(() => { const d = deferred(); scans.push(d); return d.promise; });
  const clearUnlock = vi.fn();
  const onCancel = vi.fn();
  const props = { currentItem: item, active, rules: RULES, preGranted, registerUnlock, clearUnlock, onCancel, fetchInfo };
  const hook = renderHook((p) => usePlaybackUnlockGate(p), { initialProps: props });
  return { hook, props, scans, registerUnlock, clearUnlock, onCancel, fetchInfo };
}

describe('usePlaybackUnlockGate', () => {
  it('holds a KidsFun episode and asks for the kids_playback fingerprint', async () => {
    const { hook, registerUnlock } = setup({ item: { id: '1', plex: '1', labels: ['kidsfun'], grandparentId: 'show-a' } });
    expect(hook.result.current.blocked).toBe(true);
    await waitFor(() => expect(hook.result.current.promptOpen).toBe(true));
    expect(registerUnlock).toHaveBeenCalledWith('kids_playback');
  });

  it('releases on a matching scan and does not re-prompt for the next episode of that show', async () => {
    const { hook, props, scans, registerUnlock } = setup({ item: { id: '1', plex: '1', labels: ['kidsfun'], grandparentId: 'show-a' } });
    await waitFor(() => expect(scans).toHaveLength(1));
    await act(async () => { scans[0].resolve({ matched: true, userId: 'parent' }); });
    expect(hook.result.current.blocked).toBe(false);
    expect(hook.result.current.promptOpen).toBe(false);

    hook.rerender({ ...props, currentItem: { id: '2', plex: '2', labels: ['kidsfun'], grandparentId: 'show-a' } });
    expect(hook.result.current.blocked).toBe(false);
    expect(registerUnlock).toHaveBeenCalledTimes(1);
  });

  it('stays blocked after a wrong finger', async () => {
    const { hook, scans } = setup({ item: { id: '1', plex: '1', labels: ['kidsfun'], grandparentId: 'show-a' } });
    await waitFor(() => expect(scans).toHaveLength(1));
    await act(async () => { scans[0].resolve({ matched: false }); });
    expect(hook.result.current.blocked).toBe(true);
  });

  it('looks up the library for an unlabeled item and gates TV Shows', async () => {
    const fetchInfo = vi.fn(async () => ({ librarySectionTitle: 'TV Shows' }));
    const { hook, registerUnlock } = setup({ item: { id: '7', plex: '7', labels: [] }, fetchInfo });
    expect(hook.result.current.blocked).toBe(true); // held while classifying
    await waitFor(() => expect(registerUnlock).toHaveBeenCalled());
    expect(fetchInfo).toHaveBeenCalledWith('7');
  });

  it('lets an unlabeled item from another library play', async () => {
    const fetchInfo = vi.fn(async () => ({ librarySectionTitle: 'Fitness' }));
    const { hook, registerUnlock } = setup({ item: { id: '8', plex: '8', labels: [] }, fetchInfo });
    await waitFor(() => expect(hook.result.current.blocked).toBe(false));
    expect(registerUnlock).not.toHaveBeenCalled();
  });

  it('fails closed when the library lookup errors', async () => {
    const fetchInfo = vi.fn(async () => { throw new Error('offline'); });
    const { hook, registerUnlock } = setup({ item: { id: '9', plex: '9', labels: [] }, fetchInfo });
    await waitFor(() => expect(registerUnlock).toHaveBeenCalled());
    expect(hook.result.current.blocked).toBe(true);
  });

  it('does nothing when the lock is not active', () => {
    const { hook, registerUnlock } = setup({ item: { id: '1', plex: '1', labels: ['kidsfun'] }, active: false });
    expect(hook.result.current.blocked).toBe(false);
    expect(registerUnlock).not.toHaveBeenCalled();
  });

  it('accepts an earlier adult scan carried on the item (governance bypass)', () => {
    const { hook, registerUnlock } = setup({ item: { id: '1', plex: '1', labels: ['kidsfun'] }, preGranted: true });
    expect(hook.result.current.blocked).toBe(false);
    expect(registerUnlock).not.toHaveBeenCalled();
  });

  it('is off when the yml names no lock', () => {
    const registerUnlock = vi.fn();
    const { result } = renderHook(() => usePlaybackUnlockGate({
      currentItem: { id: '1', plex: '1', labels: ['kidsfun'] }, active: true,
      rules: { labels: ['KidsFun'] }, registerUnlock, clearUnlock: vi.fn(), onCancel: vi.fn(), fetchInfo: vi.fn(),
    }));
    expect(result.current.blocked).toBe(false);
    expect(registerUnlock).not.toHaveBeenCalled();
  });

  it('cancel closes the prompt and hands back to the player', async () => {
    const { hook, clearUnlock, onCancel } = setup({ item: { id: '1', plex: '1', labels: ['kidsfun'] } });
    await waitFor(() => expect(hook.result.current.promptOpen).toBe(true));
    act(() => hook.result.current.cancel());
    expect(clearUnlock).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(hook.result.current.blocked).toBe(true);
  });
});
