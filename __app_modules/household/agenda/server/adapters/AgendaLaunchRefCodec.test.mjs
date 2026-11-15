import {it,expect} from 'vitest';
import {AgendaLaunchRefCodec} from './AgendaLaunchRefCodec.mjs';
it('round trips a canonical bound tuple and rejects malformed handles',()=>{
 const codec=new AgendaLaunchRefCodec(); const tuple={householdId:'home',planId:'plan',itemUid:'item',revision:4,action:'open',targetDigest:'a'.repeat(64)};
 const ref=codec.encode(tuple); expect(ref).toMatch(/^agl_/); expect(codec.decode(ref)).toEqual(tuple);
 for (const bad of ['agl_','agl_@@@',ref+'=', 'other']) expect(()=>codec.decode(bad)).toThrow();
});
