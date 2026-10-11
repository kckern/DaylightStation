import { describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRecapUnlock } from './useRecapUnlock.js';

const RULES = { lock: 'kids_playback', labels: ['KidsFun'], libraries: ['TV Shows'], session_recaps: true };
const KIDS = [{ contentId: 'plex:673797', labels: ['kidsfun'] }];
const ADULT = [{ contentId: 'plex:696316', labels: [] }];

function setup(overrides = {}) {
  let resolveScan;
  const registerUnlock = vi.fn(() => new Promise((r) => { resolveScan = r; }));
  const clearUnlock = vi.fn();
  const props = {
    sessionId: 's1', media: KIDS, rules: RULES, active: true, registerUnlock, clearUnlock,
    fetchInfo: vi.fn(async () => ({ librarySectionTitle: 'Fitness' })), ...overrides,
  };
  const hook = renderHook((p) => useRecapUnlock(p), { initialProps: props });
  return { hook, props, registerUnlock, clearUnlock, scan: (r) => resolveScan(r) };
}

describe('useRecapUnlock', () => {
  it('locks the recap of a session that played KidsFun content', async () => {
    const { hook } = setup();
    expect(hook.result.current.locked).toBe(true);
    await waitFor(() => expect(hook.result.current.locked).toBe(true));
  });

  it('is locked while classifying, then opens for an adult workout', async () => {
    const { hook } = setup({ media: ADULT });
    expect(hook.result.current.locked).toBe(true);
    await waitFor(() => expect(hook.result.current.locked).toBe(false));
  });

  it('unlocks on a matching scan, for that session only', async () => {
    const { hook, props, registerUnlock, scan } = setup();
    await waitFor(() => expect(hook.result.current.locked).toBe(true));
    await act(async () => { hook.result.current.request(); });
    expect(registerUnlock).toHaveBeenCalledWith('kids_playback');
    expect(hook.result.current.promptOpen).toBe(true);
    await act(async () => { scan({ matched: true, userId: 'parent' }); });
    expect(hook.result.current.locked).toBe(false);

    hook.rerender({ ...props, sessionId: 's2' });
    expect(hook.result.current.locked).toBe(true);
  });

  it('stays locked after a wrong finger', async () => {
    const { hook, scan } = setup();
    await waitFor(() => expect(hook.result.current.locked).toBe(true));
    await act(async () => { hook.result.current.request(); });
    await act(async () => { scan({ matched: false }); });
    expect(hook.result.current.locked).toBe(true);
  });

  it('is off unless the yml turns on session_recaps', () => {
    const { hook } = setup({ rules: { ...RULES, session_recaps: false } });
    expect(hook.result.current.locked).toBe(false);
  });

  it('is off when the lock is inactive (off the kiosk)', () => {
    const { hook } = setup({ active: false });
    expect(hook.result.current.locked).toBe(false);
  });
});
