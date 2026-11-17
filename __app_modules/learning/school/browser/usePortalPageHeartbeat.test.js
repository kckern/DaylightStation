import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { startPortalPageHeartbeat, usePortalPageHeartbeat } from './usePortalPageHeartbeat.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete window.fully; });
describe('Portal page evidence', () => {
  it('sends bounded metadata every five seconds even while hidden and never replays learning actions', async () => {
    vi.useFakeTimers();
    const fetch=vi.fn().mockResolvedValue({ok:true});
    const stop=startPortalPageHeartbeat({fetch, build:'candidate', activityId:'host-1', document:{visibilityState:'hidden'}});
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(Array(3).fill('http://127.0.0.1:8773/page/beat'));
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({protocol:1,build:'candidate',visible:false,activityId:'host-1',seq:3});
    expect(fetch.mock.calls[0][1].credentials).toBe('omit');
    stop(); await vi.advanceTimersByTimeAsync(10000); expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('keeps the page-host sequence across nested routes and stops outside Portal', async () => {
    vi.useFakeTimers(); const fetch=vi.fn().mockResolvedValue({ok:true});
    vi.stubGlobal('fetch',fetch); window.fully={};
    const { rerender,unmount }=renderHook(({path}) => usePortalPageHeartbeat(path),{initialProps:{path:'/screen/portal'}});
    await vi.advanceTimersByTimeAsync(0);
    rerender({path:'/screen/portal/reading'}); await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    const first=JSON.parse(fetch.mock.calls[0][1].body),second=JSON.parse(fetch.mock.calls[1][1].body);
    expect(second.activityId).toBe(first.activityId);expect(second.seq).toBe(2);
    rerender({path:'/home'});await vi.advanceTimersByTimeAsync(5000);expect(fetch).toHaveBeenCalledTimes(2);unmount();
  });
  it('bounds a hung request and retries evidence only', async () => {
    vi.useFakeTimers(); const fetch=vi.fn().mockImplementation(() => new Promise(() => {}));
    const stop=startPortalPageHeartbeat({fetch,build:'test',activityId:'host-2',document:{visibilityState:'visible'}});
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    stop(); expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });
});
