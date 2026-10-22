import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: () => {} }));
import { useBuzzers } from './useBuzzers.js';

const TEAMS = [{ id: 'team_1', slot: 'slot_1' }, { id: 'team_2', slot: 'slot_2' }];
const gamepadPress = (controllerId, phase = 'press') => window.dispatchEvent(new CustomEvent('gaming:interaction', {
  detail: { source: 'gamepad', phase, controller_id: controllerId, action: 'button.a' },
}));

describe('useBuzzers gamepad slots', () => {
  it('binds a gamepad to the binding team, then that gamepad buzzes the team in', () => {
    const onLock = vi.fn();
    const { result } = renderHook(() => useBuzzers({ teams: TEAMS, onLock }));
    act(() => result.current.startBind('team_2'));
    act(() => gamepadPress('3:Pad'));
    expect(result.current.bindingTeamId).toBe(null);
    expect(result.current.arbiter.bindings()['gamepad:3:Pad']).toBe('team_2');
    act(() => result.current.arm(['team_1', 'team_2']));
    act(() => gamepadPress('3:Pad'));
    expect(onLock).toHaveBeenCalledWith('team_2');
  });

  it('ignores releases and unbound controllers', () => {
    const onLock = vi.fn();
    const { result } = renderHook(() => useBuzzers({ teams: TEAMS, onLock }));
    act(() => result.current.arm(['team_1', 'team_2']));
    act(() => gamepadPress('9:Stray'));
    act(() => gamepadPress('9:Stray', 'release'));
    expect(onLock).not.toHaveBeenCalled();
  });
});
