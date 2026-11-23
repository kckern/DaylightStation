import { isParticipantCharades } from '../../../portable/participantEligibility.mjs';
import { remapParticipantKeys } from '../../../portable/participantSettings.mjs';
import { validateParticipantContext } from '../../../../../../__capabilities/household-identity/portable/participants.mjs';
import { createCharadesChallengeOrder } from '../../../../../../__capabilities/gaming/portable/rulesets/activity-party/index.mjs';

const ref = Object.freeze({id:'party-games',version:1});
const modes = ['text','reader','image'];
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value);
const clone = value => structuredClone(value);
function fail(code,message) { throw Object.assign(new Error(message),{code}); }
function validTarget(target) { if (!target || !validId(target.definitionId) || target.surfaceId !== 'party-games') fail('invalid_target','Invalid Party Games target'); }
function host(viewer) { if (viewer?.role !== 'host') fail('authorization_denied','Host authority is required'); }
function settingsValue(settings) {
 const validClueModes = settings?.charades?.clue_modes;
 const validSettings = settings?.schema === 'party-games-participant-setup/v1'
  && typeof settings.autostart === 'boolean'
  && modes.includes(settings.charades?.default_clue_mode)
  && validClueModes && typeof validClueModes === 'object'
  && !Array.isArray(validClueModes)
  && Object.values(validClueModes).every(mode => modes.includes(mode));
 if (!validSettings) fail('invalid_session_setup','Invalid Party Games settings');
 return settings;
}
export function buildPartyGameSetup({target,settings,participantContext,definition,clueHistoryIds}) {
 validTarget(target); settingsValue(settings); validateParticipantContext(participantContext);
 if (!participantContext.participants.length) fail('invalid_session_setup','Participants are required');
 if (!isParticipantCharades(definition)) fail('invalid_session_setup','Target must be casual Charades');
 const keys = new Set(participantContext.participants.map(p=>p.key));
 for (const key of Object.keys(settings.charades.clue_modes)) if (!keys.has(key)) fail('invalid_session_setup',`Unknown participant key ${key}`);
 const participants = participantContext.participants.map(p=>{
  if (!validId(p.participant_id)) fail('invalid_session_setup','Invalid gaming participant ID');
  return {id:p.participant_id,participant_id:p.participant_id,name:p.display.name,avatar:clone(p.display.avatar),identity:clone(p.identity)};
 });
 const seats = participants.map(p=>({id:p.id,participant_id:p.id,name:p.name,avatar:clone(p.avatar),members:[clone(p)]}));
 const by_participant = Object.fromEntries(participantContext.participants.map(p=>[p.participant_id,Object.hasOwn(settings.charades.clue_modes,p.key) ? settings.charades.clue_modes[p.key] : settings.charades.default_clue_mode]));
 const imageParticipantIds=Object.keys(by_participant).filter(id=>by_participant[id]==='image');
 const readerParticipantIds=Object.keys(by_participant).filter(id=>by_participant[id]==='reader');
 createCharadesChallengeOrder({challenges:definition.challenges,turnOrder:seats.map(s=>s.id),cluesPerTurn:1,imageParticipantIds,readerParticipantIds,seed:1});
 if (!Array.isArray(clueHistoryIds) || clueHistoryIds.some(id=>typeof id !== 'string')) fail('invalid_session_setup','Invalid clue history');
 return {participants,seats,setup:{charades_presentation:{schema:'charades-presentation/v1',by_participant},charades_history_ids:clone(clueHistoryIds)}};
}
function artifactRefs(loaded) {
 if (!loaded || !/^[a-f0-9]{64}$/.test(loaded.hash) || !loaded.artifacts || !Object.keys(loaded.artifacts).length) fail('prepared_artifact_unavailable','Definition artifacts unavailable');
 return [{role:'definition_bundle',id:loaded.artifacts.rules_definition?.id,hash:loaded.hash},...Object.entries(loaded.artifacts).map(([role,value])=>({role,...clone(value)}))];
}
function ready(snapshot,id) { return {schema:'participant-launch-result/v1',kind:'ready',launch_id:snapshot.launch_id,consumer:ref,snapshot_hash:snapshot.snapshot_hash,participant_context:clone(snapshot.participant_context),output:{schema:'party-games-launch-result/v1',data:{session_id:id,definition_id:snapshot.target.definitionId}},runtime_ref:{provider:'gaming',id}}; }
/**
 * Tell an engaged game from browsing or a quick test. A game comes back only when it is
 * unfinished, at least two clues have been played by two different performers, and it
 * has exactly tonight's people. Anything less starts a new game.
 */
