import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, writeFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {JsonSupervisionRepository} from '../../../../__app_modules/household/supervision/server/adapters/JsonSupervisionRepository.mjs';
import {SupervisionService} from '../../../../__app_modules/household/supervision/server/application/SupervisionService.mjs';
const actor={id:'parent',roles:['guardian'],authenticatedBy:'test-reader'};
const cleanup=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse()) await fn();});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'supervision-')); cleanup.push(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'current.json'); let repository=new JsonSupervisionRepository({path}); cleanup.push(()=>repository.close());
 const publications=[]; let fail=false;
 const gates={publishStop:async payload=>{publications.push(structuredClone(payload));if(fail)throw Error('offline');return {projectionRevision:publications.length};}};
 const options={scopes:{'child-public':['garage','portal']},clock:{now:()=>100000},stateGates:gates};
 let service=new SupervisionService({...options,repository});
 return {path,publications,get repository(){return repository;},get service(){return service;},setFailure(value){fail=value;},async restart(scopes=options.scopes){await repository.close();repository=new JsonSupervisionRepository({path});service=new SupervisionService({...options,scopes,repository});return service;}};
}
describe('durable parent stop',()=>{
 it('persists_stop_before_publication_and_keeps_it_after_restart',async()=>{
  const h=await fixture();await h.service.initialize();h.setFailure(true);
  expect(await h.service.stop({actor,scopeId:'child-public',source:'fingerprint',idempotencyKey:'scan1'})).toMatchObject({active:true,epoch:1,publication:'pending'});
  const disk=JSON.parse(await readFile(h.path,'utf8'));expect(disk.devices.portal.active).toBe(true);
  const first=h.publications.at(-1);await h.restart();expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:true,epoch:1});
  h.setFailure(false);await h.service.reconcile();expect(h.publications).toContainEqual(first);
  expect(await h.service.stop({actor,scopeId:'child-public',idempotencyKey:'scan1'})).toMatchObject({epoch:1,active:true});
 });
 it('release_failure_and_corrupt_storage_never_unlock',async()=>{
  const h=await fixture();await h.service.initialize();await h.service.stop({actor,scopeId:'child-public',idempotencyKey:'s'});h.setFailure(true);
  expect(await h.service.release({actor,scopeId:'child-public',idempotencyKey:'r'})).toMatchObject({active:true});
  await h.restart();expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:true});
  await h.repository.close();await writeFile(h.path,'{bad');await expect(h.service.status({deviceId:'portal'})).rejects.toThrow();
 });
 it.each([
  {fitness:{lockedUntil:200000,lockedAt:90000,lockedBy:'user_9'}},
  {shutdown:{locked_at:new Date(90000).toISOString(),locked_until:new Date(200000).toISOString(),targets:['school:portal']}}
 ])('migrates_legacy_active_locks without releasing on expiry',async legacy=>{
  const h=await fixture();await h.service.initialize({legacy});
  expect(await h.service.status({deviceId:'portal'})).toMatchObject({active:true});
  await h.restart();expect(await h.service.status({deviceId:'garage'})).toMatchObject({active:true});
 });
 it('kernel_writer_lock_is_released_when_backend_crashes',async()=>{
  const h=await fixture();await h.repository.close();
  const moduleUrl=pathToFileURL(resolve('__app_modules/household/supervision/server/adapters/JsonSupervisionRepository.mjs')).href;
  const script=`import {JsonSupervisionRepository} from ${JSON.stringify(moduleUrl)};const r=new JsonSupervisionRepository({path:${JSON.stringify(h.path)}});await r.read();process.stdout.write('ready');setInterval(()=>{},10000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',script]);cleanup.push(async()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  await once(child.stdout,'data');child.kill('SIGKILL');await once(child,'exit');
  await new Promise(resolve=>setTimeout(resolve,100));
  const next=new JsonSupervisionRepository({path:h.path});cleanup.push(()=>next.close());
  expect(await next.read()).toMatchObject({epoch:0});
 });
 it('rejects unverified adults and concurrent repository writers',async()=>{
  const h=await fixture();await h.service.initialize();
  await expect(h.service.stop({actor:{id:'child',roles:['guardian']},scopeId:'child-public',idempotencyKey:'fake'})).rejects.toMatchObject({status:403});
  const second=new JsonSupervisionRepository({path:h.path});cleanup.push(()=>second.close());await expect(second.read()).rejects.toMatchObject({code:'SUPERVISION_WRITER_CONFLICT'});
 });
});

it('lease reconciliation does not replace unchanged durable state, while mutations still persist',async()=>{
 const h=await fixture();await h.service.initialize();const before=await stat(h.path);
 await h.repository.transaction(()=>undefined);expect((await stat(h.path)).ino).toBe(before.ino);
 await h.repository.transaction(state=>{state.epoch++;});expect((await stat(h.path)).ino).not.toBe(before.ino);expect(JSON.parse(await readFile(h.path,'utf8')).epoch).toBe(1);
});

// Configuration removal cannot erase coverage already retained by the durable owner.
it('restart and configuration removal retain the active Stop',async()=>{
 const h=await fixture();await h.service.initialize();await h.service.stop({actor,scopeId:'child-public',idempotencyKey:'persistent'});
 const revision=(await h.service.status({deviceId:'portal'})).commandRevisions.portal;
 const restartedService=await h.restart({'remaining':['garage']});await restartedService.initialize();
 expect((await restartedService.status({deviceId:'portal'})).active).toBe(true);
 expect((await restartedService.status({deviceId:'portal'})).commandRevisions.portal).toBe(revision);
 expect(JSON.parse(await readFile(h.path,'utf8')).devices.portal.active).toBe(true);
});
