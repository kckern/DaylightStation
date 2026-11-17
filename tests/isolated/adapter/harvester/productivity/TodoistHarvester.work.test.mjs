import {describe,it,expect} from 'vitest';
import {TodoistHarvester} from '#adapters/harvester/productivity/TodoistHarvester.mjs';
import {AS_OF,todoTask,stores,scope,quiet} from '../../../../_lib/work/observations.mjs';
function setup({http,previous}={}){const s=stores(previous);const requests=[];const client={get:async(url,options)=>{const u=new URL(url);for(const [k,v]of Object.entries(options?.params??{}))u.searchParams.set(k,String(v));requests.push(u);return {data:await http(u)};}};return {...s,requests,harvester:new TodoistHarvester({...s,httpClient:client,getUserAuth:()=>({api_key:'fixture-token'}),workScopeForUser:()=>scope(),clock:()=>AS_OF,logger:quiet})};}
const empty=url=>url.pathname.endsWith('/projects')?{results:[{id:'sample-project',name:'Sample project'}],next_cursor:null}:url.pathname.endsWith('/by_completion_date')?{items:[],next_cursor:null}:{results:[],next_cursor:null};
describe('complete Todoist observations',()=>{
 it('reads all open pages and retains source dates and recurrence without rounding ids',async()=>{
  const s=setup({http:async u=>u.pathname.endsWith('/tasks')?{results:u.searchParams.has('cursor')?[todoTask({id:'last-task'})]:Array.from({length:100},(_,i)=>todoTask({id:'task-'+i})),next_cursor:u.searchParams.has('cursor')?null:'page-2'}:empty(u)});
  const r=await s.harvester.harvest('sample');const value=s.current.get('sample:todoist');
  expect(value.tasks).toHaveLength(101);expect(value.tasks[0].createdAt).toBe(Date.parse('2021-04-20T11:26:56.521Z'));expect(value.observedAt).toBe(AS_OF);expect(value.tasks[0].modifiedAt).toBeNull();expect(value.tasks[0].due.is_recurring).toBe(true);expect(value.accountId).toBe('personal');expect(r.coverage.complete).toBe(true);
 });
 it('uses bounded completed-history cursor pages and preserves distinct recurring occurrences',async()=>{
  const done=(at)=>todoTask({id:'9007199254740993123',completed_at:at});
  const s=setup({http:async u=>u.pathname.endsWith('/by_completion_date')?{items:[done(u.searchParams.has('cursor')?'2026-11-17T16:00:00Z':'2026-11-17T15:00:00Z')],next_cursor:u.searchParams.has('cursor')?null:'next-done'}:empty(u)});
  const r=await s.harvester.harvest('sample',{daysBack:90});const events=s.history.get('sample:todoist')['2026-11-17'];
  expect(events).toHaveLength(2);expect(new Set(events.map(e=>e.occurrenceId)).size).toBe(2);expect(events.map(e=>e.id)).toEqual(['9007199254740993123','9007199254740993123']);
  const queries=s.requests.filter(u=>u.pathname.endsWith('/by_completion_date'));expect(queries.length).toBeGreaterThanOrEqual(2);expect(Date.parse(queries[0].searchParams.get('since'))).toBe(AS_OF-90*86400000);expect(Date.parse(queries.at(-1).searchParams.get('until'))).toBe(AS_OF);expect(s.requests.some(u=>u.pathname.endsWith('/tasks/completed'))).toBe(false);expect(r.coverage.complete).toBe(true);
 });
 it.each(['late_page','completion_history','container_history'])('keeps last complete snapshot and history on %s failure',async failure=>{
  const previous={lastUpdated:'2026-11-16 10:00:00',tasks:[{id:'previous'}],coverage:{complete:true}},s=setup({previous,http:async u=>{
   if(failure==='late_page'&&u.pathname.endsWith('/tasks')){if(u.searchParams.has('cursor'))throw Object.assign(new Error('rate limited'),{response:{status:429}});return {results:[todoTask()],next_cursor:'more'};}
   if(failure==='completion_history'&&u.pathname.endsWith('/by_completion_date')||failure==='container_history'&&u.pathname.endsWith('/projects'))throw Object.assign(new Error('unavailable'),{response:{status:500}});
   return empty(u);
  }});const r=await s.harvester.harvest('sample');expect(r.status).toBe('error');expect(r.coverage.complete).toBe(false);expect(s.current.get('sample:todoist')).toEqual(previous);expect(s.history.size).toBe(0);
 });
 it('does not invent an empty complete snapshot from malformed provider data',async()=>{const s=setup({previous:{tasks:[{id:'old'}]},http:async u=>u.pathname.endsWith('/tasks')?{}:empty(u)});const r=await s.harvester.harvest('sample');expect(r.coverage.complete).toBe(false);expect(s.current.get('sample:todoist').tasks[0].id).toBe('old');});
});
it('keeps a malformed timezone-less modification instant unknown',async()=>{
 const s=setup({http:async u=>u.pathname.endsWith('/tasks')?{results:[todoTask({updated_at:'2026-11-17T08:00:00'})],next_cursor:null}:empty(u)});
 await s.harvester.harvest('sample');expect(s.current.get('sample:todoist').tasks[0].modifiedAt).toBeNull();
});
