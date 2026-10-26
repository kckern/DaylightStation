// @vitest-environment node
import {afterEach,it,expect} from 'vitest';
import {pathToFileURL} from 'node:url';
import {createLatencyFixture,verifyFrozenSession,percentile,measureOperation} from '../../_lib/gamingLatencyFixtures.mjs';
const fixtures=[];afterEach(()=>{for(const f of fixtures.splice(0))f.dispose();});
const host={role:'host'};
it.each(['legacy305','counter1000'])('bounds real durable warm reads/writes without replay: %s',async kind=>{
 const f=await createLatencyFixture(kind);fixtures.push(f);
 if(process.env.GAMING_BASELINE_ROOT){const {GameSessionCoordinator}=await import(pathToFileURL(process.env.GAMING_BASELINE_ROOT+'/__capabilities/gaming/portable/kernel/coordinator.mjs').href);const current=f.coordinator;f.coordinator=new GameSessionCoordinator({runtime:f.runtime,snapshots:f.snapshots,journal:f.journal,definitions:f.definitions,ids:f.ids,clock:current.clock,authorization:current.authorization});}
 const cold=await measureOperation(()=>f.coordinator.resume(f.sessionId,host));if(f.frozen)await verifyFrozenSession(f);
 const before={...f.observation.counts};await f.coordinator.resume(f.sessionId,host);
 expect(f.observation.counts.runtimeDispatch-before.runtimeDispatch).toBe(0);expect(f.observation.counts.journalRead-before.journalRead).toBe(0);expect(f.observation.counts.snapshotGet-before.snapshotGet).toBe(0);
 const reads=[],writes=[];let current=await f.coordinator.resume(f.sessionId,host);
 for(let n=0;n<30;n++)reads.push(await measureOperation(()=>f.coordinator.resume(f.sessionId,host)));
 for(let n=0;n<30;n++)writes.push(await measureOperation(async()=>{current=await f.coordinator.dispatch(f.sessionId,{command_id:`cmd:perf:${n}`,actor_id:'host',expected_revision:current.header.revision,logical_time:100000+n,command:kind==='counter1000'?{type:'counter.add'}:{type:'BUZZER_PRESENCE',epoch:'baseline'}},host);}));
 expect(percentile(reads,.95)).toBeLessThanOrEqual(50);expect(percentile(writes,.95)).toBeLessThanOrEqual(150);
 expect(f.observation.counts.runtimeDispatch-before.runtimeDispatch).toBe(30);expect(f.observation.counts.journalRead-before.journalRead).toBe(0);
 const restarted=f.restart();expect((await restarted.coordinator.resume(f.sessionId,host)).header.revision).toBe(current.header.revision);
 if(kind==='counter1000')expect(current.state.count).toBe(1030);
 console.log(JSON.stringify({kind,node:process.version,coldMs:cold,readP95:percentile(reads,.95),writeP95:percentile(writes,.95),warmReads:reads.length,warmWrites:writes.length}));
});
