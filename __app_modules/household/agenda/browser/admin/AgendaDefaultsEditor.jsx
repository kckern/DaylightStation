import React,{useEffect,useRef,useState} from 'react';
import {Button,Group,Stack,Text,Title} from '@mantine/core';
import {ListDraftEditor} from '../../../../../__capabilities/content-catalog/browser/list-editor.jsx';
import {ParticipantPicker} from '../../../../../__capabilities/household-identity/browser/public.mjs';
import {changesBoundTarget} from './planDraftReducer.js';
import GuestDirectory from './GuestDirectory.jsx';
import ActivitySettings, {useDescriptors,materializeBindings,bindingErrors} from './ActivitySettings.jsx';
import {applyPlanEdit} from '../../portable/planEdits.mjs';
import {useUnsavedGuard} from '../../../../../frontend/src/modules/Admin/shared/useUnsavedGuard.js';
const alloc=prefix=>`${prefix}_${crypto.randomUUID()}`;
export default function AgendaDefaultsEditor({series,client,editors,onClose,onSaved}) {
 const [draft,setDraft]=useState(()=>structuredClone(series.document)),[dirty,setDirty]=useState(false),[baseEtag,setBaseEtag]=useState(series.etag),[conflict,setConflict]=useState(false),[error,setError]=useState(''),[directory,setDirectory]=useState({people:[],etag:null}),[artworkBusy,setArtworkBusy]=useState(false);
 const current=useRef(null),mounted=useRef(true);
 current.current={draft,scope:series.document.series_id};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 React.useEffect(()=>{client.people().then(r=>setDirectory({people:r.document.people,etag:r.etag})).catch(e=>setError(e.message));},[client]);
 useUnsavedGuard(dirty,{label:'agenda defaults'});
 const discovery=useDescriptors(client,draft.defaults.list), descriptors=discovery.values;
 const staleBindings=!discovery.loading && !discovery.error ? bindingErrors(draft.defaults,descriptors) : [];
 const remapActivitySettings=({consumer,settings,participantKeyMap})=>{const editor=Object.values(editors).find(e=>e.consumer?.id===consumer.id&&e.consumer?.version===consumer.version);if(!editor)throw new Error('Consumer settings editor unavailable');return editor.remapParticipantKeys({settings,keyMap:participantKeyMap});};
 const ids={section:()=>alloc('section'),item:()=>alloc('item'),rosterEntry:()=>alloc('rp')};
 const change=next=>{setDraft({...draft,defaults:next});setDirty(true);};
 const edit=async command=>{
  const snapshot=current.current;
  const stillCurrent=()=>mounted.current && current.current.scope===snapshot.scope && current.current.draft===snapshot.draft;
  try {
   let value=snapshot.draft.defaults;
   if (changesBoundTarget(value,command)) {
    if (!window.confirm('Changing this target will clear its participant setup. Continue?')) return;
    value=structuredClone(value);
    delete value.activity_settings[command.itemUid];
   }
   let imageRefs={};
   if (command.type==='duplicate-item' || command.type==='duplicate-section') {
    const sections=value.list.sections;
    const items=command.type==='duplicate-item'
      ? sections.flatMap(section=>section.items).filter(item=>item.uid===command.itemUid)
      : sections.find(section=>section.uid===command.sectionUid)?.items ?? [];
    const itemUids=items.filter(item=>!item.image).map(item=>item.uid);
    if (itemUids.length) {
     setArtworkBusy(true);
     const result=await client.resolveArtwork(snapshot.scope,itemUids);
     if (!stillCurrent()) {
      if (mounted.current && current.current.scope===snapshot.scope) setError('The defaults changed while artwork was loading. Try again.');
      return;
     }
     imageRefs=result.document.images;
    }
   }
   if (stillCurrent()) change(applyPlanEdit(value,command,{ids,remapActivitySettings,imageRefs}));
  } catch (error) {
   if (mounted.current && current.current.scope===snapshot.scope) setError(error.message);
  } finally {
   if (mounted.current && current.current.scope===snapshot.scope) setArtworkBusy(false);
  }
 };
 const rosterChange=next=>{try{let value=draft.defaults;const opts={ids,remapActivitySettings};for(const p of value.participants.filter(p=>!next.some(q=>q.id===p.id)))value=applyPlanEdit(value,{type:'delete-participant',participantId:p.id},opts);for(const p of next){if(!value.participants.some(q=>q.id===p.id))value=applyPlanEdit(value,{type:'add-participant',participant:p},{...opts,ids:{...ids,rosterEntry:()=>p.id}});else{const {id,...changes}=p;value=applyPlanEdit(value,{type:'update-participant',participantId:id,changes},opts);}}change(value);}catch(e){setError(e.message);}};
 const createGuest=async guest=>{try{const result=await client.createGuest(guest,directory.etag);setDirectory(old=>({people:[...old.people,result.document],etag:result.etag}));return result.document;}catch(e){const fresh=await client.people();setDirectory({people:fresh.document.people,etag:fresh.etag});const found=fresh.document.people.find(p=>p.person.kind==='guest'&&p.person.id===guest.id&&p.display.name===guest.name);if(found)return found;throw e;}};
 return <Stack><Title order={3}>Defaults for newly created weeks</Title><Text>Changes affect only newly created weeks.</Text>{error&&<Text c="red">{error}</Text>}{discovery.error&&<Text c="red">Activity discovery: {discovery.error}</Text>}{staleBindings.map(e=><Text c="red" key={e.field}>{e.field}: {e.message} <Button onClick={()=>{const next=structuredClone(draft.defaults);delete next.activity_settings[e.field.slice("activity_settings.".length)];change(next);}}>Clear setup</Button></Text>)}{conflict&&<Group><Button onClick={async()=>{try{const latest=await client.series(draft.series_id);setDraft(latest.document);setBaseEtag(latest.etag);setConflict(false);setDirty(false);setError('');}catch(e){setError(e.message);}}}>Reload defaults</Button><Button onClick={async()=>{try{const latest=await client.series(draft.series_id);setBaseEtag(latest.etag);setConflict(false);setError('');}catch(e){setError(e.message);}}}>Reapply defaults edits</Button></Group>}<ParticipantPicker value={draft.defaults.participants} people={directory.people} onChange={rosterChange} allocateEntryId={ids.rosterEntry} allocateGuestId={()=>alloc('guest')} onCreateGuest={directory.etag ? createGuest : undefined} scopeKey={`defaults:${draft.series_id}`}/>{directory.etag&&<GuestDirectory client={client} directory={directory} onChange={setDirectory}/>}<ListDraftEditor list={draft.defaults.list} onEdit={edit} readOnly={artworkBusy} renderItemSettings={({item})=><ActivitySettings item={item} document={draft.defaults} descriptor={descriptors[item.uid]} editors={editors} onChange={change}/>}/><Group><Button disabled={conflict || artworkBusy || discovery.loading || !!discovery.error || staleBindings.length>0} onClick={async()=>{try{onSaved(await client.saveSeries(draft.series_id,{...draft,defaults:materializeBindings(draft.defaults,descriptors,editors)},baseEtag));}catch(e){if(e.status===409)setConflict(true);setError(e.status===409?'Defaults changed elsewhere. Your edits are retained.':e.message);}}}>Save defaults</Button><Button variant="subtle" onClick={()=>{if(!dirty||window.confirm('Discard unsaved changes?'))onClose();}}>Cancel</Button></Group></Stack>;
}
