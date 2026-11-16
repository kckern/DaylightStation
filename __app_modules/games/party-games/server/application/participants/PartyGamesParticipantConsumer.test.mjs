import { describe, it, expect, vi } from 'vitest';
import { createParticipantContext } from '../../../../../../__capabilities/household-identity/portable/participants.mjs';
import { PartyGamesParticipantConsumer } from './PartyGamesParticipantConsumer.mjs';

const target = { definitionId: 'charades:test', surfaceId: 'party-games' };
const roster = [
  {key:'a',participant_id:'alex',identity:{kind:'user',id:'alex'},display:{name:'Alex',avatar:{kind:'user-avatar',userId:'alex'}}},
  {key:'b',participant_id:'guest:visitor',identity:{kind:'guest',id:'visitor'},display:{name:'Visitor',avatar:{kind:'user-avatar',userId:'visitor'}}},
  {key:'c',participant_id:'anon:plan:slot',identity:{kind:'anonymous',scope_id:'plan',slot_id:'slot'},display:{name:'Guest',avatar:null}},
];
const definition = {experience:{id:'charades',version:1},rule_module:{id:'activity-party',version:1},competition:false,rounds:1,clues_per_turn:1,presentation:{image_participants:[]},challenges:[{id:'t',prompt:'word'},{id:'r',category:'early-reader',prompt:'run'},{id:'i',decoder:{image:'x'},prompt:'image'}]};
const loaded = {definition,hash:'a'.repeat(64),artifacts:{rules_definition:{id:target.definitionId,hash:'b'.repeat(64)},content_pack:{id:target.definitionId,hash:'c'.repeat(64)}}};
const manifest = {id:'charades',version:1,hash:'d'.repeat(64),surfaces:[{id:'party-games',authority_modes:['remote']}]};
const settings = {schema:'party-games-participant-setup/v1',autostart:false,charades:{default_clue_mode:'text',clue_modes:{b:'reader',c:'image'}}};
async function fixture(participants=roster, override={}) {
 const context=await createParticipantContext({scope:{provider:'agenda',id:'plan',revision:1},participants});
 const definitions={getCurrent:vi.fn(async()=>structuredClone(loaded)),pin:vi.fn(async x=>x)};
 const executionPort={createReserved:vi.fn(async ({sessionId})=>({header:{session_id:sessionId}})),resume:vi.fn(async()=>({header:{status:'active'}}))};
 const consumer=new PartyGamesParticipantConsumer({definitions,executionPort,manifestStore:{get:()=>structuredClone(manifest)},clueHistory:{list:vi.fn(async()=>[{clue_id:'t'}])},...override});
 return {context,definitions,executionPort,consumer};
}
describe('Party Games participant consumer',()=>{
 it('prepares display snapshots and modes without archiving; retains the exact inspected artifact',async()=>{
  const {consumer,context,definitions}=await fixture();
  const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
  expect(prepared.preview).toEqual({schema:'party-games-preview/v2',data:{participants:[{name:'Alex',avatar:{kind:'user-avatar',userId:'alex'},clue_mode:'text'},{name:'Visitor',avatar:{kind:'user-avatar',userId:'visitor'},clue_mode:'reader'},{name:'Guest',avatar:null,clue_mode:'image'}]}});
  expect(prepared.setup.data.seats.map(x=>x.id)).toEqual(['alex','guest:visitor','anon:plan:slot']);
  expect(prepared.setup.data.seats[1].members[0]).toMatchObject({id:'guest:visitor',name:'Visitor',avatar:{kind:'user-avatar',userId:'visitor'}});
  expect(prepared.setup.data.setup.charades_presentation.by_participant).toEqual({alex:'text','guest:visitor':'reader','anon:plan:slot':'image'});
  expect(prepared.setup.data.setup.charades_history_ids).toEqual(['t']);
  expect(definitions.pin).not.toHaveBeenCalled();
  await consumer.retainPrepared({prepared,viewer:{role:'host'}}); expect(definitions.pin).toHaveBeenCalledOnce();
 });
 it('honors selected order and rejects empty, unknown and missing pools without household fallback',async()=>{
  const {consumer}=await fixture(); const context=(await fixture([roster[2],roster[0]])).context;
  const selected={...settings,charades:{default_clue_mode:'text',clue_modes:{c:'image'}}};
  const prepared=await consumer.prepareSetup({target,settings:selected,participantContext:context,viewer:{role:'host'}});
  expect(prepared.setup.data.seats.map(x=>x.id)).toEqual(['anon:plan:slot','alex']);
  await expect(consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}})).rejects.toThrow(/unknown/i);
  await expect(consumer.prepareSetup({target,settings:selected,participantContext:(await fixture([])).context,viewer:{role:'host'}})).rejects.toThrow();
  const missing=await fixture(roster,{definitions:{getCurrent:async()=>({...loaded,definition:{...definition,challenges:[]}})}});
  await expect(missing.consumer.prepareSetup({target,settings,participantContext:missing.context,viewer:{role:'host'}})).rejects.toThrow(/pool/i);
 });
 it('derives a reserved ID and seed, and does not recreate a missing resumed runtime',async()=>{
  const {consumer,context,executionPort}=await fixture(); const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
  const snapshot={launch_id:'launch',consumer:{id:'party-games',version:1},snapshot_hash:'hash',participant_context:context,target,prepared};
  const result=await consumer.begin({snapshot,executionKey:'secret',viewer:{role:'host'}});
  expect(result.output.data.definition_id).toBe(target.definitionId); expect(result.runtime_ref.id).toBe('game:pl:fa7f2aea91d8eb4e29bdd8695f591bf43c223641c3c08c8dfb95e691669fe23f');
  expect(executionPort.createReserved).toHaveBeenCalledWith(expect.objectContaining({sessionId:result.runtime_ref.id,seed:3544280011,creationKey:'secret'}));
  executionPort.resume.mockResolvedValue(null);
  await expect(consumer.resume({snapshot,receipt:{runtime_ref:result.runtime_ref},viewer:{role:'host'}})).rejects.toMatchObject({code:'runtime_unavailable'});
  expect(executionPort.createReserved).toHaveBeenCalledOnce();
 });
 it('remaps only owned keys and drops deleted entries',async()=>{
  const {consumer}=await fixture(); expect(consumer.remapParticipantKeys({settings,keyMap:{b:'new',c:null}}).charades.clue_modes).toEqual({new:'reader'});
 });
});

