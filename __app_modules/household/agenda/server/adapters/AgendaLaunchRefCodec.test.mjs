import {it,expect} from 'vitest';
import {AgendaLaunchRefCodec} from './AgendaLaunchRefCodec.mjs';
it('round trips a canonical bound tuple and rejects malformed handles',()=>{
 const codec=new AgendaLaunchRefCodec(); const tuple={householdId:'home',planId:'plan',itemUid:'item',revision:4,action:'open',targetDigest:'a'.repeat(64)};
 const ref=codec.encode(tuple); expect(ref).toMatch(/^agl_/); expect(codec.decode(ref)).toEqual(tuple);
 for (const bad of ['agl_','agl_@@@',ref+'=', 'other']) expect(()=>codec.decode(bad)).toThrow();
});
it('bounds the largest valid tuple and rejects oversized or noncanonical provider handles',()=>{
 const codec=new AgendaLaunchRefCodec();const tuple={householdId:'h'.repeat(128),planId:'p'.repeat(128),itemUid:'i'.repeat(128),revision:Number.MAX_SAFE_INTEGER,action:'display',targetDigest:'a'.repeat(64)};
 const ref=codec.encode(tuple);expect(ref).toHaveLength(686);expect(codec.decode(ref)).toEqual(tuple);
 for(const bad of ['agl_'+ 'A'.repeat(2045),ref+'A'])expect(()=>codec.decode(bad)).toThrow(expect.objectContaining({code:'invalid_participant_launch_ref'}));
});
