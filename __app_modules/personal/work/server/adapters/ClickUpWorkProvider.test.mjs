import {describe,it,expect} from 'vitest';
import {ClickUpWorkProvider} from './ClickUpWorkProvider.mjs';
import {resolveWorkPolicy} from './WorkConfig.mjs';
import {AS_OF,clickTask} from '../../../../../tests/_lib/work/observations.mjs';
const config={work:{enabled:true,providers:{delivery:{type:'clickup',accountId:'delivery',authScope:'household',operations:['read']}},domains:{software:{provider:'delivery',containerId:'sample-list',role:'projects',autoComplete:'never',assigneeIds:['123']}},users:{sample:{}}}};
const policy=username=>resolveWorkPolicy({configuration:config,username,timezone:'America/Los_Angeles'});
function setup(tasks){return new ClickUpWorkProvider({accountId:'delivery',resolvePolicy:policy,loadCurrent:async()=>({accountId:'delivery',observedAt:AS_OF,coverage:{complete:true,scope:{accountId:'delivery',containerIds:['sample-list'],assigneeIds:null},from:AS_OF-86400000,to:AS_OF,reason:null},tasks}),loadHistory:async()=>({})});}
describe('read-only scoped ClickUp work projection',()=>{
 it('keeps board status and typed hierarchy without activating an old in-progress item',async()=>{
  const r=await setup([clickTask()]).readSnapshot({username:'sample',asOf:AS_OF});expect(r.items[0].status).toEqual({native:'in progress',category:'in_progress'});expect(r.items[0].createdAt).toBe(Date.parse('2021-04-20T11:26:56.521Z'));expect(r.items[0].modifiedAt).toBeNull();expect(r.items[0].ancestorRefs.map(x=>[x.id,x.nativeKind])).toEqual([['sample-space','space'],['sample-folder','folder']]);expect(Object.hasOwn(r.items[0],'relevance')).toBe(false);
 });
 it('keeps paused native status and enforces per-domain assignee/container scope',async()=>{
  const tasks=[clickTask({id:'paused',status:{status:'on hold',type:'custom'}}),clickTask({id:'someone-else',assignees:[{id:'456'}]}),clickTask({id:'other-list',list:{id:'other-list',name:'Sample'}})];const r=await setup(tasks).readSnapshot({username:'sample',asOf:AS_OF});expect(r.items.map(x=>x.ref.id)).toEqual(['paused']);expect(r.items[0].status.category).toBe('paused');
 });
});
