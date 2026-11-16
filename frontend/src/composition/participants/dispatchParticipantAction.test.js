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
