// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import {spawn as realSpawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import yaml from 'js-yaml';
import * as FileIO from '#system/utils/FileIO.mjs';
import { YamlKnowledgeStore } from './YamlKnowledgeStore.mjs';
import { JsonlKnowledgeLedger } from './JsonlKnowledgeLedger.mjs';
import { KnowledgeWriteAuthority } from './KnowledgeWriteAuthority.mjs';
import { loop, AS_OF } from '../../domain/knowledge/fixtures.testHelpers.mjs';
let tmp; const resources=[]; const username='sample_user';
beforeEach(()=>{tmp=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-store-'));});
afterEach(async()=>{for(const item of resources.splice(0))await item.close();fs.rmSync(tmp,{recursive:true,force:true});});
function setup({configuration,io=FileIO,clock=()=>AS_OF,spawn}={}) {
  const rootForUser=user=>path.join(tmp,user,'lifelog','knowledge');
  const authority=new KnowledgeWriteAuthority({configuration:configuration??{enabled:true,write:true,writer_env:'fixture-prod',writer_host:'writer-fixture'},environment:'fixture-prod',hostId:'writer-fixture',spawn});
  resources.push(authority);
  const ledger=new JsonlKnowledgeLedger({rootForUser,hostId:'writer-fixture',authority,io});
  const store=new YamlKnowledgeStore({rootForUser,ledger,authority,clock,io});
  return {store,ledger,authority,root:rootForUser(username)};
}
const batch=(upserts=[loop()],statePatch={lastSweepAt:AS_OF,cursors:{journal:'source-1'}})=>({events:[{id:'event-one',type:'loop.opened',at:AS_OF}],upserts,moves:[],statePatch,previewOnly:false});
async function commit(h,{runId='run-one',data=batch()}={}) {const before=await h.store.read({username});return h.store.commit({username,expectedRevision:before.revision,runId,batch:data});}
describe('single-writer knowledge transactions',()=>{
  it('keeps a disabled or read-only read completely side-effect free',async()=>{
    const h=setup({configuration:{enabled:false,write:false}});
    expect((await h.store.read({username})).objects).toEqual({});expect(fs.existsSync(h.root)).toBe(false);
    await expect(commit(h)).rejects.toMatchObject({code:'KNOWLEDGE_WRITE_DENIED'});expect(fs.existsSync(h.root)).toBe(false);
  });
  it('never acquires authority for a preview-only batch',async()=>{
    const h=setup();await expect(commit(h,{data:{...batch(),previewOnly:true}})).rejects.toMatchObject({code:'KNOWLEDGE_PREVIEW_ONLY'});
    expect(fs.existsSync(h.root)).toBe(false);
  });
  it('commits YAML, source cursor and ledger once across retries',async()=>{
    const h=setup();const initial=await h.store.read({username});
    const first=await h.store.commit({username,expectedRevision:initial.revision,runId:'run-one',batch:batch()});
    const again=await h.store.commit({username,expectedRevision:initial.revision,runId:'run-one',batch:batch()});
    expect(first.applied).toBe(true);expect(again.applied).toBe(false);
    const read=await h.store.read({username});expect(read.objects['loop.application-reply'].title).toBe('Sample reply');
    expect(read.state.cursors.journal).toBe('source-1');expect(read.health.available).toBe(true);
    const ledger=await h.ledger.read({username});expect(ledger.transactions).toHaveLength(1);expect(ledger.transactions[0].complete).toBeTruthy();
    expect(fs.existsSync(path.join(h.root,'loops/application-reply.yml'))).toBe(true);
  });
  it('rejects stale revisions and detects a second independent hand edit during model work',async()=>{
    const h=setup();await commit(h);const before=await h.store.read({username});
    const file=path.join(h.root,'loops/application-reply.yml');const row=yaml.load(fs.readFileSync(file,'utf8'));row.title='User corrected title';fs.writeFileSync(file,yaml.dump(row));
    const edited=await h.store.read({username});expect(edited.objects[row.id].pinned).toContain('title');
    expect(edited.objects[row.id].user_edits).toContainEqual(expect.objectContaining({path:'title',by:'user_edit'}));
    await expect(h.store.commit({username,expectedRevision:before.revision,runId:'stale-model',batch:batch()})).rejects.toMatchObject({code:'STALE_KNOWLEDGE_REVISION'});
    row.loop.due='2026-12-01';fs.writeFileSync(file,yaml.dump(row));
    await expect(h.store.commit({username,expectedRevision:edited.revision,runId:'second-stale',batch:batch()})).rejects.toMatchObject({code:'STALE_KNOWLEDGE_REVISION'});
    const fresh=await h.store.read({username});await h.store.commit({username,expectedRevision:fresh.revision,runId:'preserve-edits',batch:batch([], {lastSweepAt:AS_OF})});
    const final=await h.store.read({username});expect(final.objects[row.id]).toMatchObject({title:'User corrected title',loop:{due:'2026-12-01'}});
    expect(final.objects[row.id].pinned).toEqual(expect.arrayContaining(['title','loop.due']));
  });
  it.each([1,2,3,4])('recovers exactly once after YAML write checkpoint %s',async checkpoint=>{
    let writes=0,crashed=false;
    const io={...FileIO,saveYamlToPathAtomic(...args){FileIO.saveYamlToPathAtomic(...args);if(!crashed&&++writes===checkpoint){crashed=true;throw Error('simulated process crash');}}};
    const h=setup({io});const second=loop({id:'loop.second'});
    await expect(commit(h,{data:batch([loop(),second])})).rejects.toThrow('simulated process crash');
    expect((await h.store.read({username})).health.available).toBe(false);
    await h.store.recover({username});const recovered=await h.store.read({username});
    expect(Object.keys(recovered.objects).sort()).toEqual(['loop.application-reply','loop.second']);expect(recovered.state.cursors.journal).toBe('source-1');
    const bytes=fs.readFileSync(path.join(h.root,'ledger/2026-11.writer-fixture.jsonl'),'utf8');
    await h.store.recover({username});expect(fs.readFileSync(path.join(h.root,'ledger/2026-11.writer-fixture.jsonl'),'utf8')).toBe(bytes);
    expect((await h.ledger.read({username})).transactions).toHaveLength(1);
  });
  it('recovers a durable state written before the completion marker',async()=>{
    const h=setup();const complete=h.ledger.complete.bind(h.ledger);let fail=true;
    h.ledger.complete=async args=>{if(fail){fail=false;throw Error('before complete');}return complete(args);};
    await expect(commit(h)).rejects.toThrow('before complete');expect((await h.store.read({username})).health.recovering).toBe(true);
    await h.store.recover({username});expect((await h.store.read({username})).health.available).toBe(true);
    expect((await h.ledger.read({username})).transactions).toHaveLength(1);
  });
  it('treats a failed acknowledgement after complete as a retry, not another transaction',async()=>{
    const h=setup();const complete=h.ledger.complete.bind(h.ledger);let fail=true;
    h.ledger.complete=async args=>{const result=await complete(args);if(fail){fail=false;throw Error('after complete');}return result;};
    await expect(commit(h)).rejects.toThrow('after complete');expect((await commit(h)).applied).toBe(false);
    expect((await h.ledger.read({username})).transactions).toHaveLength(1);
  });
  it('preserves an edit made during a crash instead of overwriting it during recovery',async()=>{
    let failed=false;const io={...FileIO,saveYamlToPathAtomic(...args){FileIO.saveYamlToPathAtomic(...args);if(!failed){failed=true;throw Error('crash');}}};
    const h=setup({io});await expect(commit(h)).rejects.toThrow('crash');
    const file=path.join(h.root,'loops/application-reply.yml');const object=yaml.load(fs.readFileSync(file,'utf8'));object.title='Edited during crash';fs.writeFileSync(file,yaml.dump(object));
    await expect(h.store.recover({username})).rejects.toMatchObject({code:'KNOWLEDGE_RECOVERY_CONFLICT'});
    expect(yaml.load(fs.readFileSync(file,'utf8')).title).toBe('Edited during crash');expect((await h.store.read({username})).health.available).toBe(false);
  });
  it('ignores conflicted copies for canonical data while blocking all mutation',async()=>{
    const h=setup();await commit(h);fs.writeFileSync(path.join(h.root,'loops/application-reply (writer conflicted copy).yml'),'bad: copy');
    const current=await h.store.read({username});expect(current.objects['loop.application-reply'].title).toBe('Sample reply');expect(current.health.conflicted).toBe(true);
    await expect(commit(h,{runId:'blocked'})).rejects.toMatchObject({code:'KNOWLEDGE_UNAVAILABLE'});
  });
  it.each(['bad yaml','removed evidence','changed id'])('blocks %s without destroying original ledger evidence',async kind=>{
    const h=setup();await commit(h);const file=path.join(h.root,'loops/application-reply.yml');const doc=yaml.load(fs.readFileSync(file,'utf8'));
    if(kind==='removed evidence')doc.evidence=[];if(kind==='changed id')doc.id='loop.replaced';fs.writeFileSync(file,kind==='bad yaml'?'[invalid':yaml.dump(doc));
    expect((await h.store.read({username})).health.available).toBe(false);expect((await h.ledger.read({username})).transactions).toHaveLength(1);
  });
  it('moves closed loops and reopens them without changing identity',async()=>{
    const h=setup();await commit(h);const closed=loop({status:'answered',closedOn:'2026-11-03'});
    await commit(h,{runId:'close',data:batch([closed])});expect(fs.existsSync(path.join(h.root,'closed/2026/application-reply.yml'))).toBe(true);expect(fs.existsSync(path.join(h.root,'loops/application-reply.yml'))).toBe(false);
    await commit(h,{runId:'reopen',data:batch([loop()])});expect(fs.existsSync(path.join(h.root,'loops/application-reply.yml'))).toBe(true);expect(fs.existsSync(path.join(h.root,'closed/2026/application-reply.yml'))).toBe(false);
  });
  it('rejects traversal in users and object identities before creating outside paths',async()=>{
    const h=setup();await expect(h.store.read({username:'../outside'})).rejects.toMatchObject({code:'INVALID_KNOWLEDGE_USER'});
    await expect(commit(h,{data:batch([loop({id:'loop.../outside'})])})).rejects.toThrow();expect(fs.existsSync(path.join(tmp,'outside'))).toBe(false);
  });
});

describe('recovery and hand-edit edge cases',()=>{
 it('recovers an interrupted archive move before the updated object image is saved',async()=>{
  let fail=false;const io={...FileIO,renameFile(...args){FileIO.renameFile(...args);if(fail){fail=false;throw Error('after rename');}}};
  const h=setup({io});await commit(h);fail=true;
  await expect(commit(h,{runId:'close-crash',data:batch([loop({status:'answered',closedOn:'2026-11-03'})])})).rejects.toThrow('after rename');
  await h.store.recover({username});const snapshot=await h.store.read({username});expect(snapshot.health.available).toBe(true);expect(snapshot.objects['loop.application-reply'].status).toBe('answered');
  expect(fs.existsSync(path.join(h.root,'loops/application-reply.yml'))).toBe(false);expect(fs.existsSync(path.join(h.root,'closed/2026/application-reply.yml'))).toBe(true);
 });
 it('blocks a malformed state file without guessing replacement state',async()=>{
  const h=setup();await commit(h);fs.writeFileSync(path.join(h.root,'state.yml'),'[bad');
  expect((await h.store.read({username})).health.available).toBe(false);expect(fs.readFileSync(path.join(h.root,'state.yml'),'utf8')).toBe('[bad');
 });
 it('never overwrites a newly auto-pinned field even with a fresh revision',async()=>{
  const h=setup();await commit(h);const file=path.join(h.root,'loops/application-reply.yml');const doc=yaml.load(fs.readFileSync(file,'utf8'));doc.title='User title';fs.writeFileSync(file,yaml.dump(doc));
  const fresh=await h.store.read({username});const stale=structuredClone(fresh.objects[doc.id]);stale.title='Sample reply';await expect(h.store.commit({username,expectedRevision:fresh.revision,runId:'overwrite-pin',batch:batch([stale])})).rejects.toMatchObject({code:'KNOWLEDGE_PINNED_FIELD'});
  expect(yaml.load(fs.readFileSync(file,'utf8')).title).toBe('User title');
 });
 it('preserves explicit evidence retraction while appending later evidence',async()=>{
  const h=setup();await commit(h);const file=path.join(h.root,'loops/application-reply.yml');const doc=yaml.load(fs.readFileSync(file,'utf8'));doc.evidence[0].retracted=true;fs.writeFileSync(file,yaml.dump(doc));
  const fresh=await h.store.read({username});const next=structuredClone(fresh.objects[doc.id]);next.evidence.push({ref:'journalist:msg:new',date:'2026-11-03',quote:'I am still waiting',source:'user'});
  await h.store.commit({username,expectedRevision:fresh.revision,runId:'append-evidence',batch:batch([next])});
  expect((await h.store.read({username})).objects[doc.id].evidence).toEqual([expect.objectContaining({retracted:true}),expect.objectContaining({ref:'journalist:msg:new'})]);
 });
 it('treats alias names as dictionary data, including prototype-shaped names',async()=>{
  const h=setup();const person={...loop(),id:'person.sample',kind:'person',status:'active',names:['__proto__'],aliases:[]};
  await commit(h,{data:batch([person])});const read=await h.store.read({username});
  expect(read.health.available).toBe(true);expect(Object.hasOwn(read.roster.aliases,'__proto__')).toBe(true);expect(read.roster.aliases.__proto__).toEqual(['person.sample']);
 });
});

it('keeps direct-edit identity stable while the injected clock advances between read and commit',async()=>{
 let now=AS_OF;const h=setup({clock:()=>now++});await commit(h);const file=path.join(h.root,'loops/application-reply.yml');const doc=yaml.load(fs.readFileSync(file,'utf8'));doc.title='Edited title';fs.writeFileSync(file,yaml.dump(doc));
 const read=await h.store.read({username});const updated=structuredClone(read.objects[doc.id]);updated.evidence.push({ref:'journalist:msg:later',quote:'Still waiting',date:'2026-11-03',source:'user'});
 await h.store.commit({username,expectedRevision:read.revision,runId:'later-clock',batch:batch([updated])});expect((await h.store.read({username})).objects[doc.id].title).toBe('Edited title');
});
it('does not trust hand-edited alias projections as confirmed people',async()=>{
 const h=setup();await commit(h);const file=path.join(h.root,'roster.yml');fs.writeFileSync(file,yaml.dump({schema:'lifelog-knowledge-roster/v1',aliases:{unverified:['person.unknown']}}));
 expect((await h.store.read({username})).health.available).toBe(false);
});

it.runIf(process.platform==='linux')('marks the writer view unhealthy immediately when its kernel lease is lost',async()=>{
 let child;const h=setup({spawn:(...args)=>(child=realSpawn(...args))});await commit(h);
 const ended=once(child,'exit');child.kill('SIGTERM');await ended;
 try{expect((await h.store.read({username})).health.available).toBe(false);}finally{child.stdin.end();}
});
