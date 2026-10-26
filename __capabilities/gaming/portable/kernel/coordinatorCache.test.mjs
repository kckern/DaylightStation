import fs from 'node:fs';
import path from 'node:path';
import { afterEach, it, expect, vi } from 'vitest';
import { createDurableJeopardyFixture } from '../../../../tests/_lib/createDurableJeopardyFixture.mjs';
import { VerifiedSessionCache } from './verifiedSessionCache.mjs';
const fixtures=[];afterEach(()=>{vi.restoreAllMocks();for(const f of fixtures.splice(0))f.dispose();});
const host={role:'host'};
async function game(){const f=await createDurableJeopardyFixture();fixtures.push(f);const s=await f.application.createSession({definitionId:'jeopardy:test',seats:[{id:'blue'},{id:'gold'}],viewer:host});return{...f,id:s.header.session_id};}
const envelope=(revision=0,id='cmd:one')=>({command_id:id,actor_id:'host',expected_revision:revision,logical_time:revision+1,command:{type:'BUZZER_SETUP',epoch:id}});
it('verifies once then skips full journal, checkpoint and runtime replay for warm requests',async()=>{
 const f=await game(),cold=f.restart();await cold.coordinator.resume(f.id,host);
 const replay=vi.spyOn(cold.runtime,'dispatch'),read=vi.spyOn(cold.journal,'read'),get=vi.spyOn(cold.snapshots,'get');
 await cold.coordinator.resume(f.id,host);expect(replay).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
 await cold.coordinator.dispatch(f.id,envelope(),host);expect(replay).toHaveBeenCalledTimes(1);
 await cold.coordinator.resume(f.id,host);expect(replay).toHaveBeenCalledTimes(1);expect(read).not.toHaveBeenCalled();
});
it('rechecks authorization and never exposes mutable cached state',async()=>{
 const f=await game();const first=await f.coordinator.resume(f.id,host);first.state.phase='tampered';first.definition.rounds=[];
 expect((await f.coordinator.resume(f.id,host)).state.phase).toBe('round-intro');
 expect((await f.coordinator.resume(f.id,host)).definition.rounds.length).toBeGreaterThan(0);
 await expect(f.coordinator.resume(f.id,{role:'participant',participant_id:'intruder'})).rejects.toMatchObject({code:'authorization_denied'});
});
it('recovers a committed append after checkpoint failure and retries an exact envelope once',async()=>{
 const f=await game(),command=envelope();vi.spyOn(f.snapshots,'put').mockRejectedValueOnce(new Error('disk unavailable'));
 await expect(f.coordinator.dispatch(f.id,command,host)).rejects.toThrow('disk unavailable');
 const restarted=f.restart(),result=await restarted.coordinator.dispatch(f.id,command,host);
 expect(result.duplicate).toBe(true);expect(result.header.revision).toBe(1);expect(await restarted.journal.read(f.id)).toHaveLength(2);
});
it('invalidates warm state after a same-size journal edit and fails closed',async()=>{
 const f=await game();await f.coordinator.dispatch(f.id,envelope(),host);await f.coordinator.resume(f.id,host);
 const file=path.join(f.root,'journals',f.id+'.jsonl'),text=fs.readFileSync(file,'utf8');fs.writeFileSync(file,text.replace('cmd:one','cmd:bad'));
 await expect(f.coordinator.resume(f.id,host)).rejects.toMatchObject({code:'journal_corrupt'});
});
it('reconstructs a missing checkpoint without losing command receipts',async()=>{
 const f=await game();await f.coordinator.dispatch(f.id,envelope(),host);fs.unlinkSync(path.join(f.root,'snapshots',f.id+'.json'));
 const recovered=await f.coordinator.resume(f.id,host);expect(recovered.header.revision).toBe(1);
 expect((await f.coordinator.dispatch(f.id,envelope(),host)).duplicate).toBe(true);
});
it('serializes same-session concurrent writes and releases its lane after rejection',async()=>{
 const f=await game();const results=await Promise.allSettled([f.coordinator.dispatch(f.id,envelope(0,'cmd:a'),host),f.coordinator.dispatch(f.id,envelope(0,'cmd:b'),host)]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.find(x=>x.status==='rejected').reason.code).toBe('revision_conflict');
 expect((await f.coordinator.dispatch(f.id,envelope(1,'cmd:c'),host)).header.revision).toBe(2);
});
it('uses bounded LRU entries isolated from caller mutation',()=>{
 const cache=new VerifiedSessionCache({maxEntries:2}),entry=id=>({session:{header:{session_id:id}},definition:{},journalVersion:'j',snapshotVersion:'s'});
 cache.set('a',entry('a'));cache.set('b',entry('b'));cache.get('a',{journalVersion:'j',snapshotVersion:'s'});cache.set('c',entry('c'));
 expect(cache.get('b',{journalVersion:'j',snapshotVersion:'s'})).toBeNull();expect(cache.get('a',{journalVersion:'wrong',snapshotVersion:'s'})).toBeNull();
});
it('metrics cannot throw through an accepted operation',async()=>{
 const f=await game();f.coordinator.onOperation=()=>{throw new Error('logging down');};
 expect((await f.coordinator.dispatch(f.id,envelope(),host)).header.revision).toBe(1);
});
it('rejects external history changes across a recovery yield before publishing a checkpoint',async()=>{
 const f=await game();for(let n=0;n<33;n++)await f.coordinator.dispatch(f.id,envelope(n,`cmd:${n}`),host);
 const cold=f.restart();let changed=false;cold.coordinator.yieldControl=async()=>{if(!changed){changed=true;await f.coordinator.dispatch(f.id,envelope(33,'cmd:external'),host);}};
 await expect(cold.coordinator.resume(f.id,host)).rejects.toMatchObject({code:'revision_conflict'});
 expect((await cold.snapshots.get(f.id)).header.revision).toBe(34);
 expect((await cold.coordinator.resume(f.id,host)).header.revision).toBe(34);
});
it('repairs an externally changed checkpoint only after replaying intact history',async()=>{
 const f=await game();await f.coordinator.dispatch(f.id,envelope(),host);
 const file=path.join(f.root,'snapshots',f.id+'.json'),value=JSON.parse(fs.readFileSync(file,'utf8'));value.state.phase='tampered';fs.writeFileSync(file,JSON.stringify(value));
 const replay=vi.spyOn(f.runtime,'dispatch');expect((await f.coordinator.resume(f.id,host)).state.phase).toBe('round-intro');expect(replay).toHaveBeenCalledTimes(1);
});
it('bypasses caching when either port has no version capability',async()=>{
 const f=await game();f.journal.getVersion=undefined;await f.coordinator.resume(f.id,host);const replay=vi.spyOn(f.runtime,'dispatch');
 await f.coordinator.dispatch(f.id,envelope(),host);await f.coordinator.resume(f.id,host);expect(replay).toHaveBeenCalledTimes(2);
});
it('retains retryability after append failure and reports bounded operation measurements',async()=>{
 const f=await game(),metrics=[];let ticks=0;f.coordinator.measureNow=()=>++ticks;f.coordinator.onOperation=metric=>metrics.push(metric);
 vi.spyOn(f.journal,'append').mockRejectedValueOnce(new Error('write failed'));
 await expect(f.coordinator.dispatch(f.id,envelope(),host)).rejects.toThrow('write failed');
 expect((await f.coordinator.dispatch(f.id,envelope(),host)).header.revision).toBe(1);
 expect(metrics.at(-1)).toMatchObject({operation:'dispatch',sessionId:f.id,revision:1,replayedCommands:0});
 expect(metrics.at(-1).durations.totalMs).toBeGreaterThan(0);expect(JSON.stringify(metrics)).not.toContain('clue');
});
it('gives concurrent independent coordinators one durable winner',async()=>{
 const f=await game(),other=f.restart();await other.coordinator.resume(f.id,host);
 const results=await Promise.allSettled([f.coordinator.dispatch(f.id,envelope(0,'cmd:writer-a'),host),other.coordinator.dispatch(f.id,envelope(0,'cmd:writer-b'),host)]);
 expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 expect(results.find(x=>x.status==='rejected').reason.code).toBe('revision_conflict');
 const check=f.restart();expect((await check.coordinator.resume(f.id,host)).header.revision).toBe(1);expect(await check.journal.read(f.id)).toHaveLength(2);
});
it('keeps verified current state warm when a stale or unauthorized action is rejected before persistence',async()=>{
 const f=await game();await f.coordinator.dispatch(f.id,envelope(),host);const read=vi.spyOn(f.journal,'read');
 await expect(f.coordinator.dispatch(f.id,envelope(0,'cmd:stale'),host)).rejects.toMatchObject({code:'revision_conflict'});
 await expect(f.coordinator.resume(f.id,{role:'participant',participant_id:'intruder'})).rejects.toMatchObject({code:'authorization_denied'});
 expect((await f.coordinator.resume(f.id,host)).header.revision).toBe(1);expect(read).not.toHaveBeenCalled();
});
