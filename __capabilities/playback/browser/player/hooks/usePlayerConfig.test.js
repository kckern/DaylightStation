import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: request }));

let usePlayerConfig;
beforeEach(async () => {
  vi.resetModules();
  request.mockReset();
  ({ usePlayerConfig } = await import('./usePlayerConfig.js'));
});

describe('usePlayerConfig', () => {
  it('shares one pending read and the resolved config across player mounts', async () => {
    let finish;
    request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const first = renderHook(() => usePlayerConfig());
    const second = renderHook(() => usePlayerConfig());
    expect(request.mock.calls).toEqual([['api/v1/config/player']]);

    first.unmount();
    const config = { preempt_seconds: 42, displace_to_queue: true };
    await act(async () => { finish({ on_deck: config }); });
    expect(second.result.current.onDeck).toEqual(config);
    second.unmount();
    const later = renderHook(() => usePlayerConfig());
    expect(later.result.current.onDeck).toEqual(config);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reuses the default after a failed read for the rest of the page', async () => {
    let refuse;
    request.mockImplementation(() => new Promise((_, reject) => { refuse = reject; }));
    const { result, unmount } = renderHook(() => usePlayerConfig());
    expect(request.mock.calls).toEqual([['api/v1/config/player']]);
    await act(async () => { refuse(new Error('network')); });
    const defaults = { preempt_seconds: 15, displace_to_queue: false };
    expect(result.current.onDeck).toEqual(defaults);
    unmount();
    expect(renderHook(() => usePlayerConfig()).result.current.onDeck).toEqual(defaults);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
