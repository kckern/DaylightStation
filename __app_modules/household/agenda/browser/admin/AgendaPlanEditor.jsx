import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { Link, useParams } from 'react-router-dom';
import { ListDraftEditor } from '../../../../../__capabilities/content-catalog/browser/list-editor.jsx';
import { ParticipantPicker } from '../../../../../__capabilities/household-identity/browser/public.mjs';
import {copyContent,replaceDraftContent} from '../../portable/copyContent.mjs';
import GuestDirectory from './GuestDirectory.jsx';
import ActivitySettings, {useDescriptors,materializeBindings,bindingErrors} from './ActivitySettings.jsx';
import { useUnsavedGuard } from '../../../../../frontend/src/modules/Admin/shared/useUnsavedGuard.js';
import { agendaClient } from './agendaClient.js';
import { planDraftReducer, changesBoundTarget } from './planDraftReducer.js';

const id = prefix => `${prefix}_${crypto.randomUUID()}`;
const endOfWeek = week => {const day=new Date(`${week}T00:00:00Z`);day.setUTCDate(day.getUTCDate()+6);return day.toISOString().slice(0,10);};
const allocators = {section:()=>id('section'),item:()=>id('item'),rosterEntry:()=>id('rp')};

export default function AgendaPlanEditor({client=agendaClient,editors={}}) {
  const {seriesId,planId}=useParams();
  const [state,dispatch]=useReducer(planDraftReducer,null);
  const [context,setContext]=useState(null), [directory,setDirectory]=useState({people:[],etag:null}), [error,setError]=useState(''), [directoryError,setDirectoryError]=useState(''), [artworkBusy,setArtworkBusy]=useState(false);
  useUnsavedGuard(!!state?.dirty,{label:'agenda plan'});
  useEffect(()=>{let active=true; Promise.all([client.plan(seriesId,planId),client.planningContext(seriesId)]).then(([plan,week])=>{if(active){dispatch({type:'load',...plan,scope:`${seriesId}:${planId}`});setContext(week.document);}}).catch(e=>active&&setError(e.message));client.people().then(people=>{if(active){setDirectory({people:people.document.people,etag:people.etag});setDirectoryError('');}}).catch(e=>active&&setDirectoryError(e.message));return()=>{active=false;};},[client,seriesId,planId]);
  const draft=state?.draft;
  useEffect(()=>{setArtworkBusy(false);setError('');setDirectoryError('');},[seriesId,planId]);
  const current=useRef(null);
  const mounted=useRef(true);
  const scopeKey=`${seriesId}:${planId}`;
  current.current={draft,scopeKey,directory};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const stillCurrent=snapshot=>mounted.current && current.current.scopeKey===snapshot.scopeKey && current.current.draft===snapshot.draft;

  const discovery=useDescriptors(client,draft?.list), descriptors=discovery.values;
  const staleBindings=draft && !discovery.loading && !discovery.error ? bindingErrors(draft,descriptors) : [];
  const remapActivitySettings=({consumer,settings,participantKeyMap})=>{const editor=Object.values(editors).find(e=>e.consumer?.id===consumer.id && e.consumer?.version===consumer.version);if(!editor) throw new Error('Consumer settings editor unavailable');return editor.remapParticipantKeys({settings,keyMap:participantKeyMap});};
  const edit=async command=>{
    const snapshot=current.current;
    const changed=changesBoundTarget(snapshot.draft,command);
    if (changed && !window.confirm('Changing this target will clear its participant setup. Continue?')) return;
    let imageRefs={};
    if (command.type==='duplicate-item' || command.type==='duplicate-section') {
      const sections=snapshot.draft.list.sections;
      const items=command.type==='duplicate-item'
        ? sections.flatMap(section=>section.items).filter(item=>item.uid===command.itemUid)
        : sections.find(section=>section.uid===command.sectionUid)?.items ?? [];
      const itemUids=items.filter(item=>!item.image).map(item=>item.uid);
      if (itemUids.length) {
        setArtworkBusy(true);
        try {
          const result=await client.resolveArtwork(seriesId,itemUids);
          if (!stillCurrent(snapshot)) {
            if (mounted.current && current.current.scopeKey===snapshot.scopeKey) setError('The draft changed while artwork was loading. Try again.');
            return;
          }
          imageRefs=result.document.images;
        } catch (error) {
          if (mounted.current && current.current.scopeKey===snapshot.scopeKey) setError(error.message);
          return;
        } finally {
          if (mounted.current && current.current.scopeKey===snapshot.scopeKey) setArtworkBusy(false);
        }
      }
    }
    if (stillCurrent(snapshot)) dispatch({type:'edit',command,clearChangedBinding:changed,options:{ids:allocators,remapActivitySettings,imageRefs}});
  };
  const replace=document=>dispatch({type:'replace',document});
  const rosterChange=next=>{
    let working=draft;
    try {
      const oldIds=new Set(working.participants.map(p=>p.id)), nextIds=new Set(next.map(p=>p.id));
      const options={ids:allocators,remapActivitySettings};
      for(const p of working.participants.filter(p=>!nextIds.has(p.id))) working=applyRoster(working,{type:'delete-participant',participantId:p.id},options);
      for(const p of next) {
        if(!oldIds.has(p.id)) working=applyRoster(working,{type:'add-participant',participant:p},{...options,ids:{...allocators,rosterEntry:()=>p.id}});
        else {const {id:ignored,...changes}=p;working=applyRoster(working,{type:'update-participant',participantId:p.id,changes},options);}
      }
      replace(working);
    } catch(e){dispatch({type:'errors',errors:[{field:e.field||'participants',message:e.message}]});}
  };
  const createGuest=async guest=>{
    try {const result=await client.createGuest(guest,directory.etag);setDirectory(old=>({people:[...old.people,result.document],etag:result.etag}));return result.document;}
    catch(error){const refreshed=await client.people();setDirectory({people:refreshed.document.people,etag:refreshed.etag});const found=refreshed.document.people.find(p=>p.person.kind==='guest' && p.person.id===guest.id && p.display.name===guest.name);if(found)return found;throw error;}
  };
  const save=async publish=>{try {setError('');const saved=await client.savePlan(seriesId,planId,materializeBindings(draft,descriptors,editors),state.baseEtag);dispatch({type:'saved',...saved});if(publish){const published=await client.transition(seriesId,planId,'publish',saved.etag);dispatch({type:'saved',...published});}} catch(e){if(e.status===409)dispatch({type:'conflict'});else dispatch({type:'errors',errors:e.errors || [{field:'plan',message:e.message}]});}};
  const replaceDefaults=async()=>{
    const snapshot=current.current;
    const isCurrent=()=>stillCurrent(snapshot) && current.current.directory===snapshot.directory;
    const stale=()=>{
      if (mounted.current && current.current.scopeKey===snapshot.scopeKey) setError('The draft changed while defaults were loading. Try again.');
    };
    try {
      const series=await client.series(seriesId);
      if (!isCurrent()) return stale();
      const defaults=series.document.defaults;
      const count=defaults.list.sections.reduce((total,section)=>total+section.items.length,0);
      if (!window.confirm(`Replace this draft with defaults: ${defaults.participants.length} people and ${count} activities?`)) return;
      const artwork=await client.defaultsArtwork(seriesId);
      if (!isCurrent()) return stale();
      if (artwork.document.revision!==series.document.revision) throw new Error('Defaults changed; review them again');
      const displaySnapshots={};
      for (const participant of defaults.participants) {
        if (!participant.person) continue;
        const entry=snapshot.directory.people.find(person=>person.active!==false && person.person.kind===participant.person.kind && person.person.id===participant.person.id);
        if (!entry) throw new Error(`Person unavailable: ${participant.person.id}`);
        displaySnapshots[`${participant.person.kind}:${participant.person.id}`]=entry.display;
      }
      const reservedIds=[snapshot.draft.plan_id,...snapshot.draft.participants.map(p=>p.id),...snapshot.draft.list.sections.flatMap(section=>[section.uid,...section.items.map(item=>item.uid)])];
      const copied=copyContent({source:defaults,ids:allocators,displaySnapshots,remapActivitySettings,imageRefs:artwork.document.images,reservedIds});
      replace(replaceDraftContent(snapshot.draft,copied));
    } catch (error) {
      if (mounted.current && current.current.scopeKey===snapshot.scopeKey) setError(error.message);
    }
  };
  const reload=async reapply=>{try{const result=await client.plan(seriesId,planId);dispatch(reapply?{type:'rebase',etag:result.etag}:{type:'load',...result});}catch(e){setError(e.message);}};
  if(!state || state.scope!==scopeKey) return <Text>{error || 'Loading agenda…'}</Text>;
  const readOnly=!['draft','published'].includes(draft.state) || (context && draft.week_of<context.thisWeek);
  return <Stack><Group><Title order={2}>{draft.week_of===context?.thisWeek?'This week':draft.week_of===context?.nextWeek?'Next week':'Weekly plan'}</Title><Badge>{draft.state}</Badge></Group>
    <Text>{draft.week_of} – {endOfWeek(draft.week_of)} · {draft.calendar.timezone}</Text>
    <TextInput label="Title" value={draft.title} readOnly={readOnly} onChange={e=>replace({...draft,title:e.currentTarget.value})}/>
    <TextInput label="Scheduled date" type="date" value={draft.scheduled_on} readOnly={readOnly} onChange={e=>replace({...draft,scheduled_on:e.currentTarget.value})}/>
    {error && <Alert color="red">{error}</Alert>}{directoryError && <Alert color="red">Directory: {directoryError}</Alert>}{discovery.error && <Alert color="red">Activity discovery: {discovery.error}</Alert>}
    {staleBindings.map(e=><Alert color="red" key={e.field}>{e.field}: {e.message} <Button onClick={()=>{const next=structuredClone(draft);delete next.activity_settings[e.field.slice("activity_settings.".length)];replace(next);}}>Clear setup</Button></Alert>)}
    {state.fieldErrors.map((e,i)=><Alert color="red" key={i}>{e.field}: {e.message}</Alert>)}
    {state.conflict && <Alert color="yellow">This plan changed elsewhere. Your edits are retained.<Group><Button onClick={()=>reload(false)}>Reload</Button><Button onClick={()=>reload(true)}>Reapply my edits</Button></Group></Alert>}
    <Title order={3}>People</Title><ParticipantPicker value={draft.participants} people={directory.people} onChange={rosterChange} onCreateGuest={directory.etag ? createGuest : undefined} allocateEntryId={allocators.rosterEntry} allocateGuestId={()=>id('guest')} scopeKey={planId} readOnly={readOnly}/>
    {!readOnly && <Button onClick={()=>rosterChange(draft.participants.map(p=>{const entry=p.person && directory.people.find(e=>e.active!==false && e.person.kind===p.person.kind && e.person.id===p.person.id);return entry?{...p,display:structuredClone(entry.display)}:p;}))}>Refresh display snapshots</Button>}
    {directory.etag && <GuestDirectory client={client} directory={directory} onChange={setDirectory}/>}<Title order={3}>Activities</Title><ListDraftEditor list={draft.list} onEdit={edit} readOnly={readOnly || artworkBusy} renderItemSettings={({item})=><ActivitySettings item={item} document={draft} descriptor={descriptors[item.uid]} editors={editors} onChange={replace} readOnly={readOnly}/>}/>
    {!readOnly && <Group><Button disabled={state.conflict || artworkBusy || discovery.loading || !!discovery.error || staleBindings.length>0} onClick={()=>save(false)}>{draft.state==='published'?'Save and update published plan':'Save draft'}</Button>{draft.state==='draft' && <><Button disabled={state.conflict || artworkBusy || discovery.loading || !!discovery.error || staleBindings.length>0} onClick={()=>save(true)}>Publish</Button><Button variant="light" onClick={replaceDefaults}>Replace draft with defaults</Button></>}</Group>}
    <Link to={`/admin/content/agendas/${encodeURIComponent(seriesId)}`} onClick={e=>{if(state.dirty&&!window.confirm('Discard unsaved changes?'))e.preventDefault();}}>Back to series</Link>
  </Stack>;
}
import { applyPlanEdit as applyRoster } from '../../portable/planEdits.mjs';
