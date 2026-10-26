import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {afterEach,it,expect,vi} from 'vitest';
import {YamlGamingSnapshotRepository} from './YamlGamingSnapshotRepository.mjs';
import {JsonGamingSnapshotRepository} from './JsonGamingSnapshotRepository.mjs';
import {YamlGamingSessionJournal} from './YamlGamingSessionJournal.mjs';
import {MemorySnapshotRepository,MemorySessionJournal} from '../../../portable/testing/memoryPorts.mjs';
const roots=[];afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'gaming-json-'));roots.push(root);const legacy=new YamlGamingSnapshotRepository({snapshotsDir:root});return{root,legacy,snapshots:new JsonGamingSnapshotRepository({snapshotsDir:root,legacy})};};
const session=(revision=0)=>({header:{session_id:'game:test',revision},state:{count:revision},accepted_commands:{'old:command':{fingerprint:'fingerprint',events:[]}}});
it('promotes legacy YAML to atomic JSON without changing the legacy artifact',async()=>{
 const {root,legacy,snapshots}=fixture();const original=session();await legacy.put(original,{expectedRevision:null});const old=fs.readFileSync(path.join(root,'game:test.yml'),'utf8');
 expect(await snapshots.get('game:test')).toEqual(original);const token=await snapshots.getVersion('game:test');
 await snapshots.put(session(1),{expectedRevision:0});
 expect(await snapshots.getVersion('game:test')).not.toBe(token);
 expect(fs.readFileSync(path.join(root,'game:test.yml'),'utf8')).toBe(old);
 expect(await new JsonGamingSnapshotRepository({snapshotsDir:root,legacy}).get('game:test')).toEqual(session(1));
});
it('fails closed on malformed JSON even if valid legacy YAML remains',async()=>{
 const {root,legacy,snapshots}=fixture();await legacy.put(session(),{expectedRevision:null});fs.writeFileSync(path.join(root,'game:test.json'),'{bad');
 await expect(snapshots.get('game:test')).rejects.toMatchObject({code:'snapshot_corrupt'});
});
it('enforces revision CAS and one winner across repository instances',async()=>{
 const {root,legacy,snapshots}=fixture();await snapshots.put(session(),{expectedRevision:null});
 const other=new JsonGamingSnapshotRepository({snapshotsDir:root,legacy});
 const results=await Promise.allSettled([snapshots.put(session(1),{expectedRevision:0}),other.put(session(1),{expectedRevision:0})]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 expect(results.find(x=>x.status==='rejected').reason).toHaveProperty('code','revision_conflict');
 expect((await snapshots.get('game:test')).header.revision).toBe(1);
});
it('does not parse old YAML after JSON promotion and detects external JSON changes',async()=>{
 const {root,legacy,snapshots}=fixture();await legacy.put(session(),{expectedRevision:null});await snapshots.put(session(1),{expectedRevision:0});
 const parse=vi.spyOn(legacy,'get');await snapshots.get('game:test');await snapshots.put(session(2),{expectedRevision:1});expect(parse).not.toHaveBeenCalled();
 const token=await snapshots.getVersion('game:test');const file=path.join(root,'game:test.json');fs.writeFileSync(file,JSON.stringify(session(3)));fs.utimesSync(file,new Date('2030-01-01'),new Date('2030-01-01'));
 expect(await snapshots.getVersion('game:test')).not.toBe(token);expect((await snapshots.get('game:test')).header.revision).toBe(3);
});
it('appends against a stable journal head without rereading full history',async()=>{
 const {root}=fixture();const journal=new YamlGamingSessionJournal({journalsDir:root});await journal.create('game:test',{header:session().header});
 const before=await journal.getVersion('game:test');const read=vi.spyOn(fs,'readFileSync');
 await journal.append('game:test',{command:{command_id:'one'},events:[]},{expectedRevision:0});
 expect(read.mock.calls.filter(([file])=>String(file).endsWith('game:test.jsonl'))).toHaveLength(0);
 expect(await journal.getVersion('game:test')).not.toBe(before);
});
it('refuses a changed journal head until it has been reread',async()=>{
 const {root}=fixture();const journal=new YamlGamingSessionJournal({journalsDir:root});await journal.create('game:test',{header:session().header});
 fs.appendFileSync(path.join(root,'game:test.jsonl'),JSON.stringify({kind:'command-committed',revision:1,command:{},events:[]})+'\n');
 await expect(journal.append('game:test',{command:{},events:[]},{expectedRevision:0})).rejects.toMatchObject({code:'revision_conflict'});
 expect((await journal.read('game:test')).length).toBe(2);
 await journal.append('game:test',{command:{},events:[]},{expectedRevision:1});
});
it('memory-port versions notice direct corruption as well as normal writes',async()=>{
 const snapshots=new MemorySnapshotRepository();const journal=new MemorySessionJournal();await snapshots.put(session(),{expectedRevision:null});await journal.create('game:test',{header:session().header});
 const a=await snapshots.getVersion('game:test'),b=await journal.getVersion('game:test');snapshots.sessions.get('game:test').state.count=999;journal.records.get('game:test')[0].header.revision=8;
 expect(await snapshots.getVersion('game:test')).not.toBe(a);expect(await journal.getVersion('game:test')).not.toBe(b);
});
it('detects same-length journal corruption and does not append through it', async () => {
 const {root}=fixture();const journal=new YamlGamingSessionJournal({journalsDir:root});await journal.create('game:test',{header:session().header});
 const file=path.join(root,'game:test.jsonl'),before=await journal.getVersion('game:test');
 fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('session-created','session-corrupt'));
 expect(await journal.getVersion('game:test')).not.toBe(before);
 await expect(journal.append('game:test',{command:{},events:[]},{expectedRevision:0})).rejects.toMatchObject({code:'revision_conflict'});
});
it('invalidates a journal head after a failed append', async () => {
 const {root}=fixture();const journal=new YamlGamingSessionJournal({journalsDir:root});await journal.create('game:test',{header:session().header});
 const append=vi.spyOn(fs,'appendFileSync').mockImplementationOnce(()=>{throw new Error('disk unavailable');});
 await expect(journal.append('game:test',{command:{},events:[]},{expectedRevision:0})).rejects.toThrow('disk unavailable');append.mockRestore();
 await journal.append('game:test',{command:{},events:[]},{expectedRevision:0});
 expect(await journal.read('game:test')).toHaveLength(2);
});
