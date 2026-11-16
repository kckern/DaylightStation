import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
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
