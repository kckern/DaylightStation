import { vi } from 'vitest';
import { snapshot as initial, AS_OF, TZ, evidence, proposal } from '../../domain/knowledge/fixtures.testHelpers.mjs';
export { AS_OF, TZ, evidence, proposal };
export function memoryStore(over = {}) {
 const users = new Map(), applied = new Set();
 const state = username => {if(!users.has(username))users.set(username,initial({}, {state:{processedProposalIds:[],pendingReviews:[],cursor:{since:AS_OF-86400000,seen:[]}},...structuredClone(over)}));return users.get(username);};
 const store={inMutation:false,users,
  read:vi.fn(async({username})=>structuredClone(state(username))),
  recover:vi.fn(async()=>{}),
  commit:vi.fn(async({username,expectedRevision,runId,batch})=>{
   const current=state(username);if(applied.has(username+':'+runId))return {revision:current.revision,applied:false};
   if(current.revision!==expectedRevision)throw Object.assign(Error('stale'),{code:'STALE_KNOWLEDGE_REVISION'});
   store.inMutation=true;
   for(const object of batch.upserts??[])current.objects[object.id]=structuredClone(object);
   current.state={...current.state,...structuredClone(batch.statePatch??{})};
   if(batch.statePatch?.asks)current.asks=structuredClone(batch.statePatch.asks);
   if(batch.statePatch?.quiz)current.quiz=structuredClone(batch.statePatch.quiz);
   current.health.lastSweepAt=current.state.lastSweepAt??current.health.lastSweepAt;
   current.revision++;applied.add(username+':'+runId);store.inMutation=false;
   return {revision:current.revision,applied:true};
  }),
 };
 return store;
}
export function evidenceSource(rows=[evidence()]) {
 return {rows,
  readUserMessages:vi.fn(async({after,through})=>{
   const seen=new Set(after.seen??[]),messages=rows.filter(m=>m.at>=after.since&&m.at<=through&&!seen.has(m.sourceId));
   return {messages,cursor:{since:after.since,seen:[...seen,...messages.map(m=>m.sourceId)]}};
  }),
  readByRefs:vi.fn(async({refs})=>rows.filter(m=>refs.includes(m.ref))),
 };
}
export function fakeClock(start=AS_OF) {
 let time=start;const jobs=[];
 return {now:()=>time,set:value=>{time=value;},jobs,
  scheduler:{after:(delay,work)=>{const job={at:time+delay,work,cancelled:false};jobs.push(job);return()=>{job.cancelled=true;};}},
  advance:async delta=>{const end=time+delta;for(;;){const next=jobs.filter(j=>!j.cancelled&&j.at<=end).sort((a,b)=>a.at-b.at)[0];if(!next)break;next.cancelled=true;time=next.at;await next.work();}time=end;},
 };
}
export const nextId=()=>{let i=0;return()=>`run-${++i}`;};
