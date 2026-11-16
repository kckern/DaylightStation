import { describe, it, expect } from 'vitest';
import { validateSeries, validatePlan } from './contracts.mjs';
import { createPlan, copyPlan } from './copyPlan.mjs';
import { applyPlanEdit } from '../../portable/planEdits.mjs';
const series = { schema:'agenda-series/v1', series_id:'family', household_id:'home', revision:3, title:'Together', calendar:{frequency:'weekly',timezone:'America/Los_Angeles',week_starts_on:'monday',default_day:'monday'}, status:'active', defaults:{ participants:[{id:'r1',person:{kind:'user',id:'u'}}], list:{title:'Together',sections:[{uid:'s1',items:[{uid:'i1',title:'Game',open:'games/example'},{uid:'i2',title:'Song',play:{contentId:'song'}}]}]}, activity_settings:{i1:{schema:'agenda-activity-setup/v1',action:'open',participants:{mode:'explicit',ids:['r1']},consumer:{id:'games',version:1},settings:{keys:{r1:'text'}}}} } };
let n = 0;
const ids = () => { return Object.fromEntries(['plan','section','item','rosterEntry'].map(k => [k, () => `${k}_${++n}`])); };
const remapActivitySettings = ({settings,participantKeyMap}) => ({keys:Object.fromEntries(Object.entries(settings.keys).filter(([k]) => participantKeyMap[k] !== null).map(([k,v]) => [participantKeyMap[k] ?? k,v]))});
const make = () => createPlan({series,weekOf:'2026-11-16',ids:ids(),displaySnapshots:{'user:u':{name:'User',avatar:null}},remapActivitySettings});
describe('Agenda documents', () => {
  it('validates references, schedule, unknown fields and compatible activity actions', () => {
    expect(validateSeries(series).valid).toBe(true);
    const p = make();
    expect(validatePlan(p,{purpose:'publish'}).valid).toBe(true);
    expect(validatePlan({...p, scheduled_on:'2026-11-23'},{purpose:'draft'}).valid).toBe(false);
    expect(validatePlan({...p, unexpected:true},{purpose:'draft'}).valid).toBe(false);
    const bad = structuredClone(p); bad.activity_settings[bad.list.sections[0].items[0].uid].action = 'play';
    expect(validatePlan(bad,{purpose:'draft'}).valid).toBe(false);
  });
  it('copies fresh identifiers and remaps ordered bindings without mutating the source', () => {
    const p = make(), before = structuredClone(p);
    const result = copyPlan({source:p,targetWeek:'2026-11-23',series,ids:ids(),remapActivitySettings});
    expect(p).toEqual(before);
    expect(result.plan.participants[0].id).not.toBe(p.participants[0].id);
    const oldItem = p.list.sections[0].items[0].uid, newItem = result.idMap.itemUidMap[oldItem];
    expect(result.plan.activity_settings[newItem].participants.ids).toEqual([result.plan.participants[0].id]);
    expect(result.plan.activity_settings[newItem].settings.keys).toEqual({[result.plan.participants[0].id]:'text'});
    expect(result.plan.state).toBe('draft');
  });
  it('deletes item bindings and participant selectors without mutating the original', () => {
    const p = make(); const item = p.list.sections[0].items[0].uid;
    const withoutItem = applyPlanEdit(p,{type:'delete-item',itemUid:item},{ids:ids(),remapActivitySettings});
    expect(withoutItem.activity_settings[item]).toBeUndefined();
    const withoutPerson = applyPlanEdit(p,{type:'delete-participant',participantId:p.participants[0].id},{ids:ids(),remapActivitySettings});
    expect(withoutPerson.activity_settings[item].participants.ids).toEqual([]);
    expect(p.participants).toHaveLength(1);
  });
  it('requires saved displays for named template entries', () => {
    expect(() => createPlan({series,weekOf:'2026-11-16',ids:ids(),remapActivitySettings})).toThrow();
  });
});
describe('binding invariants', () => {
  it('rejects dangling settings and mismatched actions during an edit', () => {
    const p = make(), item = p.list.sections[0].items[0].uid;
    const bad = structuredClone(p); bad.activity_settings.missing = bad.activity_settings[item];
    expect(() => applyPlanEdit(bad,{type:'delete-item',itemUid:item},{ids:ids(),remapActivitySettings})).toThrow();
    expect(() => applyPlanEdit(p,{type:'update-item',itemUid:item,changes:{open:undefined}},{ids:ids(),remapActivitySettings})).toThrow();
  });
  it('moves setup with swapped content and copies setup when duplicated', () => {
    const p = make(), [a,b] = p.list.sections[0].items;
    const swapped = applyPlanEdit(p,{type:'swap-items',firstUid:a.uid,secondUid:b.uid},{ids:ids(),remapActivitySettings});
    expect(swapped.activity_settings[a.uid]).toBeUndefined();
    expect(swapped.activity_settings[b.uid]).toEqual(p.activity_settings[a.uid]);
    const duplicate = applyPlanEdit(p,{type:'duplicate-item',itemUid:a.uid},{ids:ids(),remapActivitySettings});
    const newUid = duplicate.list.sections[0].items[2].uid;
    expect(duplicate.activity_settings[newUid]).toEqual(p.activity_settings[a.uid]);
  });
  it('allows empty explicit draft selections while rejecting duplicate participant references', () => {
    const p=make(), setup=Object.values(p.activity_settings)[0];
    setup.participants.ids=[];
    expect(validatePlan(p,{purpose:'draft'}).valid).toBe(true);
    p.participants.push({...p.participants[0],id:'another'});
    expect(validatePlan(p,{purpose:'draft'}).valid).toBe(false);
  });
  it('does not accept an allocator that returns the original plan identity', () => {
    const p = make(); const factory = ids(); factory.plan = () => p.plan_id;
    expect(() => copyPlan({source:p,targetWeek:'2026-11-23',series,ids:factory,remapActivitySettings})).toThrow();
  });
});
describe('authored action envelope', () => {
  it.each(['title', 'uid'])('rejects %s as a setup action in validation and edits', action => {
    const p = make(), item = p.list.sections[0].items[0];
    p.activity_settings[item.uid].action = action;
    expect(validatePlan(p,{purpose:'publish'}).valid).toBe(false);
    expect(() => applyPlanEdit(p,{type:'move-item',itemUid:item.uid},{ids:ids(),remapActivitySettings})).toThrow();
  });
  it('rejects multiple authored actions even without activity settings', () => {
    const p = make(), item = p.list.sections[0].items[1];
    item.open = 'games/example';
    expect(validatePlan(p,{purpose:'draft'}).valid).toBe(false);
    expect(() => applyPlanEdit(p,{type:'move-item',itemUid:item.uid},{ids:ids(),remapActivitySettings})).toThrow();
  });
  it.each(['open','play','queue','display'])('accepts a single matching %s action', action => {
    const p = make(), item = p.list.sections[0].items[0];
    delete item.open; item[action] = 'content/example';
    p.activity_settings[item.uid].action = action;
    expect(validatePlan(p,{purpose:'publish'}).valid).toBe(true);
    expect(applyPlanEdit(p,{type:'move-item',itemUid:item.uid},{ids:ids(),remapActivitySettings}).list.sections[0].items[1].uid).toBe(item.uid);
  });
  it('rejects an edit that adds a second action', () => {
    const p = make(), item = p.list.sections[0].items[0];
    expect(() => applyPlanEdit(p,{type:'update-item',itemUid:item.uid,changes:{play:'content/example'}},{ids:ids(),remapActivitySettings})).toThrow();
  });
});
it('preserves unbound non-executable list items while requiring actions for bound items', () => {
  const p = make(), item = p.list.sections[0].items[1];
  delete item.play;
  expect(validatePlan(p,{purpose:'draft'}).valid).toBe(true);
  expect(applyPlanEdit(p,{type:'move-item',itemUid:item.uid},{ids:ids(),remapActivitySettings}).list.sections[0].items).toHaveLength(2);
  p.activity_settings[item.uid] = structuredClone(Object.values(p.activity_settings)[0]);
  expect(validatePlan(p,{purpose:'draft'}).valid).toBe(false);
  expect(() => applyPlanEdit(p,{type:'move-item',itemUid:item.uid},{ids:ids(),remapActivitySettings})).toThrow();
});
it('rejects null setup actions on an unbound-shaped item in edits', () => {
  const p = make(), item = p.list.sections[0].items[1];
  delete item.play;
  p.activity_settings[item.uid] = {...structuredClone(Object.values(p.activity_settings)[0]),action:null};
  expect(() => applyPlanEdit(p,{type:'move-item',itemUid:item.uid},{ids:ids(),remapActivitySettings})).toThrow();
});
it('rejects roster edits that introduce duplicate named identities',()=>{
 const p=make(),existing=p.participants[0];
 expect(()=>applyPlanEdit(p,{type:'add-participant',participant:{person:existing.person,display:existing.display}},{ids:ids(),remapActivitySettings})).toThrow(/duplicate/i);
 const other=applyPlanEdit(p,{type:'add-participant',participant:{person:{kind:'guest',id:'visitor'},display:{name:'Visitor',avatar:null}}},{ids:ids(),remapActivitySettings});
 expect(()=>applyPlanEdit(other,{type:'update-participant',participantId:other.participants[1].id,changes:{person:existing.person}},{ids:ids(),remapActivitySettings})).toThrow(/duplicate/i);
});
it('rejects replacement allocations that collide with current draft identities',async()=>{
 const {copyContent}=await import('../../portable/copyContent.mjs');const p=make();const template=structuredClone(series.defaults);const existing=p.participants[0].id;
 expect(()=>copyContent({source:template,ids:{...ids(),rosterEntry:()=>existing},displaySnapshots:{'user:u':{name:'User',avatar:null}},remapActivitySettings,reservedIds:[existing]})).toThrow(/unique/i);
});
it.each(['duplicate-item','duplicate-section'])('retains resolved source artwork when %s allocates fresh IDs',type=>{
 const p=make(),before=structuredClone(p),section=p.list.sections[0],item=section.items[0];
 const command=type==='duplicate-item'?{type,itemUid:item.uid}:{type,sectionUid:section.uid};
 const result=applyPlanEdit(p,command,{ids:ids(),remapActivitySettings,imageRefs:{[item.uid]:'/media/img/lists/source.jpg'}});
 const copied=type==='duplicate-item'?result.list.sections[0].items[2]:result.list.sections[1].items[0];
 expect(copied.uid).not.toBe(item.uid);expect(copied.image).toBe('/media/img/lists/source.jpg');expect(p).toEqual(before);
});
it('does not treat inherited object properties as artwork references',async()=>{
 const {copyContent}=await import('../../portable/copyContent.mjs');const template=structuredClone(series.defaults);template.list.sections[0].items[1].uid='constructor';
 const copy=copyContent({source:template,ids:ids(),displaySnapshots:{'user:u':{name:'User',avatar:null}},remapActivitySettings,imageRefs:{}});
 expect(copy.list.sections[0].items[1].image).toBeUndefined();
});
