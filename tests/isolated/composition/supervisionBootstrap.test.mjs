import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,writeFile,mkdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {emptySupervisionState} from '../../../__app_modules/household/supervision/shared/contracts.mjs';

const execute=promisify(execFile);
const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function bootstrap({enabled=false,persisted}={}){
 const root=await mkdtemp(join(tmpdir(),'supervision-bootstrap-'));roots.push(root);
 const path=join(root,'household','supervision','current.json');
 if(persisted!==undefined){await mkdir(join(root,'household','supervision'),{recursive:true});await writeFile(path,persisted);}
 // Exercise the real repository on every OS with the Linux lock deliberately unavailable.
 const {stdout}=await execute(process.execPath,['--input-type=module','-e',`
  import {createSupervisionRuntime} from ${JSON.stringify(new URL('../../../__backend/src/5_composition/modules/supervision.mjs',import.meta.url).href)};
  try {
   const runtime=await createSupervisionRuntime({configuration:{enabled:${enabled}},householdId:'home',configService:{getHouseholdPath:()=>${JSON.stringify(path)}}});
   process.stdout.write(JSON.stringify({enabled:runtime.enabled}));runtime.dispose();
  } catch(error){process.stdout.write(JSON.stringify({error:error.code??error.message}));}
 `],{env:{...process.env,PATH:root}});
 return {result:JSON.parse(stdout),path,root};
}
describe('supervision bootstrap without a Linux writer lock',()=>{
 it('keeps a never-configured installation disabled without creating ledger directories',async()=>{
  const {result,root}=await bootstrap();
  expect(result).toEqual({enabled:false});
  await expect(access(join(root,'household'))).rejects.toMatchObject({code:'ENOENT'});
 });
 it('requires the kernel writer lock when configuration is enabled',async()=>{
  expect((await bootstrap({enabled:true})).result).toEqual({error:'ENOENT'});
 });
 it.each([
  ['retained stop',JSON.stringify({...emptySupervisionState(),epoch:1})],
  ['retained configuration',JSON.stringify({...emptySupervisionState(),configuration:{devices:[],scopes:{}}})],
  ['corrupt ledger','{broken'],
  ['invalid ledger','{}'],
 ])('does not disable a %s when the writer lock is unavailable',async(_name,persisted)=>{
  expect((await bootstrap({persisted})).result).toEqual({error:'ENOENT'});
 });
});