it('rejects changed artifacts before retention and does not permit untrusted creators',async()=>{
 const {consumer,context,definitions}=await fixture();
 const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
 definitions.getCurrent.mockResolvedValue({...loaded,hash:'d'.repeat(64)});
 await expect(consumer.retainPrepared({prepared,viewer:{role:'host'}})).rejects.toMatchObject({code:'prepared_artifact_unavailable'});
 expect(definitions.pin).not.toHaveBeenCalled();
 await expect(consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'participant',participant_id:'alex'}})).rejects.toMatchObject({code:'authorization_denied'});
});

it('reports unavailable when an inspected image can no longer be retained',async()=>{
 const {consumer,context,definitions}=await fixture();
 const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
 definitions.pin.mockRejectedValue(new Error('Clue image changed'));
 await expect(consumer.retainPrepared({prepared,viewer:{role:'host'}})).rejects.toMatchObject({code:'prepared_artifact_unavailable'});
});

it('reports unavailable without pinning when rereading the inspected definition fails',async()=>{
 const {consumer,context,definitions}=await fixture();
 const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
 const cause=new Error('content artifact charades:test is required');
 definitions.getCurrent.mockRejectedValue(cause);
 await expect(consumer.retainPrepared({prepared,viewer:{role:'host'}})).rejects.toMatchObject({code:'prepared_artifact_unavailable',cause});
 expect(definitions.pin).not.toHaveBeenCalled();
});

it('freezes the inspected manifest and rejects changes before retention',async()=>{
 let current=structuredClone(manifest);
 const {consumer,context}=await fixture(roster,{manifestStore:{get:()=>current}});
 const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
 expect(prepared.setup.data.pinnedArtifacts.manifest).toEqual(manifest);
 current={...current,hash:'e'.repeat(64)};
 await expect(consumer.retainPrepared({prepared,viewer:{role:'host'}})).rejects.toMatchObject({code:'prepared_artifact_unavailable'});
});

