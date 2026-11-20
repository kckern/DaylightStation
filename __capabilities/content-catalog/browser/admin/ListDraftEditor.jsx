import React, { useCallback, useMemo, useState } from 'react';
import { Button, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import ListsItemRow from './ListsItemRow.jsx';
import ListsItemEditor from './ListsItemEditor.jsx';
import { ListsContext } from './ListsContext.js';
import './ContentLists.scss';
import { ITEM_DEFAULTS } from './listConstants.js';

const actions = ['play','queue','list','display','launch','open'];
function presentation(item, index) {
  const action = actions.find(key => item[key]);
  const payload = item[action];
  return {...item, index, label:item.label || item.title || '', action:action ? action[0].toUpperCase()+action.slice(1) : 'Play', input:action === 'open' ? `app:${payload}` : (typeof payload === 'string' ? payload : payload?.contentId) || item.input || ''};
}
function changesFor(item, changes) {
  const result = {...changes};
  delete result.uid; delete result.index;
  if ('label' in result && item.label == null) { result.title = result.label; delete result.label; }
  if ('action' in result || 'input' in result) {
    const view = {...presentation(item, 0), ...changes};
    for (const action of actions) result[action] = undefined;
    const selected = view.action.toLowerCase();
    const action = actions.includes(selected) ? selected : 'play';
    const prior = item[action];
    const input = action === 'open' ? view.input.replace(/^app:\s*/, '') : view.input;
    result[action] = action === 'open' ? input : (prior && typeof prior === 'object' ? {...prior, contentId:input} : {contentId:input});
    delete result.action; delete result.input;
  }
  return result;
}
/** Emits UID-addressed list commands; the parent owns all mutations and IDs. */
export default function ListDraftEditor({list, onEdit, renderItemSettings, readOnly = false}) {
  const [editing, setEditing] = useState(null);
  const [cache, setCache] = useState(new Map());
  const editingView = useMemo(() => editing?.item ? presentation(editing.item, 0) : null, [editing]);
  const sections = list.sections || [];
  const flatItems = useMemo(() => sections.flatMap((section, sectionIndex) =>
    section.items.map((item, itemIndex) => ({ ...presentation(item, itemIndex), sectionIndex, itemIndex }))
  ), [sections]);
  const setContentInfo = useCallback((id, info) => setCache(old => new Map(old).set(id,info)), []);
  const context = useMemo(() => ({sections,flatItems,contentInfoMap:cache,setContentInfo,inUseImages:new Set()}),[sections,flatItems,cache,setContentInfo]);
  const sensors = useSensors(useSensor(PointerSensor),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const emit = edit => { if (!readOnly) onEdit(edit); };
  const move = (section,index,direction) => {
    const item=section.items[index];
    if (direction === 'up' && index > 0) emit({type:'move-item',itemUid:item.uid,beforeUid:section.items[index-1].uid});
    if (direction === 'down' && index < section.items.length-1) emit({type:'move-item',itemUid:item.uid,beforeUid:section.items[index+2]?.uid ?? null});
  };
  const collisionDetection = args => {
    const kind = String(args.active.id).split(':')[0];
    return closestCenter({...args, droppableContainers:args.droppableContainers.filter(container => String(container.id).startsWith(`${kind}:`) && container.id !== args.active.id)});
  };
  const dragEnd = ({active,over}) => {
    if (readOnly || !over || active.id === over.id) return;
    const parse = id => { const match = String(id).match(/^(row|content):(.*)$/); if (!match) return null; for (let section=0;section<sections.length;section++) { const index=sections[section].items.findIndex(item=>item.uid===match[2]); if (index>=0) return {type:match[1],section,index}; } return null; };
    const a=parse(active.id), b=parse(over.id);
    if (!a || !b || a.type !== b.type) return;
    const first=sections[a.section]?.items[a.index], second=sections[b.section]?.items[b.index];
    if (!first || !second || first.uid === second.uid) return;
    if (a.type === 'content') emit({type:'swap-items',firstUid:first.uid,secondUid:second.uid});
    else emit({type:'move-item',itemUid:first.uid,...(a.section !== b.section ? {toSectionUid:sections[b.section].uid}:{}),beforeUid:a.section === b.section && a.index < b.index ? sections[b.section].items[b.index+1]?.uid ?? null : second.uid});
  };
  return <ListsContext.Provider value={context}><Stack className="lists-view"><DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={dragEnd}><Stack>{sections.map((section, si) => <section key={section.uid} className="section-container">
    <Group><TextInput aria-label={`Section ${si+1} title`} value={section.title || ''} readOnly={readOnly} onChange={e=>emit({type:'update-section',sectionUid:section.uid,changes:{title:e.currentTarget.value}})}/>{!readOnly && <><Button size="xs" onClick={()=>emit({type:'delete-section',sectionUid:section.uid})}>Delete section</Button><Button size="xs" onClick={()=>emit({type:'duplicate-section',sectionUid:section.uid})}>Duplicate section</Button><Button size="xs" disabled={si===0} onClick={()=>emit({type:'move-section',sectionUid:section.uid,beforeUid:sections[si-1].uid})}>Move section up</Button><Button size="xs" disabled={si===sections.length-1} onClick={()=>emit({type:'move-section',sectionUid:section.uid,beforeUid:sections[si+2]?.uid ?? null})}>Move section down</Button></>}</Group>
    <SortableContext items={section.items.map(item=>`row:${item.uid}`)} strategy={verticalListSortingStrategy}><div className="items-container">{section.items.map((item,index) => {const view=presentation(item,index), label=view.label || `item ${index+1}`; return <div key={item.uid}>
      <div inert={readOnly ? '' : undefined}><ListsItemRow dragId={item.uid} allowSublistNavigation={false} allowNewSection={false} item={view} sectionIndex={si} sectionCount={sections.length} sections={sections} itemCount={section.items.length} onUpdate={changes=>emit({type:'update-item',itemUid:item.uid,changes:changesFor(item,changes)})} onToggleActive={()=>emit({type:'update-item',itemUid:item.uid,changes:{active:item.active === false}})} onDelete={()=>emit({type:'delete-item',itemUid:item.uid})} onDuplicate={()=>emit({type:'duplicate-item',itemUid:item.uid})} onEdit={()=>!readOnly && setEditing({item,sectionUid:section.uid})} onMoveItem={(action,target)=>{if(action==='top' && index) emit({type:'move-item',itemUid:item.uid,beforeUid:section.items[0].uid}); if(action==='bottom' && index<section.items.length-1) emit({type:'move-item',itemUid:item.uid,beforeUid:null}); if(action==='section') emit({type:'move-item',itemUid:item.uid,toSectionUid:sections[target].uid,beforeUid:null});}} /></div>
      {!readOnly && <Group gap="xs"><Button size="xs" variant="subtle" disabled={index===0} onClick={()=>move(section,index,'up')}>Move {label} up</Button><Button size="xs" variant="subtle" disabled={index===section.items.length-1} onClick={()=>move(section,index,'down')}>Move {label} down</Button><Button size="xs" variant="subtle" onClick={()=>setEditing({item,sectionUid:section.uid})}>Edit {label}</Button><Button size="xs" variant="subtle" onClick={()=>emit({type:'delete-item',itemUid:item.uid})}>Delete {label}</Button><Select aria-label={`Swap ${label} with`} placeholder="Swap with" value={null} data={sections.flatMap(s=>s.items.filter(other=>other.uid!==item.uid).map(other=>({value:other.uid,label:other.label || other.title || other.uid})))} onChange={uid=>uid && emit({type:'swap-items',firstUid:item.uid,secondUid:uid})}/></Group>}
      {renderItemSettings?.({item,readOnly})}</div>; })}</div></SortableContext>
    {!readOnly && <Button size="xs" onClick={()=>setEditing({item:null,sectionUid:section.uid})}>Add item</Button>}</section>)}</Stack></DndContext>
    {!readOnly && <Button onClick={()=>emit({type:'add-section',section:{title:'New section',items:[]}})}>Add section</Button>}
    <ListsItemEditor hideSection preserveImageClear opened={!!editing && !readOnly} item={editingView} sections={sections} onClose={()=>setEditing(null)} onSave={payload=>{if(editing.item) { const defaults = Object.fromEntries(Object.keys(ITEM_DEFAULTS).filter(k=>k !== 'action').map(k=>[k, payload[k] ?? ITEM_DEFAULTS[k]])); emit({type:'update-item',itemUid:editing.item.uid,changes:changesFor(editing.item,{...defaults,...payload,action:payload.action || 'Play'})}); } else emit({type:'add-item',sectionUid:editing.sectionUid,item:changesFor({},payload)}); setEditing(null);}}/>
  </Stack></ListsContext.Provider>;
}
