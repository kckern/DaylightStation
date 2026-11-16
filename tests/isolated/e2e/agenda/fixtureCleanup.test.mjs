import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ListManagementService} from '../../../../__capabilities/content-catalog/server/application/services/ListManagementService.mjs';
import {normalizeListConfig,serializeListConfig} from '../../../../__capabilities/content-catalog/server/domain/utils/listConfigCodec.mjs';
import {createAgendaFixture} from '../../../live/flow/agenda/fixture.mjs';
const response=(url,body,status=200)=>({ok:()=>status<400,url:()=>url,status:()=>status,text:async()=>JSON.stringify(body),json:async()=>body,headers:()=>({etag:'"one"'})});
it('cleans other owned records when initialization and an individual plan cleanup fail',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-fixture-'));vi.stubEnv('BASE_URL','http://managed');vi.stubEnv('AGENDA_TEST_TOKEN','fixture-token');vi.stubEnv('AGENDA_TEST_HOUSEHOLD','home');
 let guestName;const actions=[];const error=Error('initialization failed');
 const request={post:async(url,{data})=>{actions.push(['post',url]);if(url==='/api/v1/admin/content/agendas') {guestName=data.series.title.replace('Agenda ','');return response(url,{},201);}if(url.endsWith('/plans/p1/archive'))return response(url,{},500);return response(url,{});},get:async url=>{actions.push(['get',url]);if(url.endsWith('/plans')) return response(url,{plans:[{document:{plan_id:'p1'}},{document:{plan_id:'p2'}}]});if(url.endsWith('/plans/p1') || url.endsWith('/plans/p2')) return response(url,{state:'draft'});if(url.includes('/people?')){const manifest=JSON.parse(readFileSync(path.join(dir,'agenda-fixture-private.json')));return response(url,{people:[{person:{kind:'guest',id:'own-guest'},display:{name:manifest.guestName},active:true},{person:{kind:'guest',id:'unrelated'},display:{name:'Other'},active:true}]});}return response(url,{status:'active'});}};
 try {
  let caught;try {await createAgendaFixture({page:{addInitScript:async()=>{throw error;}},request,createCleanupContext:async()=>({...request,dispose:async()=>{}})},{outputPath:name=>path.join(dir,name)});} catch(e){caught=e;}
  expect(caught).toBe(error);expect(caught.cleanupError).toBeInstanceOf(Error);expect(actions.some(([method,url])=>method==='post' && url.endsWith('/plans/p2/archive'))).toBe(true);expect(actions.some(([method,url])=>method==='post' && url.endsWith('/people/guests/own-guest/archive'))).toBe(true);expect(actions.some(([,url])=>url.includes('unrelated'))).toBe(false);expect(actions.some(([method,url])=>method==='post' && url.endsWith('/archive') && !url.includes('/plans/') && !url.includes('/people/'))).toBe(true);
  const manifest=JSON.parse(readFileSync(path.join(dir,'agenda-fixture-private.json')));expect(manifest.seriesCreated).toBe(true);expect(manifest.planIds).toEqual(['p1','p2']);expect(manifest.cleanupFailures.some(f=>f.operation==='plan:p1')).toBe(true);expect(guestName).toBe(manifest.seriesId);
 } finally {vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});}
});

