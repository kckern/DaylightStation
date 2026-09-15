import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const dispatchToTarget = vi.fn();
vi.mock('../controller/useSessionController.js', () => ({
  useSessionController: () => ({ portability: { snapshotForHandoff: () => ({ sessionId: 's1' }) } }),
}));
vi.mock('./useDispatch.js', () => ({ useDispatch: () => ({ dispatchToTarget }) }));
vi.mock('../logging/mediaLog.js', () => ({ default: new Proxy({}, { get: () => vi.fn() }) }));

import { useHandOff } from './useHandOff.js';

describe('useHandOff M0 destructive-transfer guard', () => {
  it('returns explicit unsupported failure and no dispatch ids for an unavailable Move', async () => {
    const { result } = renderHook(() => useHandOff());

    let outcome;
    await act(async () => { outcome = await result.current('livingroom-tv'); });

    expect(outcome).toEqual({ ok: false, error: 'move-unsupported' });
    expect(dispatchToTarget).not.toHaveBeenCalled();
  });

  it('keeps an explicitly non-destructive fork available', async () => {
    dispatchToTarget.mockResolvedValue(['dispatch-1']);
    const { result } = renderHook(() => useHandOff());

    let outcome;
    await act(async () => { outcome = await result.current('livingroom-tv', { mode: 'fork' }); });

    expect(dispatchToTarget).toHaveBeenCalledWith(expect.objectContaining({ mode: 'fork' }));
    expect(outcome).toEqual({ ok: true, dispatchIds: ['dispatch-1'] });
  });
});