it('discovers resumable games only through a read-only port and fails closed when absent',async()=>{
 const {consumer,executionPort}=await fixture();
 const receipts=[{launch_id:'launch',runtime_ref:{provider:'gaming',id:'game:one'}}];
 await expect(consumer.findResumable({receipts,viewer:{role:'host'}})).rejects.toMatchObject({code:'participant_discovery_unavailable'});
 expect(executionPort.resume).not.toHaveBeenCalled();
 executionPort.inspect=vi.fn(async()=>({header:{status:'active'}}));
 expect(await consumer.findResumable({receipts,viewer:{role:'host'}})).toEqual([{launch_id:'launch',runtime_ref:{provider:'gaming',id:'game:one'},label:'Resume game'}]);
 expect(executionPort.inspect).toHaveBeenCalledOnce();expect(executionPort.resume).not.toHaveBeenCalled();
 executionPort.inspect.mockResolvedValue({header:{status:'complete'}});
 expect(await consumer.findResumable({receipts,viewer:{role:'host'}})).toEqual([{launch_id:'launch',runtime_ref:{provider:'gaming',id:'game:one'},label:'View result'}]);
});
it('rejects incomplete settings at publication preparation',async()=>{
 const {consumer,context}=await fixture();
 await expect(consumer.prepareSetup({target,settings:{},participantContext:context,viewer:{role:'host'}})).rejects.toMatchObject({code:'invalid_session_setup'});
});
it('remaps incomplete consumer settings safely and reports malformed fields',async()=>{
 const {consumer}=await fixture();expect(consumer.remapParticipantKeys({settings:{},keyMap:{a:null}})).toEqual({});
 expect(()=>consumer.remapParticipantKeys({settings:{charades:{clue_modes:null}},keyMap:{a:null}})).toThrow(expect.objectContaining({code:'invalid_session_setup',field:'settings.charades.clue_modes'}));
});
it('rejects publication of a structurally valid draft with incomplete consumer settings',async()=>{
 const {AgendaPlanningService,AgendaParticipantContextProvider,createAgendaActivityValidator}=await import('../../../../../household/agenda/server/agenda.mjs');
 const {ParticipantConsumerRegistry,ParticipantSetupResolver}=await import('../../../../../../__capabilities/content-catalog/server/participant-launch.mjs');
 const {consumer}=await fixture();const registry=new ParticipantConsumerRegistry();registry.register({consumer});
 const resolved={...target,kind:'app',appId:'party-games',participantConsumer:{id:'party-games',version:1}};
 const provider=new AgendaParticipantContextProvider({repository:{},store:{},codec:{},clock:()=>new Date('2026-11-17T00:00:00Z'),directory:{resolve:async()=>null},authorize:async()=>true,resolveTarget:async()=>resolved});
 const validateActivities=createAgendaActivityValidator({provider,setupResolver:new ParticipantSetupResolver({registry})});
 const plan={schema:'agenda-plan/v1',plan_id:'plan',series_id:'series',household_id:'home',revision:1,week_of:'2026-11-16',scheduled_on:'2026-11-16',calendar:{timezone:'UTC',week_starts_on:'monday'},state:'draft',seeded_from:{kind:'series',id:'series',revision:1},title:'Together',participants:[{id:'p',anonymous:true,display:{name:'Guest',avatar:null}}],list:{sections:[{uid:'s',items:[{uid:'i',title:'Game',open:'party-games/charades:test'}]}]},activity_settings:{i:{schema:'agenda-activity-setup/v1',action:'open',participants:{mode:'plan'},consumer:{id:'party-games',version:1},settings:{}}}};
 let stored=structuredClone(plan);const repository={mutatePlan:async({mutate})=>{const next=await mutate(structuredClone(stored));stored=next;return {document:next,etag:'"next"'};}};
 const planning=new AgendaPlanningService({repository,clock:()=>new Date('2026-11-17T00:00:00Z'),ids:{},validateActivities,logger:{info(){}}});
 expect(planning.validatePlanDocument(plan).valid).toBe(true);
 await expect(planning.publishPlan({householdId:'home',planId:'plan',expectedEtag:'"one"',viewer:{role:'host'}})).rejects.toMatchObject({code:'invalid_agenda',errors:[expect.objectContaining({code:'invalid_session_setup'})]});
 expect(stored.state).toBe('draft');
});
it('passes frozen snapshot and retained source metadata to reserved creation',async()=>{
 const {consumer,context,executionPort}=await fixture();
 const prepared=await consumer.prepareSetup({target,settings,participantContext:context,viewer:{role:'host'}});
 const snapshot={launch_id:'launch',consumer:{id:'party-games',version:1},snapshot_hash:'hash',participant_context:context,target,prepared};
 const executionMetadata={schema:'participant-execution-metadata/v1',source_ref:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'opaque'},return_to:{kind:'content',content_id:'agenda:s/plans/p',item_uid:'item'}};
 await consumer.begin({snapshot,executionKey:'key',executionMetadata,viewer:{role:'host'}});
 expect(executionPort.createReserved.mock.calls[0][0].participantEvidence).toEqual({schema:'participant-execution-evidence/v1',snapshot,metadata:executionMetadata});
});
it('threads retained source through service, real consumer and Gaming journal on creation recovery',async()=>{
 const {ParticipantLaunchService,ParticipantConsumerRegistry,hashValue}=await import('../../../../../../__capabilities/content-catalog/server/participant-launch.mjs');
 const {GameSessionCoordinator,GameRuntime,defineRuleModule,SessionActorAuthorization}=await import('../../../../../../__capabilities/gaming/portable/kernel/index.mjs');
 const {createGamingSessionRuntime}=await import('../../../../../../__capabilities/gaming/server/composition/session-runtime.mjs');
 const {mkdtempSync,readdirSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const dir=mkdtempSync(path.join(tmpdir(),'participant-inspect-'));
 try {
 const {GamingApplication}=await import('../runtime/GamingApplication.mjs');
 const rules=defineRuleModule({id:'activity-party',version:1,validateDefinition:()=>({valid:true,errors:[]}),createInitialState:(_d,{setup})=>({status:'active',saved:setup.charades_presentation}),handleCommand:()=>({error:{code:'invalid',message:'invalid'}}),project:state=>({state})});
 const definitions={getCurrent:vi.fn(async()=>structuredClone(loaded)),pin:vi.fn(async value=>value),getPinned:vi.fn(async()=>structuredClone(definition))};
 const gamingRuntime=createGamingSessionRuntime({definitions,snapshotsDir:path.join(dir,'snapshots'),journalsDir:path.join(dir,'journals'),rulesets:[rules],createIds:()=>({session:()=>'',seed:()=>1}),clock:{now:()=>new Date('2026-01-01')}});
 const {coordinator,journal,snapshots}=gamingRuntime;
 const put=snapshots.put.bind(snapshots);snapshots.put=vi.fn().mockRejectedValueOnce(Error('snapshot interrupted')).mockImplementation(put);
 const app=new GamingApplication({coordinator,definitions,manifestStore:{get:()=>manifest}});
 const {createPartyGamesParticipantConsumer}=await import('../../participants.mjs');
 const consumer=createPartyGamesParticipantConsumer({definitions,manifestStore:{get:()=>structuredClone(manifest)},gamingApplication:app,clueHistory:{list:async()=>[]}});
 const canonicalTarget={...target,kind:'app',appId:'party-games',participantConsumer:{id:'party-games',version:1}};
 const source={scope:{provider:'agenda',id:'plan',revision:1},roster,selector:{schema:'participant-selector/v1',mode:'explicit',keys:['c','b']},action:'open',target:canonicalTarget,consumer:{id:'party-games',version:1},settings,sourceLabel:'Week of 2026-11-16',returnTo:{kind:'content',content_id:'agenda:s/plans/p',item_uid:'i'}};
 let record, live=true;
 const store={inspect:async(_scope,build)=>build([]),reserve:async(_request,build)=>{if(!record){const built=await build([]);const base={...built.snapshot,launch_id:'launch'};record={snapshot:{...base,snapshot_hash:hashValue(base)},provenance:built.provenance};}return {kind:'reserved',snapshot:record.snapshot,executionKey:'key'};},readRetained:async()=>({snapshot:record.snapshot,receipt:{launch_id:'launch',snapshot_hash:record.snapshot.snapshot_hash,result:record.result},return_to:record.provenance.return_to,execution_metadata:record.provenance.execution_metadata}),complete:async({result})=>(record.result=result)};
 const registry=new ParticipantConsumerRegistry(); registry.register({consumer});
 const service=new ParticipantLaunchService({registry,providers:[{id:'agenda',authorizeAccess:async()=>({store,scope_key:'scope'}),resolve:async()=>{if(!live)throw Error('source changed');return source;}}],resolveDirectTarget:async()=>canonicalTarget,logger:{info(){}}});
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'opaque'}, input={ref,action:'open',intent:'new',requestId:'same',viewer:{role:'host'}};
 const inspect=await service.inspect({...input});input.expectedSetupHash=inspect.setup_hash;
 await expect(service.begin(input)).rejects.toThrow('snapshot interrupted');
 const journalFile=readdirSync(path.join(dir,'journals'))[0];const before=readFileSync(path.join(dir,'journals',journalFile),'utf8');
 const sessionId=journalFile.slice(0,-6);
 store.inspect=async(_scope,build)=>build([{launch_id:'launch',consumer:{id:'party-games',version:1},runtime_ref:{provider:'gaming',id:sessionId}}]);
 snapshots.put.mockClear();
 await service.inspect(input);
 expect(snapshots.put).not.toHaveBeenCalled();
 expect(await snapshots.get(sessionId)).toBeNull();expect(readdirSync(path.join(dir,'snapshots'))).toEqual([]);expect(readFileSync(path.join(dir,'journals',journalFile),'utf8')).toBe(before);
 live=false;
 const result=await service.begin(input); const saved=(await journal.read(result.runtime_ref.id))[0];
 expect(saved.header.launch.participant_launch).toMatchObject({launch_id:'launch',snapshot_hash:result.snapshot_hash,source_ref:ref,source_label:'Week of 2026-11-16',return_to:source.returnTo});
 expect(saved.participant_evidence.snapshot.participant_context.participants.map(p=>p.participant_id)).toEqual(['anon:plan:slot','guest:visitor']);
 expect(saved.setup.charades_presentation.by_participant).toEqual({'anon:plan:slot':'image','guest:visitor':'reader'});
 expect((await journal.read(result.runtime_ref.id))).toHaveLength(1);
 source.sourceLabel='Week of 2026-11-23';
 const [savedChoice]=await consumer.findResumable({receipts:[{launch_id:result.launch_id,runtime_ref:result.runtime_ref}],viewer:{role:'host'}});
 expect(savedChoice.label).toBe('Resume game — Week of 2026-11-16 — Guest, Visitor');
 } finally {rmSync(dir,{recursive:true,force:true});}
});
it('labels a saved game with its saved roster',async()=>{
 const {consumer}=await fixture(); consumer.executionPort.inspect=async()=>({header:{status:'active',launch:{participant_launch:{source_label:'Week of 2026-11-16'}},participants:[{name:'Saved guest'},{name:'Saved player'}]}});
 const [choice]=await consumer.findResumable({receipts:[{launch_id:'l',runtime_ref:{provider:'gaming',id:'game:one'}}],viewer:{role:'host'}});
 expect(choice.label).toBe('Resume game — Week of 2026-11-16 — Saved guest, Saved player');
});

