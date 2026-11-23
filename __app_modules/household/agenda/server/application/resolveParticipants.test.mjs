import { it, expect } from 'vitest';
import { resolveParticipants } from './resolveParticipants.mjs';
const directory={resolve:async ({person})=>person.id==='visitor'?{person,display:{name:'Current',avatar:null},active:false}:null};
it('takes named people from the directory and keeps distinct anonymous identities, including archived guests',async()=>{
 const plan={plan_id:'week',household_id:'h',participants:[{id:'one',person:{kind:'guest',id:'visitor'},display:{name:'Old',avatar:null}},{id:'two',anonymous:true,display:{name:'Guest',avatar:null}},{id:'three',anonymous:true,display:{name:'Guest',avatar:null}}]};
 const result=await resolveParticipants({plan,directory});
 expect(result[0]).toMatchObject({runtimeId:'guest:visitor',person:{kind:'guest',id:'visitor'},display:{name:'Current',avatar:null}});
 expect(result.slice(1).map(x=>x.display.name)).toEqual(['Guest','Guest']);
 expect(result.slice(1).map(x=>x.runtimeId)).toEqual(['anon:week:two','anon:week:three']);
});
it('rejects unknown identities, namespace collisions, and invalid runtime IDs',async()=>{
 const entry=(id,person)=>({id,person,display:{name:'x',avatar:null}});
 const plan={plan_id:'week',household_id:'h',participants:[entry('a',{kind:'guest',id:'unknown'})]};
 await expect(resolveParticipants({plan,directory})).rejects.toThrow(/unknown/i);
 const all={resolve:async ({person})=>({person,display:{name:'x',avatar:null}})};
 plan.participants=[entry('a',{kind:'user',id:'guest:visitor'}),entry('b',{kind:'guest',id:'visitor'})];
 await expect(resolveParticipants({plan,directory:all})).rejects.toThrow(/collision/i);
 plan.participants=[entry('a',{kind:'user',id:'x'.repeat(129)})];
 await expect(resolveParticipants({plan,directory:all})).rejects.toThrow(/invalid/i);
});
it('rejects ambiguous anonymous ID boundaries without changing stored IDs', async () => {
 const resolve = (planId, entryId) => resolveParticipants({plan:{plan_id:planId,household_id:'h',participants:[{id:entryId,anonymous:true,display:{name:'Guest',avatar:null}}]},directory});
 await expect(resolve('week:one','seat')).rejects.toThrow(/ambiguous/i);
 await expect(resolve('week','one:seat')).rejects.toThrow(/ambiguous/i);
});
it('matches Gaming command actor ID boundaries', async () => {
 const { validateCommandEnvelope } = await import('../../../../../__capabilities/gaming/portable/kernel/index.mjs');
 const envelope = actor_id => ({command_id:'command',actor_id,expected_revision:0,logical_time:0,command:{type:'play'}});
 const all={resolve:async ({person})=>({person,display:{name:'x',avatar:null}})};
 for (const id of ['x'.repeat(128), 'x'.repeat(129), 'x/y']) {
  const plan={plan_id:'week',household_id:'h',participants:[{id:'entry',person:{kind:'user',id},display:{name:'x',avatar:null}}]};
  const accepted=await resolveParticipants({plan,directory:all}).then(()=>true,()=>false);
  expect(accepted).toBe(validateCommandEnvelope(envelope(id)).valid);
 }
});
