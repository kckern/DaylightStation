import { describe, expect, it, vi } from 'vitest';
import { defineRuleModule, GameRuntime, GameSessionCoordinator, SessionActorAuthorization } from './index.mjs';
import { MemorySessionJournal, MemorySnapshotRepository } from '../testing/memoryPorts.mjs';

const rules = defineRuleModule({id:'counter',version:1,validateDefinition:()=>({valid:true,errors:[]}),createInitialState:(_definition,{setup})=>({status:'active',value:setup.value}),handleCommand:()=>({error:{code:'illegal_command',message:'no'}}),project:state=>({state})});
function fixture() {
 const snapshots=new MemorySnapshotRepository(), journal=new MemorySessionJournal();
 const pinned={hash:'a'.repeat(64),definition:{maximum:10},artifacts:{rules_definition:{id:'counter',hash:'b'.repeat(64)}}};
 const definitions={getCurrent:vi.fn(),pin:vi.fn(),getPinned:vi.fn(async()=>pinned.definition)};
 const coordinator=new GameSessionCoordinator({runtime:new GameRuntime({rulesets:[rules]}),snapshots,journal,definitions,ids:{session:()=> 'ordinary',seed:()=>1},clock:{now:()=>new Date('2026-01-01')},authorization:new SessionActorAuthorization()});
 const reservation={sessionId:'reserved:1',seed:7,pinnedDefinition:pinned,ruleset:{id:'counter',version:1},experience:null,launch:null,participants:[{id:'p1'}],seats:[],setup:{value:3},creationKey:'private'};
 return {coordinator,snapshots,journal,definitions,reservation};
}
const viewer={role:'host'};
describe('reserved creation',()=>{
 it('serializes simultaneous retries and rejects changed frozen inputs',async()=>{
  const {coordinator,journal,reservation,definitions}=fixture();
  const results=await Promise.all([coordinator.createReserved({reservation,viewer}),coordinator.createReserved({reservation,viewer})]);
  expect(results.map(x=>x.created)).toEqual([true,false]);
  expect((await journal.read(reservation.sessionId))).toHaveLength(1);
  expect(JSON.stringify(results)).not.toContain('private');
  expect(definitions.getCurrent).not.toHaveBeenCalled();
  await expect(coordinator.createReserved({reservation:{...reservation,setup:{value:4}},viewer})).rejects.toMatchObject({code:'creation_conflict'});
  await expect(coordinator.createReserved({reservation:{...reservation,creationKey:'other'},viewer})).rejects.toMatchObject({code:'creation_conflict'});
  await expect(coordinator.createReserved({reservation,viewer:{}})).rejects.toMatchObject({code:'authorization_denied'});
 });
 it('recovers the journal after a failed initial snapshot without creating again',async()=>{
  const {coordinator,snapshots,journal,reservation}=fixture();
  const put=snapshots.put.bind(snapshots); snapshots.put=vi.fn().mockRejectedValueOnce(new Error('interrupted')).mockImplementation(put);
  await expect(coordinator.createReserved({reservation,viewer})).rejects.toThrow('interrupted');
  const retry=await coordinator.createReserved({reservation,viewer});
  expect(retry.created).toBe(false); expect(retry.view.state.value).toBe(3);
  expect(await snapshots.get(reservation.sessionId)).toBeTruthy(); expect(await journal.read(reservation.sessionId)).toHaveLength(1);
 });
});

it('retries the same reserved creation after a failure before the journal write',async()=>{
 const {coordinator,journal,reservation}=fixture();
 const create=journal.create.bind(journal);journal.create=vi.fn().mockRejectedValueOnce(Error('before journal')).mockImplementation(create);
 await expect(coordinator.createReserved({reservation,viewer})).rejects.toThrow('before journal');
 expect(await journal.read(reservation.sessionId)).toHaveLength(0);
 const recovered=await coordinator.createReserved({reservation,viewer});
 expect(recovered.view.state.value).toBe(3);expect(await journal.read(reservation.sessionId)).toHaveLength(1);
});
it('journals frozen participant creation evidence and rejects changed evidence on retry',async()=>{
 const {coordinator,journal,reservation}=fixture();
 const evidence={schema:'participant-execution-evidence/v1',snapshot:{participant_context:{participants:[{key:'frozen'}]}},metadata:{schema:'participant-execution-metadata/v1',source_ref:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'opaque'},return_to:{kind:'content',content_id:'agenda:family/plans/old',item_uid:'item'}}};
 const frozen={...reservation,participantEvidence:evidence};
 await coordinator.createReserved({reservation:frozen,viewer});
 expect((await journal.read(reservation.sessionId))[0].participant_evidence).toEqual(evidence);
 await expect(coordinator.createReserved({reservation:{...frozen,participantEvidence:{...evidence,metadata:{...evidence.metadata,return_to:{kind:'content',content_id:'agenda:family/plans/new'}}}},viewer})).rejects.toMatchObject({code:'creation_conflict'});
});