it('does not clean a successfully initialized fixture before the journey runs',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-fixture-'));vi.stubEnv('BASE_URL','http://managed');vi.stubEnv('AGENDA_TEST_TOKEN','fixture-token');vi.stubEnv('AGENDA_TEST_HOUSEHOLD','home');
 const post=vi.fn(async url=>response(url,{},201));const get=vi.fn();
 try {const fixture=await createAgendaFixture({page:{addInitScript:async()=>{}},request:{post,get}},{outputPath:name=>path.join(dir,name)});expect(fixture.manifest.seriesCreated).toBe(true);expect(post).toHaveBeenCalledOnce();expect(get).not.toHaveBeenCalled();} finally {vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});}
});
it('continues archiving discovered plans when their manifest update fails',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-fixture-'));vi.stubEnv('BASE_URL','http://managed');vi.stubEnv('AGENDA_TEST_TOKEN','fixture-token');vi.stubEnv('AGENDA_TEST_HOUSEHOLD','home');
 const actions=[];let writes=0;const original=Error('initialization failed');
 const request={post:async url=>{actions.push(url);return response(url,{},url==='/api/v1/admin/content/agendas'?201:200);},get:async url=>{if(url.endsWith('/plans'))return response(url,{plans:[{document:{plan_id:'p1'}}]});if(url.endsWith('/plans/p1'))return response(url,{state:'draft'});if(url.includes('/people?'))return response(url,{people:[]});return response(url,{status:'active'});}};
 try {let caught;try {await createAgendaFixture({page:{addInitScript:async()=>{throw original;}},request,createCleanupContext:async()=>({...request,dispose:async()=>{}})},{outputPath:name=>++writes===4?path.join(dir,'missing',name):path.join(dir,name)});}catch(error){caught=error;}
  expect(caught).toBe(original);expect(actions.some(url=>url.endsWith('/plans/p1/archive'))).toBe(true);
 } finally {vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});}
});
it('continues archiving a discovered guest when its manifest update fails',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-fixture-'));vi.stubEnv('BASE_URL','http://managed');vi.stubEnv('AGENDA_TEST_TOKEN','fixture-token');vi.stubEnv('AGENDA_TEST_HOUSEHOLD','home');
 const actions=[];let writes=0;const original=Error('initialization failed');
 const request={post:async url=>{actions.push(url);return response(url,{},url==='/api/v1/admin/content/agendas'?201:200);},get:async url=>{if(url.endsWith('/plans'))return response(url,{plans:[]});if(url.includes('/people?')){const manifest=JSON.parse(readFileSync(path.join(dir,'agenda-fixture-private.json')));return response(url,{people:[{person:{kind:'guest',id:'own'},display:{name:manifest.guestName},active:true}]});}return response(url,{status:'active'});}};
 try {let caught;try {await createAgendaFixture({page:{addInitScript:async()=>{throw original;}},request,createCleanupContext:async()=>({...request,dispose:async()=>{}})},{outputPath:name=>++writes===5?path.join(dir,'missing',name):path.join(dir,name)});}catch(error){caught=error;}
  expect(caught).toBe(original);expect(actions.some(url=>url.endsWith('/people/guests/own/archive'))).toBe(true);
 } finally {vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});}
});
// Keep the real API normalization/serialization path; only HTTP and persistence
// are in memory, so cleanup must compare the same complete documents as live GET.
async function callerFixture(run,{update='success',readback='success',collision=false}={}) {
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-caller-'));
 vi.stubEnv('BASE_URL','http://managed');vi.stubEnv('AGENDA_TEST_TOKEN','fixture-token');vi.stubEnv('AGENDA_TEST_HOUSEHOLD','home');
 const records=new Map(),actions=[];let menuName,updated=false,manifestAtPut;
 const service=new ListManagementService({logger:{},listStore:{
  createList:(_type,name)=>{records.set(name,{items:[]});return true;},
  getList:(_type,name)=>records.has(name)?normalizeListConfig(records.get(name),name):null,
  saveList:(_type,name,_household,document)=>records.set(name,JSON.parse(JSON.stringify(serializeListConfig(document)))),
  deleteList:(_type,name)=>records.delete(name)
 }});
 const manifest=()=>JSON.parse(readFileSync(path.join(dir,'agenda-fixture-private.json')));
 const request={
  post:async(url,{data})=>{
   actions.push(['post',url]);
   if(url==='/api/v1/admin/content/lists/menus') {
    menuName=data.name;return response(url,service.createList('menus',menuName,'home'),201);
   }
   return response(url,{},url==='/api/v1/admin/content/agendas'?201:200);
  },
  get:async url=>{
   actions.push(['get',url]);
   if(url.includes('/lists/menus/')) {
    if(collision && !menuName)return response(url,{});
    if(!records.has(menuName))return response(url,{},404);
    if(updated && readback==='failure')throw Error('readback unavailable');
    return response(url,JSON.parse(JSON.stringify(service.getList('menus',menuName,'home'))));
   }
   if(url.endsWith('/plans'))return response(url,{plans:[]});
   if(url.includes('/people?'))return response(url,{people:[]});
   return response(url,{status:'archived'});
  },
  put:async(url,{data})=>{
   const saved=manifest();manifestAtPut=saved;expect(saved.callerMenu.created).toBe(true);expect(saved.callerMenu.name).toBe(menuName);
   actions.push(['put',url]);
   if(update==='rejected')return response(url,{},500);
   const result=service.replaceContents('menus',menuName,'home',data.items);updated=true;
   if(update==='ambiguous')throw Error('response lost');
   if(update==='malformed')return response(url,{});
   return response(url,result);
  },
  delete:async url=>{actions.push(['delete',url]);return response(url,service.deleteList('menus',menuName,'home'));}
 };
 try {
  const fixture=await createAgendaFixture({page:{addInitScript:async()=>{}},request,createCleanupContext:async()=>({...request,dispose:async()=>{}})},{outputPath:name=>path.join(dir,name)});
  await run({fixture,actions,manifest,records,service,get menuName(){return menuName;},get manifestAtPut(){return manifestAtPut;},allowReadback:()=>{readback='success';}});
 } finally {vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});}
}

