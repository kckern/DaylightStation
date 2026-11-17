import { describe, it, expect, vi } from 'vitest';
import { dispatchParticipantAction } from './dispatchParticipantAction.js';

describe('participant action dispatch', () => {
  const ref = {schema:'participant-launch-ref/v1',provider:'agenda',ref:'opaque'};
  it.each(['open','play','queue','display'])('intercepts only the exact %s action', action => {
    const ordinary = vi.fn(), present = vi.fn();
    dispatchParticipantAction({selection:{[action]:{}, participantLaunches:{[action]:ref}}, action, onOrdinaryAction:ordinary, onPresentation:present});
    expect(present).toHaveBeenCalledWith({ref,action});
    expect(ordinary).not.toHaveBeenCalled();
  });
  it('preserves ordinary sibling behavior and fails closed on malformed refs', () => {
    const ordinary = vi.fn(), present = vi.fn();
    const selection = {open:{},play:{},participantLaunches:{open:{schema:'bad'}}};
    dispatchParticipantAction({selection,action:'play',onOrdinaryAction:ordinary,onPresentation:present});
    dispatchParticipantAction({selection,action:'open',onOrdinaryAction:ordinary,onPresentation:present});
    expect(ordinary).toHaveBeenCalledTimes(1);
    expect(present).not.toHaveBeenCalled();
  });
});
it('fails closed when the reference map itself is malformed',()=>{
 const ordinary=vi.fn();
 dispatchParticipantAction({selection:{open:{app:'fake'},participantLaunches:'invalid'},action:'open',onOrdinaryAction:ordinary});
 expect(ordinary).not.toHaveBeenCalled();
});
it('dispatches an actual Agenda reference containing full-length owned identifiers',async()=>{
 const {AgendaLaunchRefCodec}=await import('../../../../__app_modules/household/agenda/server/adapters/AgendaLaunchRefCodec.mjs');
 const codec=new AgendaLaunchRefCodec();const encoded=codec.encode({householdId:'h'.repeat(128),planId:'p'.repeat(128),itemUid:'i'.repeat(128),revision:Number.MAX_SAFE_INTEGER,action:'open',targetDigest:'a'.repeat(64)});
 expect(encoded.length).toBeGreaterThan(256);expect(codec.decode(encoded).action).toBe('open');
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:encoded};const present=vi.fn();
 dispatchParticipantAction({selection:{open:{app:'game'},participantLaunches:{open:ref}},action:'open',onPresentation:present});
 expect(present).toHaveBeenCalledWith({ref,action:'open'});
});
it('logs a safe validation code when a malformed or oversized reference fails closed',async()=>{
 const {getLogger}=await import('../../lib/logging/Logger.js');const warn=vi.spyOn(getLogger(),'warn');
 const present=vi.fn(),ordinary=vi.fn();
 for(const ref of ['x'.repeat(2049),' secret ']) dispatchParticipantAction({selection:{open:{app:'game'},participantLaunches:{open:{schema:'participant-launch-ref/v1',provider:'agenda',ref}}},action:'open',onPresentation:present,onOrdinaryAction:ordinary});
 expect(present).not.toHaveBeenCalled();expect(ordinary).not.toHaveBeenCalled();expect(warn).toHaveBeenCalledTimes(2);expect(warn).toHaveBeenCalledWith('participant-launch.invalid-reference',{code:'invalid_participant_launch',action:'open'});expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret|xxx/);warn.mockRestore();
});
