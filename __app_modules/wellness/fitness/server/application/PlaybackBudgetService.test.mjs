import { describe, it, expect } from 'vitest';
import { PlaybackBudgetService } from './PlaybackBudgetService.mjs';
const configuration={governance:{superusers:['parent'],playback_budgets:[{id:'unattended',match:'governed',when:'unattended',limit_minutes:15}]},governedLabels:['Movement']};
function harness() {
 const records=new Map(); let time=Date.UTC(2026,9,18,12); let fail=false;
 const store={load:async key=>structuredClone(records.get(JSON.stringify(key))??null),save:async ({value,...key})=>{if(fail)throw Error('write failed');records.set(JSON.stringify(key),structuredClone(value));}};
 const service=new PlaybackBudgetService({store,policyConfig:()=>configuration,contentCatalog:{getItem:async id=>({metadata:{labels:id==='video'?['Movement']:['Other']}})},clock:{now:()=>time},calendar:now=>({localDate:new Date(now).toISOString().slice(0,10),nextResetAt:Date.parse(new Date(now).toISOString().slice(0,10)+'T00:00:00Z')+86400000}),deviceDirectory:()=>({'test-tv':{fleet:true}}),logger:{info(){},warn(){}}});
 const req={householdId:'test',deviceId:'test-tv',streamId:'browser',participantIds:['child'],contentId:'video'};
 return {service,records,req,advance:ms=>{time+=ms;},fail:()=>{fail=true;}};
}
describe('durable playback budget service',()=>{
 it('issues a valid durable reservation and returns the same grant on duplicate requests',async()=>{
  const h=harness(); const first=await h.service.observe({...h.req,sequence:1});
  expect(first.policies[0]).toMatchObject({remainingMs:895000,grant:{ms:5000}});
  expect(await h.service.observe({...h.req,sequence:1})).toEqual(first);
  expect((await h.service.status(h.req)).policies[0].spentMs).toBe(5000);
 });
 it('keeps a spent balance across new sessions and never issues an extra grant',async()=>{
  const h=harness(); let previous=null;
  for(let i=1;i<=181;i++){
   const view=await h.service.observe({...h.req,sequence:i,previousGrantId:previous?.id,previousGrantDate:previous?.localDate,playedMs:previous?.ms??0});
   previous=view.policies[0].grant;
  }
  expect(previous).toBeNull();
  expect((await h.service.observe({...h.req,streamId:'reloaded',sequence:1})).policies[0]).toMatchObject({expired:true,remainingMs:0,grant:null});
 });
 it('resets on supervisor join without a Player and does not repeatedly reset on heartbeats',async()=>{
  const h=harness(); await h.service.observe({...h.req,sequence:1});
  const joined=await h.service.observe({...h.req,sequence:2,contentId:null,participantIds:['child','parent']});
  expect(joined.supervised).toBe(true);expect(joined.policies[0].spentMs).toBe(0);
  const next=await h.service.observe({...h.req,sequence:3,contentId:null,participantIds:['parent']});
  expect(next.generation).toBe(joined.generation);
  expect((await h.service.observe({...h.req,sequence:4})).policies[0].grant.ms).toBe(5000);
 });
 it('does not spend unmatched content and resets at the next local day',async()=>{
  const h=harness(); expect((await h.service.observe({...h.req,sequence:1,contentId:'other'})).policies[0].grant).toBeNull();
  await h.service.observe({...h.req,sequence:2});h.advance(86400000);
  expect((await h.service.status(h.req)).policies[0].spentMs).toBe(0);
 });
 it('refuses unknown devices, cross-stream settlements, and invalid sequence numbers',async()=>{
  const h=harness();await expect(h.service.observe({...h.req,deviceId:'unknown',sequence:1})).rejects.toThrow();
  await expect(h.service.observe({...h.req,sequence:0})).rejects.toThrow();
  const first=await h.service.observe({...h.req,sequence:1});
  await expect(h.service.observe({...h.req,streamId:'intruder',sequence:1,previousGrantId:first.policies[0].grant.id,playedMs:0})).rejects.toThrow();
 });
 it('cannot grant time when the durable write fails',async()=>{
  const h=harness();h.fail();await expect(h.service.observe({...h.req,sequence:1})).rejects.toThrow('write failed');
 });
 it('serializes concurrent reservations at the end of the allowance',async()=>{
  const h=harness();await h.service.observe({...h.req,sequence:1});
  const [key,value]=[...h.records.entries()][0];value.policies.unattended.spentMs=899000;h.records.set(key,value);
  const results=await Promise.all(['a','b'].map(streamId=>h.service.observe({...h.req,streamId,sequence:1})));
  expect(results.reduce((sum,r)=>sum+(r.policies[0].grant?.ms??0),0)).toBe(1000);
 });
});

it('obsolete browser streams cannot remove supervision and trigger a second join reset', async () => {
 const h=harness();await h.service.observe({...h.req,sequence:1});
 const adult={...h.req,streamId:'reloaded',participantIds:['parent'],requestGrant:false};
 const joined=await h.service.observe({...adult,sequence:1});
 const old=await h.service.observe({...h.req,sequence:2});
 expect(old.policies[0].grant).toBeNull();expect(old.supervised).toBe(true);
 const next=await h.service.observe({...adult,sequence:2});
 expect(next.generation).toBe(joined.generation);expect(next.policies[0].spentMs).toBe(0);
});

it('rejects incomplete exhausted buckets instead of treating them as a new day', async () => {
 const h=harness();await h.service.observe({...h.req,sequence:1});
 const [key,value]=[...h.records.entries()][0];delete value.policies.unattended.localDate;value.policies.unattended.spentMs=900000;h.records.set(key,value);
 await expect(h.service.observe({...h.req,sequence:2})).rejects.toThrow('Corrupt');
});
