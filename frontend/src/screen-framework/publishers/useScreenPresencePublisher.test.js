import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../../services/WebSocketService.js', () => ({
  wsService: { send: vi.fn() },
}));
const { wsService } = await import('../../services/WebSocketService.js');
const { useScreenPresencePublisher } = await import('./useScreenPresencePublisher.js');

beforeEach(() => {
  vi.useFakeTimers();
  wsService.send.mockClear();
});

const lastMsg = () => wsService.send.mock.calls.at(-1)?.[0];

describe('useScreenPresencePublisher', () => {
  it('does nothing without a deviceId', () => {
    renderHook(({ active }) => useScreenPresencePublisher({ deviceId: null, active }), {
      initialProps: { active: true },
    });
    expect(wsService.send).not.toHaveBeenCalled();
  });

  it('emits active=true on mount-active and heartbeats every 5s while active', () => {
    renderHook(() => useScreenPresencePublisher({ deviceId: 'office-tv', active: true }));
    expect(wsService.send).toHaveBeenCalledTimes(1);
    expect(lastMsg()).toMatchObject({ type: 'screen.presence', deviceId: 'office-tv', active: true });
    vi.advanceTimersByTime(5000);
    expect(wsService.send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000);
    expect(wsService.send).toHaveBeenCalledTimes(3);
  });

  it('emits a single active=false on transition to inactive, then goes silent', () => {
    const { rerender } = renderHook(
      ({ active }) => useScreenPresencePublisher({ deviceId: 'office-tv', active }),
      { initialProps: { active: true } }
    );
    wsService.send.mockClear();
    rerender({ active: false });
    expect(wsService.send).toHaveBeenCalledTimes(1);
    expect(lastMsg()).toMatchObject({ active: false });
    vi.advanceTimersByTime(15000); // no heartbeat while inactive
    expect(wsService.send).toHaveBeenCalledTimes(1);
  });
});
