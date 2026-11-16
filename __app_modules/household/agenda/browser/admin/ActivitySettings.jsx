import React,{useEffect,useState} from 'react';
import {Checkbox,Stack,Text} from '@mantine/core';
import {itemAction} from '../../portable/planEdits.mjs';

/** Authored payload stays opaque to Agenda; the composed resolver owns canonicalization. */
export const targetFor = (item,action) => ({kind:'authored-action',value:item[action]});
export function useDescriptors(client,list) {
 const signature=JSON.stringify(list?.sections.flatMap(s=>s.items.map(i=>({uid:i.uid,action:itemAction(i),value:i[itemAction(i)]}))) ?? []);
 const [result,setResult]=useState({signature:null,values:{},error:''});
 useEffect(()=>{if(!list)return;let active=true;Promise.all(list.sections.flatMap(s=>s.items).map(async item=>{const action=itemAction(item);if(!action)return [item.uid,null];return [item.uid,(await client.describe(targetFor(item,action),action)).document];})).then(entries=>{if(active)setResult({signature,values:Object.fromEntries(entries),error:''});}).catch(error=>{if(active)setResult({signature,values:{},error:error.message || 'Could not resolve activity capabilities'});});return()=>{active=false;};},[client,signature]);
 return {values:result.signature===signature?result.values:{},loading:result.signature!==signature,error:result.signature===signature?result.error:''};
}
export function bindingErrors(document, descriptors) {
 return Object.entries(document.activity_settings).filter(([uid,setup])=>{const ref=descriptors[uid]?.consumer;return !ref || ref.id!==setup.consumer.id || ref.version!==setup.consumer.version;}).map(([uid])=>({field:`activity_settings.${uid}`,message:'The participant consumer no longer matches this activity'}));
}
export function materializeBindings(document,descriptors,editors) {
 const next=structuredClone(document);
 for(const item of next.list.sections.flatMap(s=>s.items)) {
   const descriptor=descriptors[item.uid],editor=descriptor&&editors[descriptor.editorKey];
   if(!next.activity_settings[item.uid] && editor && editor.consumer.id===descriptor.consumer?.id && editor.consumer.version===descriptor.consumer?.version) next.activity_settings[item.uid]={schema:'agenda-activity-setup/v1',action:itemAction(item),participants:descriptor.selectorSupport && !descriptor.selectorSupport.includes('all') ? {mode:'explicit',ids:[]} : {mode:'plan'},consumer:descriptor.consumer,settings:editor.defaultSettings()};
 }
 return next;
}
export default function ActivitySettings({item,document,descriptor,editors,onChange,readOnly=false}) {
 const editor=descriptor && editors[descriptor.editorKey];
 if(!editor || !descriptor.consumer || editor.consumer.id!==descriptor.consumer.id || editor.consumer.version!==descriptor.consumer.version)return null;
 const existing=document.activity_settings[item.uid];
 if(existing && (existing.consumer.id!==descriptor.consumer.id || existing.consumer.version!==descriptor.consumer.version))return null;
 const action=itemAction(item),setup=existing || {schema:'agenda-activity-setup/v1',action,participants:descriptor.selectorSupport && !descriptor.selectorSupport.includes('all') ? {mode:'explicit',ids:[]} : {mode:'plan'},consumer:descriptor.consumer,settings:editor.defaultSettings()};
 const update=changes=>onChange({...document,activity_settings:{...document.activity_settings,[item.uid]:{...setup,...changes}}});
 const changeSelection=participants=>{
  const previous=setup.participants.mode==='plan' ? document.participants.map(p=>p.id) : setup.participants.ids;
  const next=participants.mode==='plan' ? document.participants.map(p=>p.id) : participants.ids;
  const removed=Object.fromEntries(previous.filter(id=>!next.includes(id)).map(id=>[id,null]));
  const settings=Object.keys(removed).length ? editor.remapParticipantKeys({settings:setup.settings,keyMap:removed}) : setup.settings;
  update({participants,settings});
 };
 const selected=(setup.participants.mode==='plan'?document.participants:document.participants.filter(p=>setup.participants.ids.includes(p.id))).map(p=>({...p,display:p.display || {name:p.person?.id || 'Guest',avatar:null}}));
 const Panel=editor.Panel;
 return <Stack><Text fw={600}>Participants</Text>{Number.isInteger(descriptor.minParticipants) && Number.isInteger(descriptor.maxParticipants) && <Text size="sm">Allowed participants: {descriptor.minParticipants}–{descriptor.maxParticipants}</Text>}<label><input type="radio" name={`selection-${item.uid}`} checked={setup.participants.mode==='plan'} disabled={readOnly || (descriptor.selectorSupport && !descriptor.selectorSupport.includes('all'))} onChange={()=>changeSelection({mode:'plan'})}/> Everyone in this plan</label><label><input type="radio" name={`selection-${item.uid}`} checked={setup.participants.mode==='explicit'} disabled={readOnly || (descriptor.selectorSupport && !descriptor.selectorSupport.includes('explicit'))} onChange={()=>changeSelection({mode:'explicit',ids:[]})}/> Choose participants</label>{setup.participants.mode==='explicit'&&<Text size="sm">Removing someone clears their individual activity settings.</Text>}{setup.participants.mode==='explicit'&&document.participants.map(p=><Checkbox key={p.id} label={p.display?.name || p.person?.id || 'Guest'} checked={setup.participants.ids.includes(p.id)} disabled={readOnly} onChange={e=>changeSelection({mode:'explicit',ids:e.currentTarget.checked?[...setup.participants.ids,p.id]:setup.participants.ids.filter(id=>id!==p.id)})}/>)}<Panel settings={setup.settings} participants={selected} readOnly={readOnly} onChange={settings=>update({settings})}/></Stack>;
}
