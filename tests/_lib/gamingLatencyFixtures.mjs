import fs from 'node:fs';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {defineRuleModule,stableHash,canonicalStringify} from '../../__capabilities/gaming/portable/kernel/index.mjs';
import {jeopardyRuleModule} from '../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
import {createDurableGamingFixture} from './createDurableGamingFixture.mjs';
const counter=defineRuleModule({id:'latency-counter',version:1,validateDefinition:()=>({valid:true,errors:[]}),createInitialState:()=>({status:'active',count:0}),handleCommand:(state,command)=>command.type==='counter.add'?{state:{...state,count:state.count+1},events:[{type:'counter.added',amount:1}]}:{error:{code:'illegal_command',message:'counter.add required'}},project:state=>({state})});
const manifest=id=>({id,version:1,hash:'b'.repeat(64),setup:{kind:'none'},surfaces:[{id:'party-games',presenter:'latency-test',authority_modes:['remote']}]});
export function observeAuthority(fixture){
 const metrics=[],counts={runtimeDispatch:0,journalRead:0,snapshotGet:0};
 for(const [object,key,count]of [[fixture.runtime,'dispatch','runtimeDispatch'],[fixture.journal,'read','journalRead'],[fixture.snapshots,'get','snapshotGet']]){const original=object[key].bind(object);object[key]=(...args)=>{counts[count]++;return original(...args);};}
 fixture.coordinator.onOperation=metric=>{metrics.push(metric);if(metrics.length>200)metrics.shift();};
 return{metrics,counts};
}
export async function createLatencyFixture(kind){
 if(kind==='legacy305'){
  const frozen=JSON.parse(fs.readFileSync(new URL('../_fixtures/group-play/jeopardy-durable/legacy-305.json',import.meta.url),'utf8'));
  // Keep the frozen journal/checksums intact while keeping each source fixture below the public-tree size gate.
  frozen.records.push(...JSON.parse(fs.readFileSync(new URL('../_fixtures/group-play/jeopardy-durable/legacy-305-continuation.json',import.meta.url),'utf8')));
  const id=frozen.parts.rules.artifact.id,f=await createDurableGamingFixture({definition:frozen.definition,definitionId:id,rulesets:[jeopardyRuleModule],manifest:manifest('jeopardy')});
  const pinned=await f.definitions.pin(await f.definitions.getCurrent(id));if(pinned.hash!==frozen.records[0].header.ruleset.definition_hash)throw Error('Baseline artifact identity changed');
  const sessionId=frozen.records[0].header.session_id;await f.journal.create(sessionId,frozen.records[0]);for(const record of frozen.records.slice(1))await f.journal.append(sessionId,record,{expectedRevision:record.revision-1});
  return{...f,sessionId,frozen,observation:observeAuthority(f)};
 }
 if(kind!=='counter1000')throw Error('Unknown latency fixture');
 const id='latency:counter',definition={rule_module:{id:counter.id,version:1},experience:{id:counter.id,version:1},maximum:100000};
 const f=await createDurableGamingFixture({definition,definitionId:id,rulesets:[counter],manifest:manifest(counter.id)});
 const steps=Array.from({length:1000},(_,n)=>({actor_id:'host',logical_time:n+1,command:{type:'counter.add'}}));
 const created=await f.coordinator.createWithHistory({ruleset:definition.rule_module,definitionId:id,viewer:{role:'host'}},steps);
 const restarted=f.restart();return{...f,...restarted,sessionId:created.header.session_id,observation:observeAuthority(restarted)};
}
export async function verifyFrozenSession(fixture){
 const session=await fixture.snapshots.get(fixture.sessionId),sha256=crypto.createHash('sha256').update(canonicalStringify(session)).digest('hex');
 if(stableHash(session)!==fixture.frozen.expected.sessionHash||sha256!==fixture.frozen.expected.sessionSha256)throw Error('Legacy history diverged');
 return sha256;
}
export const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)];
export async function measureOperation(operation){const start=performance.now();await operation();return performance.now()-start;}
