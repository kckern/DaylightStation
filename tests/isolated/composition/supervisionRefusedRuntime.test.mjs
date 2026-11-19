import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import express from 'express';
import request from 'supertest';
import {emptySupervisionState} from '../../../__app_modules/household/supervision/shared/contracts.mjs';
import {createSupervisionRuntime} from '../../../__backend/src/5_composition/modules/supervision.mjs';

const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const LAPTOP={environment:'laptop-dev',hostId:'laptop',platform:'darwin',isDocker:false};
const PROD={environment:'docker',hostId:'3f2a9c1b7d4e',platform:'linux',isDocker:true};
const RETAINED_STOP=JSON.stringify({...emptySupervisionState(),epoch:1});

async function refused({configuration={enabled:true},runtime=LAPTOP,persisted=RETAINED_STOP}={}){
 const root=await mkdtemp(join(tmpdir(),'supervision-refused-'));roots.push(root);
 const dir=join(root,'supervision'),path=join(dir,'current.json');
 if(persisted!==null){await mkdir(dir,{recursive:true});await writeFile(path,persisted);}
 const logs=[];const logger={error:(event,data)=>logs.push(['error',event,data]),warn:(event,data)=>logs.push(['warn',event,data]),info:(event,data)=>logs.push(['info',event,data])};
 const supervision=await createSupervisionRuntime({...runtime,configuration,householdId:'home',logger,configService:{getHouseholdPath:()=>path}});
 return {supervision,logs,path,dir};
}

describe('a backend that is not the supervision writer boots into a refused runtime', () => {
 it('with a retained Stop: deny-all, 503, refused health, one error log, ledger and lock untouched', async () => {
  const {supervision,logs,path,dir}=await refused();
  try{
   expect(supervision.enabled).toBe(true);
   const denied={code:'SUPERVISION_WRITER_HOST_REFUSED'};
   await expect(supervision.guard.authorize({deviceId:'portal',activityId:'school:workspace'})).rejects.toMatchObject(denied);
   let ran=false;
   await expect(supervision.guard.runAuthorized({deviceId:'portal',activityId:'tv'},async()=>{ran=true;})).rejects.toMatchObject(denied);
   expect(ran).toBe(false);
   await expect(supervision.resolveContext({headers:{}},{activityId:'school:workspace'})).rejects.toMatchObject(denied);
   await expect(supervision.service.stop({actor:{id:'parent',roles:['guardian'],authenticatedBy:'test'},scopeId:'child-public',idempotencyKey:'k'})).rejects.toMatchObject(denied);
   await expect(supervision.service.release({})).rejects.toMatchObject(denied);
   // Reads answer fail-closed instead of throwing: nothing is unlocked.
   expect(await supervision.service.status({deviceId:'portal'})).toMatchObject({active:true,refused:true});
   expect(await supervision.service.decideActivity({deviceId:'portal'})).toMatchObject({allowed:false,reason:'SUPERVISION_WRITER_HOST_REFUSED'});
   await supervision.service.reconcile();
   expect(supervision.verifyScan({topic:'biometric.scan'})).toBe(false);
   const app=express();app.use('/supervision',supervision.router);
   const reply=await request(app).get('/supervision/bootstrap');
   expect(reply.status).toBe(503);
   expect(reply.body).toMatchObject({code:'SUPERVISION_WRITER_HOST_REFUSED',error:expect.stringMatching(/supervision ledger is written only by writer_env=docker on linux in a container; this backend is env=laptop-dev host=laptop/)});
   expect(await supervision.health()).toMatchObject({writer:'refused',configuredWriter:{writer_env:'docker',writer_host:null},host:{environment:'laptop-dev',hostId:'laptop',platform:'darwin'},activationAllowed:false,errors:['SUPERVISION_WRITER_HOST_REFUSED']});
   expect(logs.filter(([level])=>level==='error')).toEqual([['error','supervision.writer.refused',expect.objectContaining({message:expect.stringMatching(/written only by writer_env=docker/)})]]);
   expect(await readFile(path,'utf8')).toBe(RETAINED_STOP);
   expect(await readdir(dir)).toEqual(['current.json']);
  }finally{supervision.dispose();}
 });

 it('offers every member app.mjs reads, so createApp composes around it', async () => {
  const {supervision}=await refused();
  try{
   for(const fn of ['resolveContext','verifyScan','health','dispose'])expect(typeof supervision[fn]).toBe('function');
   for(const fn of ['stop','status','reconcile','decideActivity'])expect(typeof supervision.service[fn]).toBe('function');
   for(const fn of ['authorize','runAuthorized'])expect(typeof supervision.guard[fn]).toBe('function');
   expect(typeof supervision.router).toBe('function');
   expect(supervision.configuration).toMatchObject({enabled:true});
   for(const key of ['surface_devices','scope_id','legacy_targets','garage_device_id'])expect(()=>supervision.configuration[key]).not.toThrow();
   // Not a thenable: `await runtime` must give the runtime back.
   expect(await supervision.service).toBe(supervision.service);
  }finally{supervision.dispose();}
 });

 it('a misconfigured writer block on prod refuses loudly instead of crashing', async () => {
  const {supervision,logs}=await refused({configuration:{enabled:true,writer:'docker'},runtime:PROD});
  try{
   expect(supervision.enabled).toBe(true);
   expect(await supervision.health()).toMatchObject({writer:'refused',configuredWriter:{valid:false}});
   await expect(supervision.guard.authorize({deviceId:'portal'})).rejects.toMatchObject({code:'SUPERVISION_WRITER_HOST_REFUSED'});
   expect(logs.filter(([level])=>level==='error').map(([,event])=>event)).toEqual(['supervision.writer.refused']);
  }finally{supervision.dispose();}
 });

 it('a refused host with supervision configured but no ledger yet is refused too, and creates nothing', async () => {
  const {supervision,dir}=await refused({persisted:null});
  try{
   expect(supervision.enabled).toBe(true);
   await expect(readdir(dir)).rejects.toMatchObject({code:'ENOENT'});
  }finally{supervision.dispose();}
 });

 it('a never-configured installation with no ledger stays disabled on a refused host', async () => {
  const {supervision,logs}=await refused({configuration:{enabled:false},persisted:null});
  expect(supervision.enabled).toBe(false);
  expect(logs).toEqual([]);
 });
});
