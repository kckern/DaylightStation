import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,mkdir,rm,access,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {emptySupervisionState} from '../../../__app_modules/household/supervision/shared/contracts.mjs';
import {acquireExclusiveFileLock} from '../../../__backend/src/0_system/utils/exclusiveFileLock.mjs';

const execute=promisify(execFile);
const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
// The bootstrap child is this test's configured writer unless a case says otherwise.
const WRITER={writer_env:'bootstrap-test',writer_host:'bootstrap-host'};
async function bootstrap({enabled=false,persisted,lockHeld=true,writer=WRITER,environment='bootstrap-test',emptyPath=false}={}){
 const root=await mkdtemp(join(tmpdir(),'supervision-bootstrap-'));roots.push(root);
 const path=join(root,'household','supervision','current.json');
 if(persisted!==undefined||lockHeld)await mkdir(join(root,'household','supervision'),{recursive:true});
 if(persisted!==undefined)await writeFile(path,persisted);
 // Exercise the real repository on every OS with the writer lock unavailable:
 // this process holds the real kernel lock, so the bootstrap child cannot take it.
 const held=lockHeld?await acquireExclusiveFileLock(`${path}.lock`):null;
 try{
 const {stdout}=await execute(process.execPath,['--input-type=module','-e',`
  import {createSupervisionRuntime} from ${JSON.stringify(new URL('../../../__backend/src/5_composition/modules/supervision.mjs',import.meta.url).href)};
  try {
   const runtime=await createSupervisionRuntime({configuration:{enabled:${enabled},writer:${JSON.stringify(writer)}},environment:${JSON.stringify(environment)},hostId:'bootstrap-host',householdId:'home',configService:{getHouseholdPath:()=>${JSON.stringify(path)}}});
   process.stdout.write(JSON.stringify({enabled:runtime.enabled,...(runtime.refused?{writer:(await runtime.health()).writer}:{})}));runtime.dispose();
  } catch(error){process.stdout.write(JSON.stringify({error:error.code??error.message}));}
 `],emptyPath?{env:{...process.env,PATH:root}}:undefined);
 return {result:JSON.parse(stdout),path,root};
 }finally{await held?.release();}
}
describe('supervision bootstrap when the writer lock is unavailable',()=>{
 it('keeps a never-configured installation disabled without creating ledger directories',async()=>{
  const {result,root}=await bootstrap({lockHeld:false});
  expect(result).toEqual({enabled:false});
  await expect(access(join(root,'household'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('requires the kernel writer lock when configuration is enabled',async()=>{
  expect((await bootstrap({enabled:true})).result).toEqual({error:'SUPERVISION_WRITER_CONFLICT'});
 });
 it.each([
  ['retained stop',JSON.stringify({...emptySupervisionState(),epoch:1})],
  ['retained configuration',JSON.stringify({...emptySupervisionState(),configuration:{devices:[],scopes:{}}})],
  ['corrupt ledger','{broken'],
  ['invalid ledger','{}'],
 ])('does not disable a %s when the writer lock is unavailable',async(_name,persisted)=>{
  expect((await bootstrap({persisted})).result).toEqual({error:'SUPERVISION_WRITER_CONFLICT'});
 });
});

describe('supervision bootstrap on a host that is not the configured writer',()=>{
 it('boots refused with a retained stop, before any lock or write, rather than disabling it or exiting',async()=>{
  const persisted=JSON.stringify({...emptySupervisionState(),epoch:1});
  const {result,path}=await bootstrap({persisted,lockHeld:false,environment:'laptop-dev'});
  expect(result).toEqual({enabled:true,writer:'refused'});
  expect(await readFile(path,'utf8')).toBe(persisted);
  await expect(access(`${path}.lock`)).rejects.toMatchObject({code:'ENOENT'});
 });
 it('keeps a never-configured installation disabled there too',async()=>{
  expect((await bootstrap({lockHeld:false,environment:'laptop-dev'})).result).toEqual({enabled:false});
 });
});

describe('supervision bootstrap on Linux without flock(1)',()=>{
 it.runIf(process.platform==='linux')('fails closed with SUPERVISION_WRITER_LOCK_FAILED when PATH has no flock',async()=>{
  const persisted=JSON.stringify({...emptySupervisionState(),epoch:1});
  expect((await bootstrap({persisted,lockHeld:false,emptyPath:true})).result).toEqual({error:'SUPERVISION_WRITER_LOCK_FAILED'});
 });
});