export function isEngagedGame(runtime, participantIds = null) {
  if (!['active','suspended'].includes(runtime?.header?.status)) return false;
  const played = Number(runtime.state?.challenge_index);
  if (!Number.isInteger(played) || played < 2) return false;
  const performers = new Set((runtime.state?.turn_order || []).slice(0, played));
  if (performers.size < 2) return false;
  if (Array.isArray(participantIds)) {
    const saved = new Set((runtime.header.participants || []).map(p => p.participant_id || p.id));
    if (saved.size !== participantIds.length || participantIds.some(id => !saved.has(id))) return false;
  }
  return true;
}

/** Label for a resumable game, from its own saved header (source label and saved roster). */
export function resumeLabel(header) {
  const names=(header?.participants || []).map(p=>p.name).filter(name=>typeof name==='string' && name.trim());
  const details=[header?.launch?.participant_launch?.source_label, names.join(', ')].filter(Boolean);
  return details.length ? `Resume game — ${details.join(' — ')}` : 'Resume game';
}

export class PartyGamesParticipantConsumer {
 id='party-games'; version=1; targets=[{action:'open',kind:'app',appId:'party-games'}];
 constructor({definitions,clueHistory,executionPort,manifestStore}) { if (!definitions || !executionPort || !manifestStore) throw new Error('Definition and execution ports are required'); Object.assign(this,{definitions,clueHistory,executionPort,manifestStore}); }
 describe(target) { validTarget(target); return {participantRequirement:'optional',minParticipants:1,maxParticipants:128,selectorSupport:['all','explicit'],settingsSchema:'party-games-participant-setup/v1',editorKey:'party-games'}; }
 async prepareSetup({target,settings,participantContext,viewer}) {
  host(viewer); validTarget(target);
  const loaded=await this.definitions.getCurrent(target.definitionId); if (!loaded) fail('definition_not_found','Definition unavailable');
  const artifacts=artifactRefs(loaded);
  const manifest=this.manifestStore.get(loaded.definition?.experience?.id,loaded.definition?.experience?.version);
  const surface=manifest?.surfaces?.find(entry=>entry.id===target.surfaceId);
  if (!manifest || !/^[a-f0-9]{64}$/.test(manifest.hash || '') || !surface?.authority_modes?.includes('remote')) fail('prepared_artifact_unavailable','Experience manifest or surface unavailable');
  const history=await this.clueHistory?.list(target.definitionId) ?? [];
  const data=buildPartyGameSetup({target,settings,participantContext,definition:loaded.definition,clueHistoryIds:history.map(x=>String(x.clue_id))});
  return {schema:'participant-prepared-setup/v1',consumer:clone(ref),setup:{schema:'party-games-frozen-setup/v1',data:{...data,pinnedArtifacts:{hash:loaded.hash,artifacts:clone(loaded.artifacts),manifest:clone(manifest),surface:clone(surface)}}},artifacts,preview:{schema:'party-games-preview/v2',data:{participants:data.participants.map(({id,name,avatar})=>({name,avatar,clue_mode:data.setup.charades_presentation.by_participant[id]}))}},confirmation:settings.autostart?'none':'required'};
 }
 async retainPrepared({prepared,viewer}) {
  host(viewer); const expected=prepared.setup.data.pinnedArtifacts; const definitionId=prepared.artifacts.find(x=>x.role==='definition_bundle')?.id;
  let currentManifest; try { currentManifest=this.manifestStore.get(expected.manifest.id,expected.manifest.version); } catch (error) { throw Object.assign(new Error('Inspected manifest could not be reread',{cause:error}),{code:'prepared_artifact_unavailable'}); }
  if (JSON.stringify(currentManifest)!==JSON.stringify(expected.manifest)) fail('prepared_artifact_unavailable','Inspected manifest is unavailable');
  let loaded; try { loaded=await this.definitions.getCurrent(definitionId); } catch (error) { throw Object.assign(new Error('Inspected definition could not be reread', {cause:error}),{code:'prepared_artifact_unavailable'}); }
  if (!loaded || loaded.hash!==expected.hash || JSON.stringify(loaded.artifacts)!==JSON.stringify(expected.artifacts)) fail('prepared_artifact_unavailable','Inspected definition is unavailable');
  let pinned; try { pinned=await this.definitions.pin(loaded); } catch (error) { throw Object.assign(new Error('Inspected artifacts could not be retained', {cause:error}),{code:'prepared_artifact_unavailable'}); }
  if (pinned.hash!==expected.hash || JSON.stringify(pinned.artifacts)!==JSON.stringify(expected.artifacts)) fail('prepared_artifact_unavailable','Retained definition differs from inspected artifacts');
 }
 async begin({snapshot,executionKey,executionMetadata,viewer}) {
  host(viewer); if (typeof executionKey!=='string' || !executionKey) fail('invalid_execution_key','Execution key required');
  const digest=async prefix=>new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${prefix}\0${executionKey}`)));
  const idHash=await digest('participant-game-id/v1'); const seedHash=await digest('participant-game-seed/v1');
  const sessionId='game:pl:'+Array.from(idHash, byte=>byte.toString(16).padStart(2,'0')).join(''); const seed=new DataView(seedHash.buffer,seedHash.byteOffset,seedHash.byteLength).getUint32(0);
  const {pinnedArtifacts,participants,seats,setup}=clone(snapshot.prepared.setup.data);
  await this.executionPort.createReserved({sessionId,seed,pinnedArtifacts,participants,seats,setup,creationKey:executionKey,participantEvidence:{schema:'participant-execution-evidence/v1',snapshot:clone(snapshot),metadata:executionMetadata ? clone(executionMetadata) : null},viewer});
  return ready(snapshot,sessionId);
 }
 async findResumable({receipts,viewer,participantIds=null}) {
  const result=[];
  for (const receipt of receipts) {
   if (receipt.runtime_ref?.provider !== 'gaming') continue;
   if (typeof this.executionPort.inspect !== 'function') fail('participant_discovery_unavailable','Read-only game discovery is unavailable');
   try {
    const runtime=await this.executionPort.inspect(receipt.runtime_ref.id,viewer);
    if (runtime && isEngagedGame(runtime, participantIds)) {
     result.push({launch_id:receipt.launch_id,runtime_ref:clone(receipt.runtime_ref),label:resumeLabel(runtime.header)});
    }
   } catch (error) {
    if (error.code !== 'runtime_unavailable' && error.code !== 'session_not_found') throw error;
   }
  }
  return result;
 }
 async resume({snapshot,receipt,viewer}) {
  host(viewer); const runtimeRef=receipt?.runtime_ref; if (runtimeRef?.provider!=='gaming' || !validId(runtimeRef.id)) fail('runtime_unavailable','Saved game is unavailable');
  let runtime; try { runtime=await this.executionPort.resume(runtimeRef.id,viewer); } catch (error) { if (error.code==='session_not_found' || error.code==='runtime_unavailable') fail('runtime_unavailable','Saved game is unavailable'); throw error; }
  if (!runtime) fail('runtime_unavailable','Saved game is unavailable'); return ready(snapshot,runtimeRef.id);
 }
 remapParticipantKeys({settings,keyMap}) {
  return remapParticipantKeys({settings,keyMap});
 }
}