it('installs the read-only Gaming discovery port', async () => {
 const {createPartyGamesParticipantConsumer}=await import('../../participants.mjs');
 const gamingApplication={inspectSession:vi.fn(),resumeSession:vi.fn(),createReserved:vi.fn()};
 const consumer=createPartyGamesParticipantConsumer({definitions:{},manifestStore:{},gamingApplication});
 await consumer.executionPort.inspect('session',{role:'host'});
 expect(gamingApplication.inspectSession).toHaveBeenCalledWith('session',{role:'host'});
 expect(gamingApplication.resumeSession).not.toHaveBeenCalled();
});

it('resolves a Party Games app target from authorized owner metadata', async () => {
 const {createPartyGamesTargetResolver}=await import('../../participants.mjs');
 const gamingApplication={getLaunchDescriptor:vi.fn(async()=>({definition_id:'charades:test',surface:{id:'party-games'}}))};
 const resolve=createPartyGamesTargetResolver({gamingApplication,householdId:'home'});
 await expect(resolve({path:'charades:test',viewer:{role:'host',participant_id:'u',householdId:'home'}})).resolves.toEqual({kind:'app',appId:'party-games',definitionId:'charades:test',surfaceId:'party-games',participantConsumer:{id:'party-games',version:1}});
 expect(gamingApplication.getLaunchDescriptor).toHaveBeenCalledWith('charades:test',{surfaceId:'party-games',authorityMode:'remote'});
 await expect(resolve({path:'charades:test',viewer:{role:'host',participant_id:'u',householdId:'other'}})).rejects.toMatchObject({code:'authorization_denied'});
 await expect(resolve({path:'charades:test?x=1',viewer:{role:'host',participant_id:'u',householdId:'home'}})).rejects.toMatchObject({code:'invalid_target'});
});
