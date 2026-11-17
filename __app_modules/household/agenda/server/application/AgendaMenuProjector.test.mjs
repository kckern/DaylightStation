import {it,expect} from 'vitest';
import {AgendaMenuProjector} from './AgendaMenuProjector.mjs';
import {ListMenuProjector} from '../../../../../__capabilities/content-catalog/server/list-menu-projector.mjs';
import {AgendaLaunchRefCodec} from '../adapters/AgendaLaunchRefCodec.mjs';

it('projects authored order and isolates typed launch references by plan', async () => {
  const plan = {household_id:'house',series_id:'series',plan_id:'p1',revision:1,week_of:'2026-11-09',title:'Week',list:{sections:[{items:[{uid:'a',title:'Game',open:{app:'game'}},{uid:'b',title:'Clip',play:{contentId:'files:clip'}},{uid:'hidden',title:'Hidden',active:false,play:{contentId:'files:x'}}]}]},activity_settings:{a:{action:'open',consumer:{id:'game',version:1}}}};
  const cachedTarget = {kind:'app',id:'same-global-content'};
  const beforeTarget = structuredClone(cachedTarget);
  const projector = new AgendaMenuProjector({listProjector:new ListMenuProjector(),codec:new AgendaLaunchRefCodec(),resolveTarget:async ()=>cachedTarget,registry:{resolve:({action})=>action==='open'?{id:'game',version:1}:null}});
  const first=await projector.project({plan,viewer:{},participantLaunchVersion:1});
  const second=await projector.project({plan:{...plan,plan_id:'p2'},viewer:{},participantLaunchVersion:1});
  expect(first.items.map(i=>i.metadata.uid)).toEqual(['a','b']);
  expect(first.items[0].participantLaunches.open.ref).not.toEqual(second.items[0].participantLaunches.open.ref);
  expect(first.items[1].participantLaunches).toBeUndefined();
  expect(cachedTarget).toEqual(beforeTarget);
  expect((await projector.project({plan,viewer:{},participantLaunchVersion:null})).items[0].disabled).toBe(true);
  expect((await projector.project({plan,viewer:{},preview:true,participantLaunchVersion:1})).items.every(i=>i.disabled)).toBe(true);
});

it('fails closed for unbound aware actions while leaving ordinary siblings executable and cache untouched', async () => {
 const cached = {uid:'same',title:'Media',play:{contentId:'files:42'},image:'/art.jpg'};
 const plan={household_id:'h',series_id:'s',plan_id:'p',revision:1,week_of:'2026-11-09',title:'Gather',list:{sections:[{items:[{uid:'aware',title:'Game',open:{app:'game'}},cached]}]},activity_settings:{}};
 const before=structuredClone(plan);
 const projector=new AgendaMenuProjector({listProjector:new ListMenuProjector(),codec:new AgendaLaunchRefCodec(),resolveTarget:async({item})=>({kind:'app',id:item.uid}),registry:{resolve:({target})=>target.id==='aware'?{id:'game',version:1}:null}});
 const menu=await projector.project({plan,viewer:{},participantLaunchVersion:1});
 expect(menu.items[0].disabled).toBe(true);
 expect(menu.items[0].actions.open).toBeUndefined();
 expect(menu.items[1].actions.play).toBeDefined();
 expect(menu.items[1].thumbnail).toBe('/art.jpg');
 expect(plan).toEqual(before);
 const preview=await projector.project({plan,viewer:{},preview:true,participantLaunchVersion:1});
 expect(preview.items.every(item=>!Object.values(item.actions||{}).some(Boolean))).toBe(true);
});

it('keeps ordinary list navigation and Android actions available in a current plan', async () => {
 const plan={household_id:'h',series_id:'s',plan_id:'p',revision:1,week_of:'2026-11-09',title:'Gather',list:{sections:[{items:[{uid:'nav',title:'Folder',list:{contentId:'files:folder'}},{uid:'android',title:'App',android:{package:'org.test',activity:'Main'}}]}]},activity_settings:{}};
 const projector=new AgendaMenuProjector({listProjector:new ListMenuProjector(),codec:new AgendaLaunchRefCodec(),resolveTarget:async()=>{throw Error('no target');},registry:{resolve:()=>null}});
 const result=await projector.project({plan,participantLaunchVersion:1});
 expect(result.items[0].actions.list).toBeDefined();
 expect(result.items[1].android.package).toBe('org.test');
});
