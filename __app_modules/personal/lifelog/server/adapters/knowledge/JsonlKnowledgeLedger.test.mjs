// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {JsonlKnowledgeLedger} from './JsonlKnowledgeLedger.mjs';import {KnowledgeWriteAuthority} from './KnowledgeWriteAuthority.mjs';
let root,authority,ledger;const username='sample_user';
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-ledger-'));authority=new KnowledgeWriteAuthority({configuration:{enabled:true,write:true,writer_env:'fixture-prod',writer_host:'writer-fixture'},environment:'fixture-prod',hostId:'writer-fixture'});ledger=new JsonlKnowledgeLedger({rootForUser:()=>root,hostId:'writer-fixture',authority});});
afterEach(async()=>{await authority.close();fs.rmSync(root,{recursive:true,force:true});});
const prepared=()=>({username,runId:'run-one',expectedRevision:'0:empty',batch:{events:[{id:'proposal-1'}]},before:{files:{}},after:{files:{}},asOf:Date.parse('2026-11-03T15:00Z')});
describe('replayable knowledge ledger',()=>{
 it('deduplicates prepare and complete without duplicating proposal events',async()=>{
  await ledger.prepare(prepared());await ledger.prepare(prepared());await ledger.complete({username,runId:'run-one',revision:'1:done',asOf:prepared().asOf});await ledger.complete({username,runId:'run-one',revision:'1:done',asOf:prepared().asOf});
  const result=await ledger.read({username});expect(result.transactions).toHaveLength(1);expect(result.events).toHaveLength(2);expect(result.transactions[0].complete.revision).toBe('1:done');
 });
 it('reports a truncated final line without repairing it until the writer recovers',async()=>{
  await ledger.prepare(prepared());const file=path.join(root,'ledger/2026-11.writer-fixture.jsonl');fs.appendFileSync(file,'{"unfinished":');
  const before=fs.readFileSync(file,'utf8');const result=await ledger.read({username});expect(result.tailRepairBytes).toBeGreaterThan(0);expect(fs.readFileSync(file,'utf8')).toBe(before);
  await ledger.repair({username});expect((await ledger.read({username})).tailRepairBytes).toBe(0);
 });
 it('does not silently truncate a malformed complete ledger record',async()=>{
  await ledger.prepare(prepared());const file=path.join(root,'ledger/2026-11.writer-fixture.jsonl');fs.appendFileSync(file,'not json\n');
  await expect(ledger.read({username})).rejects.toMatchObject({code:'KNOWLEDGE_LEDGER_CORRUPT'});expect(fs.readFileSync(file,'utf8')).toContain('not json');
 });
});
