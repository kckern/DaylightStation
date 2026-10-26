import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const trace=vi.hoisted(()=>({info:vi.fn(),sampled:vi.fn(),child:vi.fn()}));
vi.mock('@/lib/logging/Logger.js',()=>({default:()=>({...trace,child:trace.child.mockImplementation(()=>trace)})}));

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

it('attributes accepted and ineligible gamepad decisions to the session/window and samples spam',()=>{
 trace.info.mockClear();trace.sampled.mockClear();trace.child.mockClear();const onLock=vi.fn();
 const {result}=renderHook(()=>useBuzzers({teams:TEAMS,onLock,sessionId:'game:trace'}));
 act(()=>{result.current.arbiter.restore({slotToTeam:{'gamepad:1:Pad':'team_1','gamepad:2:Pad':'team_2'}});result.current.arm(['team_2'],{windowKey:'question:one'});});
 act(()=>gamepadPress('1:Pad'));act(()=>gamepadPress('2:Pad'));
 for(let n=0;n<50;n++)act(()=>gamepadPress('2:Pad'));
 expect(onLock).toHaveBeenCalledTimes(1);
 expect(trace.child).toHaveBeenCalledWith(expect.objectContaining({sessionId:'game:trace'}));
 expect(trace.info).toHaveBeenCalledWith('party-games.buzz.locked',expect.objectContaining({windowKey:'question:one',controllerId:'2:Pad',decision:'candidate'}));
 expect(trace.sampled).toHaveBeenCalledWith('party-games.buzz.decision',expect.objectContaining({reason:'ineligible',windowKey:'question:one'}),{maxPerMinute:10,aggregate:true});
 expect(JSON.stringify([...trace.info.mock.calls,...trace.sampled.mock.calls])).not.toMatch(/answer|token|qrPayload/);
});
