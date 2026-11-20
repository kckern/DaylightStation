import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveParamOptions } from '../../../../frontend/src/lib/appRegistry.js';
import { useAppParamOptions } from './useAppParamOptions.js';

vi.mock('../../../../frontend/src/lib/appRegistry.js', () => ({ resolveParamOptions: vi.fn() }));

describe('useAppParamOptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the newest selected app when an older options request resolves late', async () => {
    const first = Promise.withResolvers();
    const second = Promise.withResolvers();
    resolveParamOptions
      .mockImplementationOnce((_param, { signal }) => { first.signal = signal; return first.promise; })
      .mockImplementationOnce((_param, { signal }) => { second.signal = signal; return second.promise; });
    const { result } = renderHook(() => useAppParamOptions());
    let firstRequest;
    let secondRequest;

    act(() => { firstRequest = result.current.select({ appId: 'family-selector', param: { name: 'winner', options: 'household' } }); });
    act(() => { secondRequest = result.current.select({ appId: 'videocall', param: { name: 'device', options: 'one,two' } }); });
    expect(first.signal.aborted).toBe(true);

    await act(async () => {
      second.resolve([{ value: 'camera-2', label: 'Camera 2' }]);
      await secondRequest;
    });
    expect(result.current.resolution).toMatchObject({
      phase: 'ready', appId: 'videocall', options: [
        { value: 'random', label: 'Random' }, { value: 'camera-2', label: 'Camera 2' },
      ],
    });

    await act(async () => {
      first.resolve([{ value: 'alice', label: 'Alice' }]);
      await firstRequest;
    });
    expect(result.current.resolution.appId).toBe('videocall');
  });

  it('offers retry after a failed lookup and releases pending work when cleared', async () => {
    const pending = Promise.withResolvers();
    resolveParamOptions
      .mockRejectedValueOnce(new Error('Household lookup failed'))
      .mockResolvedValueOnce([{ value: 'alice', label: 'Alice' }])
      .mockImplementationOnce((_param, { signal }) => { pending.signal = signal; return pending.promise; });
    const { result } = renderHook(() => useAppParamOptions());

    await act(async () => {
      await result.current.select({ appId: 'family-selector', param: { name: 'winner', options: 'household' } });
    });
    expect(result.current.resolution).toMatchObject({ phase: 'error', error: 'Household lookup failed' });
    await act(async () => { await result.current.retry(); });
    expect(result.current.resolution).toMatchObject({
      phase: 'ready', options: [{ value: 'random', label: 'Random' }, { value: 'alice', label: 'Alice' }],
    });
    expect(resolveParamOptions).toHaveBeenCalledTimes(2);

    let pendingRequest;
    act(() => { pendingRequest = result.current.select({ appId: 'family-selector', param: { name: 'winner', options: 'household' } }); });
    act(() => { result.current.clear(); });
    expect(pending.signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve([{ value: 'stale', label: 'Stale' }]);
      await pendingRequest;
    });
    expect(result.current.resolution).toBeNull();
  });
});
