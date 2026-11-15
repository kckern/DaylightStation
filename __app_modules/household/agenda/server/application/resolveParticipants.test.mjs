import { it, expect } from 'vitest';
import { resolveParticipants } from './resolveParticipants.mjs';
const directory={resolve:async ({person})=>person.id==='visitor'?{person,display:{name:'Current',avatar:null},active:false}:null};
it('preserves snapshots and distinct anonymous identities, including archived guests',async()=>{
 const plan={plan_id:'week',household_id:'h',participants:[{id:'one',person:{kind:'guest',id:'visitor'},display:{name:'Old',avatar:null}},{id:'two',anonymous:true,display:{name:'Guest',avatar:null}},{id:'three',anonymous:true,display:{name:'Guest',avatar:null}}]};
 const result=await resolveParticipants({plan,directory});
 expect(result[0]).toMatchObject({runtimeId:'guest:visitor',person:{kind:'guest',id:'visitor'},display:{name:'Old',avatar:null}});
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
