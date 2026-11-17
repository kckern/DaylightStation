// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn as realSpawn} from 'node:child_process';
import {once} from 'node:events';
import {KnowledgeWriteAuthority} from './KnowledgeWriteAuthority.mjs';
let root;const authorities=[];
const config={enabled:true,write:true,writer_env:'fixture-prod',writer_host:'writer-fixture'};
beforeEach(()=>{root=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-lease-')),'knowledge');});
afterEach(async()=>{for(const a of authorities.splice(0))await a.close();fs.rmSync(path.dirname(root),{recursive:true,force:true});});
function create(options={}){const a=new KnowledgeWriteAuthority({configuration:config,environment:'fixture-prod',hostId:'writer-fixture',...options});authorities.push(a);return a;}
describe('knowledge write authority',()=>{
 it.each([{configuration:{...config,enabled:false}},{configuration:{...config,write:false}},{environment:'development'},{hostId:'other-host'},{platform:'darwin'}])('requires every writer predicate: %j',async options=>{
  const spawn=vi.fn();const a=create({...options,spawn});await expect(a.assertWriter({root})).rejects.toMatchObject({code:'KNOWLEDGE_WRITE_DENIED'});expect(spawn).not.toHaveBeenCalled();expect(fs.existsSync(root)).toBe(false);
 });
 it.runIf(process.platform==='linux')('uses a real kernel lease so a second writer cannot enter',async()=>{
  const a=create(),b=create();await a.assertWriter({root});await expect(b.assertWriter({root})).rejects.toMatchObject({code:'KNOWLEDGE_WRITER_BUSY'});
  await a.close();await expect(b.assertWriter({root})).resolves.toBe(true);
 });
});

it.runIf(process.platform==='linux')('detects a lost writer process and releases the real kernel lease',async()=>{
 let child;const a=create({spawn:(...args)=>(child=realSpawn(...args))});const b=create();
 await a.assertWriter({root});const ended=once(child,'exit');child.kill('SIGTERM');await ended;
 try {
  await expect(a.assertWriter({root})).rejects.toMatchObject({code:'KNOWLEDGE_LEASE_LOST'});
  await expect(b.assertWriter({root})).resolves.toBe(true);
 } finally {child.stdin.end();}
});
