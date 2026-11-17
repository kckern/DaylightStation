import {describe,it,expect} from 'vitest';
import {ClickUpHarvester} from '#adapters/harvester/productivity/ClickUpHarvester.mjs';
import {AS_OF,clickTask,stores,scope,quiet} from '../../../../_lib/work/observations.mjs';
function setup(http,previous){const s=stores();if(previous)s.current.set('sample:clickup',structuredClone(previous));const requests=[];return {...s,requests,harvester:new ClickUpHarvester({...s,httpClient:{get:async(url,options)=>{const u=new URL(url);for(const[k,v]of Object.entries(options?.params??{}))u.searchParams.set(k,String(v));requests.push(u);return {data:u.pathname==='/api/v2/list/sample-list'?{id:'sample-list',name:'Sample list',space:{id:'sample-space',name:'Sample space'},folder:{id:'sample-folder',name:'Sample'},statuses:[{status:'review',type:'custom'},{status:'accepted',type:'closed'}]}:await http(u)};}},getUserAuth:()=>({api_key:'fixture-key',workspace_id:'sample-team'}),adapterConfig:{statuses:['in progress'],done_statuses:['done']},workScopeForUser:()=>scope('delivery',['sample-list']),clock:()=>AS_OF,logger:quiet})};}
const spaces={spaces:[{id:'sample-space',name:'Sample space'}]};
const isDone=u=>u.searchParams.get('statuses[0]')==='done';
describe('complete ClickUp observations',()=>{
 it('does not stop at the old eleventh-page ceiling and keeps typed hierarchy ids/source dates',async()=>{
  const s=setup(async u=>u.pathname.endsWith('/space')?spaces:isDone(u)?{tasks:[],last_page:true}:{tasks:[clickTask({id:'task-'+u.searchParams.get('page')})],last_page:Number(u.searchParams.get('page'))===11});
  const r=await s.harvester.harvest('sample');const saved=s.current.get('sample:clickup');expect(saved.tasks).toHaveLength(12);expect(saved.tasks[0]).toMatchObject({id:'task-0',date_created:String(Date.parse('2021-04-20T11:26:56.521Z')),createdAt:Date.parse('2021-04-20T11:26:56.521Z'),modifiedAt:null,containerId:'sample-list',containerType:'list'});expect(saved.tasks[0].ancestorRefs.map(x=>[x.id,x.nativeKind])).toEqual([['sample-space','space'],['sample-folder','folder']]);expect(r.coverage.complete).toBe(true);expect(saved.observedAt).toBe(AS_OF);
 });
 it('marks estimated completion time explicitly and preserves actual completion separately',async()=>{
  const s=setup(async u=>u.pathname.endsWith('/space')?spaces:{tasks:isDone(u)?[clickTask({id:'actual',date_done:String(AS_OF-3600000)}),clickTask({id:'estimated',date_updated:String(AS_OF-7200000)})]:[],last_page:true});
  await s.harvester.harvest('sample');const events=s.history.get('sample:clickup')['2026-11-17'];expect(events.find(e=>e.id==='actual').occurredAtEstimated).toBe(false);expect(events.find(e=>e.id==='estimated').occurredAtEstimated).toBe(true);
 });
 it.each(['late_page','completed','limit'])('preserves complete current data on %s acquisition failure',async failure=>{
  const old={tasks:[{id:'old'}]},s=setup(async u=>{
   if(u.pathname.endsWith('/space'))return spaces;
   if(isDone(u)){if(failure==='completed')throw new Error('denied');return {tasks:[],last_page:true};}
   if(failure==='late_page'&&u.searchParams.get('page')==='1')throw Object.assign(new Error('limited'),{response:{status:429}});
   return {tasks:[clickTask()],last_page:failure==='completed'};
  },old);const r=await s.harvester.harvest('sample');expect(r.status).toBe('error');expect(r.coverage.complete).toBe(false);expect(s.current.get('sample:clickup')).toEqual(old);expect(s.history.size).toBe(0);expect(s.requests.length).toBeLessThanOrEqual(102);
 });
});

it('retains metadata for a configured empty list without inventing task activity',async()=>{const s=setup(async u=>u.pathname.endsWith('/space')?spaces:{tasks:[],last_page:true});await s.harvester.harvest('sample');expect(s.current.get('sample:clickup').containers).toContainEqual(expect.objectContaining({id:'sample-list',nativeKind:'list',statuses:[{status:'review',type:'custom'},{status:'accepted',type:'closed'}]}));});
