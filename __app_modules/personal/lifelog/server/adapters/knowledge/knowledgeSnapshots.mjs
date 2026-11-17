/** Canonical file images and hand-edit detection for the YAML store. No writes. */
import path from 'node:path';
import {emptySnapshot,validateKnowledgeObject} from '../../domain/knowledge/contracts.mjs';
import {isLocalDate} from '../../domain/knowledge/calendar.mjs';
import {readYaml,safeFile,fileHash,same,knowledgeError,changedFields,readField,objectPath} from './knowledgeFiles.mjs';

export function readFileImages({root,io}) {
  const files={};let conflicted=false;const realRoot=io.resolveRealPath(root);
  function scan(dir,relative='') {
    for(const name of io.listEntries(dir)) {
      if(/conflicted copy/i.test(name)){conflicted=true;continue;}
      const rel=relative?relative+'/'+name:name;const file=path.join(dir,name);const real=io.resolveRealPath(file);
      if(realRoot && (!real || !real.startsWith(realRoot+path.sep)))throw knowledgeError('INVALID_KNOWLEDGE_PATH');
      const stat=io.getFileStats(file);
      if(stat.isDirectory()) {
        if(!relative && ['loops','people','closed','asks','ledger'].includes(name))scan(file,rel);
        else if(relative==='closed' && /^\d{4}$/.test(name))scan(file,rel);
        continue;
      }
      if(relative==='ledger'||!name.endsWith('.yml'))continue;
      safeFile(root,rel);files[rel]=readYaml(io,file);
    }
  }
  scan(root);return {files,conflicted};
}
export function assertContinuity(before,after) {
  if(before.id!==after.id || before.schema!==after.schema || before.kind!==after.kind || !same(before.created,after.created))throw knowledgeError('KNOWLEDGE_IDENTITY_EDIT');
  if((before.evidence??[]).some(old=>!(after.evidence??[]).some(e=>e.ref===old.ref&&e.quote===old.quote)))throw knowledgeError('KNOWLEDGE_EVIDENCE_REMOVED');
  if((before.user_edits??[]).some(edit=>!(after.user_edits??[]).some(e=>same(e,edit))))throw knowledgeError('KNOWLEDGE_USER_EDITS_REMOVED');
}
function objectEntry(relative) {return /^(loops|people|closed)\//.test(relative);}
export function observeSnapshot({root,io,history,asOf}) {
  const {files,conflicted}=readFileImages({root,io});const empty=emptySnapshot();const stateDoc=files['state.yml'];
  const pending=history.transactions.some(t=>!t.complete);const recovering=pending||history.tailRepairBytes>0;
  if(stateDoc && (stateDoc.schema!=='lifelog-knowledge-state/v1'||!Number.isSafeInteger(stateDoc.revision)||stateDoc.revision<0||!stateDoc.manifest||typeof stateDoc.manifest!=='object'))throw knowledgeError('KNOWLEDGE_STATE_CORRUPT');
  if(!stateDoc&&!recovering&&Object.keys(files).length)throw knowledgeError('KNOWLEDGE_STATE_REQUIRED');
  const objects={};const sourcePaths={};const edits=[];
  for(const [relative,value] of Object.entries(files).filter(([rel])=>objectEntry(rel))) {
    validateKnowledgeObject(value);
    if(path.basename(relative)!==value.id.split('.')[1]+'.yml'||(value.kind==='person'&&!relative.startsWith('people/'))||(value.kind==='loop'&&relative.startsWith('people/')))throw knowledgeError('KNOWLEDGE_IDENTITY_EDIT');
    if(objects[value.id]&&!recovering)throw knowledgeError('KNOWLEDGE_DUPLICATE_OBJECT');
    objects[value.id]=structuredClone(value);sourcePaths[value.id]=relative;
  }
  const state=structuredClone(stateDoc??{...empty.state,revision:0});const sequence=state.revision;
  delete state.schema;delete state.revision;const quiz=state.quiz??[];delete state.quiz;
  if(!recovering) {
    const last=[...history.transactions].reverse().find(t=>t.complete);
    if(last&&!same(last.prepare.after.files['state.yml'],stateDoc))throw knowledgeError('KNOWLEDGE_STATE_EDIT');
    if(last&&!same(last.prepare.after.files['roster.yml'],files['roster.yml']))throw knowledgeError('KNOWLEDGE_ROSTER_EDIT');
    if(last&&Object.keys(last.prepare.after.files).some(relative=>relative.startsWith('asks/')&&!Object.hasOwn(files,relative)))throw knowledgeError('KNOWLEDGE_ASKS_REMOVED');
    for(const [id,manifest] of Object.entries(state.manifest??{})) {
      if(!objects[id])throw knowledgeError('KNOWLEDGE_OBJECT_REMOVED');
      const actual=files[sourcePaths[id]];
      if(fileHash(actual)===manifest.hash)continue;
      const event=history.events.find(e=>e.id===manifest.lastWriteEventId);
      const before=event?.after?.files?.[manifest.path];
      if(!before)throw knowledgeError('KNOWLEDGE_MANIFEST_CORRUPT');
      assertContinuity(before,actual);
      const object=objects[id];const changed=changedFields(before,actual).filter(field=>!field.startsWith('user_edits'));
      object.pinned=[...new Set([...(actual.pinned??[]),...changed])];
      for(const field of changed) {
        const edit={path:field,before:readField(before,field),after:readField(actual,field),at:io.getFileStats(safeFile(root,sourcePaths[id])).mtimeMs,by:'user_edit'};
        object.user_edits.push(edit);edits.push({objectId:id,...edit});
      }
    }
    if(Object.keys(objects).some(id=>!state.manifest?.[id]))throw knowledgeError('KNOWLEDGE_UNTRACKED_OBJECT');
  }
  const asks=[];
  for(const [relative,value] of Object.entries(files).filter(([rel])=>rel.startsWith('asks/'))) {
    if(value?.schema!=='lifelog-knowledge-asks/v1'||!isLocalDate(value.askDate)||relative!=='asks/'+value.askDate+'.yml'||!Array.isArray(value.items))throw knowledgeError('KNOWLEDGE_ASKS_CORRUPT');
    asks.push(...value.items);
    const last=[...history.transactions].reverse().find(t=>t.complete);
    if(!recovering&&last&&!same(last.prepare.after.files[relative],value))throw knowledgeError('KNOWLEDGE_ASKS_EDIT');
  }
  const revision=sequence+':'+fileHash(files);
  return {files,sequence,sourcePaths,edits,snapshot:{revision,objects,asks,quiz,state,roster:files['roster.yml']??null,
    health:{available:!conflicted&&!recovering,conflicted,recovering,lastSweepAt:state.lastSweepAt??null,reason:conflicted?'conflict':recovering?'recovering':null}}};
}
function protectPinned(current,next) {
  assertContinuity(current,next);
  for(const field of current.pinned??[]) {
    if(same(readField(current,field),readField(next,field)))continue;
    const decision=(next.user_edits??[]).some(edit=>(edit.path===field||edit.path.startsWith(field+'.')||field.startsWith(edit.path+'.'))&&edit.by==='tap'&&edit.receiptId&&!current.user_edits.some(old=>same(old,edit)));
    if(!decision)throw knowledgeError('KNOWLEDGE_PINNED_FIELD');
  }
  next.pinned=[...new Set([...(current.pinned??[]),...(next.pinned??[])])];
}
export function prepareFileImages({observed,batch,eventId}) {
  const objects=structuredClone(observed.snapshot.objects);
  for(const input of batch.upserts??[]) {
    validateKnowledgeObject(input);const next=structuredClone(input);
    if(objects[next.id])protectPinned(objects[next.id],next);
    objects[next.id]=next;
  }
  const patch=structuredClone(batch.statePatch??{});const asks=patch.asks??observed.snapshot.asks;const quiz=patch.quiz??observed.snapshot.quiz;
  delete patch.asks;delete patch.quiz;
  if(['revision','schema','manifest'].some(field=>Object.hasOwn(patch,field)))throw knowledgeError('KNOWLEDGE_RESERVED_STATE');
  if(!Array.isArray(asks)||!Array.isArray(quiz)||asks.some(a=>typeof a.id!=='string'||!isLocalDate(a.askDate)))throw knowledgeError('KNOWLEDGE_ASKS_CORRUPT');
  if(observed.snapshot.asks.some(old=>!asks.some(a=>a.id===old.id&&a.askDate===old.askDate)))throw knowledgeError('KNOWLEDGE_ASK_REMOVED');
  const state={...observed.snapshot.state,...patch};const files={};const manifest={};
  for(const object of Object.values(objects)) {
    const relative=objectPath(object);files[relative]=object;
    const old=observed.snapshot.state.manifest?.[object.id];const hash=fileHash(object);
    manifest[object.id]={path:relative,hash,lastWriteEventId:old?.hash===hash&&old?.path===relative?old.lastWriteEventId:eventId};
  }
  const aliases=Object.create(null);
  for(const person of Object.values(objects).filter(o=>o.kind==='person'&&o.status==='active'))for(const name of [...(person.names??[]),...(person.aliases??[]).filter(a=>a.confirmed).map(a=>a.value)]) {
    const key=name.normalize('NFC').trim().toLowerCase();aliases[key]=[...new Set([...(aliases[key]??[]),person.id])];
  }
  files['roster.yml']={schema:'lifelog-knowledge-roster/v1',aliases};
  for(const ask of asks) {
    const relative='asks/'+ask.askDate+'.yml';files[relative]??={schema:'lifelog-knowledge-asks/v1',askDate:ask.askDate,items:[]};files[relative].items.push(ask);
  }
  files['state.yml']={...state,schema:'lifelog-knowledge-state/v1',revision:observed.sequence+1,manifest,quiz};
  return {before:{files:observed.files},after:{files},edits:observed.edits};
}
export function isObjectFile(relative){return objectEntry(relative);}