it('records complete caller-menu states before editing and deletes the unchanged owned menu',async()=>{
 await callerFixture(async context=>{
  const {fixture,manifest,actions,records}=context;
  await fixture.createCallerMenu(`agenda:${fixture.id}/current`);
  const saved=manifest().callerMenu;
  expect(saved.preUpdateState).toEqual({type:'menus',name:context.menuName,title:context.menuName,metadata:{},sections:[{items:[],index:0}],household:'home'});
  expect(context.manifestAtPut.callerMenu.preUpdateState).toEqual(saved.preUpdateState);
  expect(context.manifestAtPut.callerMenu.updateAttempted).toBe(true);
  expect(saved.postUpdateState.sections[0].items).toEqual([{title:'Open week',list:{contentId:`agenda:${fixture.id}/current`},label:'Open week',input:`agenda:${fixture.id}/current`,action:'List',sectionIndex:0,itemIndex:0}]);
  await fixture.cleanup();
  const menuPath=`/api/v1/admin/content/lists/menus/${context.menuName}`;
  expect(actions.filter(([method])=>method==='delete')).toEqual([['delete',menuPath]]);
  expect(actions.slice(actions.findIndex(([method])=>method==='delete')+1)).toContainEqual(['get',menuPath]);
  expect(records.size).toBe(0);expect(manifest().callerMenu.cleanupVerified).toBe(true);
 });
});
it('refuses an existing caller menu without creating, editing or deleting it',async()=>{
 await callerFixture(async({fixture,actions})=>{
  await expect(fixture.createCallerMenu(`agenda:${fixture.id}/current`)).rejects.toThrow();
  expect(actions.filter(([method])=>method!=='get')).toEqual([['post','/api/v1/admin/content/agendas']]);
  expect(fixture.manifest.callerMenu).toBeNull();
 },{collision:true});
});
it.each([
 ['target',document=>{document.sections[0].items[0].list.contentId='agenda:other/current';}],
 ['item title',document=>{document.sections[0].items[0].title='Changed';}],
 ['item flags',document=>{document.sections[0].items[0].shuffle=true;}],
 ['section metadata',document=>{document.sections[0].title='Changed section';}],
 ['list metadata',document=>{document.metadata.active=false;}],
 ['list title',document=>{document.title='Changed menu';}],
 ['removed item',document=>{document.sections[0].items=[];}],
 ['added empty section',document=>{document.sections.push({items:[]});}]
])('refuses caller-menu deletion after changed %s',async(_label,change)=>{
 await callerFixture(async context=>{
  const {fixture,service,actions}=context;
  await fixture.createCallerMenu(`agenda:${fixture.id}/current`);
  const document=normalizeListConfig(context.records.get(context.menuName),context.menuName);
  change(document);
  context.records.set(context.menuName,JSON.parse(JSON.stringify(serializeListConfig(document))));
  await expect(fixture.cleanup()).rejects.toThrow('Fixture cleanup failed');
  expect(actions.filter(([method])=>method==='delete')).toEqual([]);
  expect(fixture.manifest.cleanupFailures.some(item=>item.operation==='caller-menu')).toBe(true);
  expect(service.getList('menus',context.menuName,'home')).toBeTruthy();
 });
});
it('cleans the proven initial caller menu after a rejected update leaves it unchanged',async()=>{
 await callerFixture(async({fixture,actions,records,manifest})=>{
  await expect(fixture.createCallerMenu(`agenda:${fixture.id}/current`)).rejects.toThrow();
  expect(manifest().callerMenu.preUpdateState.sections[0].items).toEqual([]);
  await fixture.cleanup();expect(actions.filter(([method])=>method==='delete')).toHaveLength(1);expect(records.size).toBe(0);
 },{update:'rejected'});
});
it.each(['ambiguous','malformed'])('refuses altered caller-menu cleanup after an %s update response',async update=>{
 await callerFixture(async({fixture,actions,records})=>{
  await expect(fixture.createCallerMenu(`agenda:${fixture.id}/current`)).rejects.toThrow();
  await expect(fixture.cleanup()).rejects.toThrow('Fixture cleanup failed');
  expect(actions.filter(([method])=>method==='delete')).toEqual([]);expect(records.size).toBe(1);
 },{update});
});
it('refuses cleanup when successful update readback failed, even if the item is later removed',async()=>{
 await callerFixture(async context=>{
  await expect(context.fixture.createCallerMenu(`agenda:${context.fixture.id}/current`)).rejects.toThrow('readback unavailable');
  context.allowReadback();context.records.set(context.menuName,{items:[]});
  await expect(context.fixture.cleanup()).rejects.toThrow('Fixture cleanup failed');
  expect(context.actions.filter(([method])=>method==='delete')).toEqual([]);
 },{readback:'failure'});
});
