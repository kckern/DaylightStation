// @vitest-environment node
import {describe,it,expect,afterEach,beforeEach} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn as realSpawn} from 'node:child_process';import {once} from 'node:events';
import {WorkWriteAuthority} from './WorkWriteAuthority.mjs';
let root;const resources=[];const role={enabled:true,write:true,writer_env:'fixture-prod',writer_host:'fixture-writer'},quiet={info(){},warn(){}};
beforeEach(()=>{root=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'work-lease-')),'work');});
afterEach(async()=>{for(const a of resources.splice(0))await a.close();fs.rmSync(path.dirname(root),{recursive:true,force:true});});
function make(options={}){const a=new WorkWriteAuthority({configuration:role,environment:'fixture-prod',hostId:'fixture-writer',logger:quiet,...options});resources.push(a);return a;}
describe('configured Work writer lease',()=>{
 it.each([{configuration:{...role,enabled:false}},{configuration:{...role,write:false}},{environment:'laptop'},{hostId:'other'},{platform:'darwin'}])('denies every partial writer role without creating a data directory: %j',async options=>{await expect(make(options).assertWriter({root})).rejects.toMatchObject({code:'WORK_WRITE_DENIED'});expect(fs.existsSync(root)).toBe(false);});
 it.runIf(process.platform==='linux')('holds a real kernel lease until closed, independently of the lock file existing',async()=>{const a=make(),b=make();await a.assertWriter({root});await expect(b.assertWriter({root})).rejects.toMatchObject({code:'WORK_WRITER_BUSY'});await a.close();await expect(b.assertWriter({root})).resolves.toBe(true);});
 it.runIf(process.platform==='linux')('denies writes after its actual lease holder exits',async()=>{let child;const a=make({spawn:(...args)=>(child=realSpawn(...args))});await a.assertWriter({root});const exited=once(child,'exit');child.kill('SIGTERM');await exited;expect(a.leaseLost).toBe(true);await expect(a.assertWriter({root})).rejects.toMatchObject({code:'WORK_LEASE_LOST'});child.stdin.end();});
});
import {matchesWriter} from './WorkWriteAuthority.mjs';
describe('matchesWriter (container writer without a fixed host)',()=>{
 const docker={writer_env:'docker',writer_host:null};
 it('accepts the prod container: env matches, Linux, /.dockerenv present, any hostname',()=>{expect(matchesWriter(docker,{environment:'docker',hostId:'a72331dfface',platform:'linux',isDocker:true})).toBe(true);expect(matchesWriter(docker,{environment:'docker',hostId:'0f00ba5e1234',platform:'linux',isDocker:true})).toBe(true);});
 it.each([[{environment:'docker',hostId:'x',platform:'linux',isDocker:false}],[{environment:'laptop',hostId:'x',platform:'linux',isDocker:true}],[{environment:'docker',hostId:'x',platform:'darwin',isDocker:true}],[{environment:undefined,hostId:'x',platform:'linux',isDocker:true}]])('refuses anything that is not the container: %j',runtime=>{expect(matchesWriter(docker,runtime)).toBe(false);});
 it('a configured writer_host must still match exactly, container or not',()=>{const pinned={writer_env:'docker',writer_host:'fixed-writer-host'};expect(matchesWriter(pinned,{environment:'docker',hostId:'fixed-writer-host',platform:'linux',isDocker:false})).toBe(true);expect(matchesWriter(pinned,{environment:'docker',hostId:'a72331dfface',platform:'linux',isDocker:true})).toBe(false);});
 it('no writer_env never matches',()=>{expect(matchesWriter({writer_env:null,writer_host:null},{environment:'docker',hostId:'x',platform:'linux',isDocker:true})).toBe(false);});
 it.runIf(process.platform==='linux')('the authority grants a lease to the container writer with no writer_host',async()=>{const a=new WorkWriteAuthority({configuration:{enabled:true,write:true,writer_env:'docker',writer_host:null},environment:'docker',hostId:'changes-every-deploy',isDocker:true,logger:quiet});resources.push(a);await expect(a.assertWriter({root})).resolves.toBe(true);});
});
