import { expect, it } from 'vitest';
import { planDraftReducer } from './planDraftReducer.js';

const plan = {participants:[], list:{sections:[{uid:'s',items:[{uid:'a',title:'One',play:'one'},{uid:'b',title:'Two',play:'two'}]}]}, activity_settings:{}};
it('stages UID-based reorder locally and retains it on conflict', () => {
  let state = planDraftReducer(null,{type:'load',document:plan,etag:'"one"'});
  state = planDraftReducer(state,{type:'edit',command:{type:'move-item',itemUid:'b',beforeUid:'a'}});
  expect(state.draft.list.sections[0].items.map(i=>i.uid)).toEqual(['b','a']);
  expect(plan.list.sections[0].items.map(i=>i.uid)).toEqual(['a','b']);
  state = planDraftReducer(state,{type:'conflict'});
  expect(state).toMatchObject({dirty:true,baseEtag:'"one"',conflict:true});
  expect(state.draft.list.sections[0].items[0].uid).toBe('b');
});
it('requires explicit confirmation before clearing a binding when the target changes',()=>{
 const aware=structuredClone(plan);aware.list.sections[0].items[0]={uid:'a',title:'Game',open:'game'};aware.activity_settings.a={schema:'agenda-activity-setup/v1',action:'open',participants:{mode:'plan'},consumer:{id:'game',version:1},settings:{}};
 const state=planDraftReducer(null,{type:'load',document:aware,etag:'"one"'});
 const command={type:'update-item',itemUid:'a',changes:{open:'other'}};
 const rejected=planDraftReducer(state,{type:'edit',command});expect(rejected.draft).toEqual(aware);expect(rejected.fieldErrors[0].message).toMatch(/confirm/i);
 const accepted=planDraftReducer(state,{type:'edit',command,clearChangedBinding:true});expect(accepted.draft.activity_settings.a).toBeUndefined();expect(accepted.draft.list.sections[0].items[0].open).toBe('other');
});
it('detects a stale consumer binding after authoritative discovery',async()=>{
 const {bindingErrors}=await import('./ActivitySettings.jsx');
 const doc=structuredClone(plan);doc.activity_settings.a={action:'play',consumer:{id:'old',version:1}};
 expect(bindingErrors(doc,{a:null})).toEqual([{field:'activity_settings.a',message:'The participant consumer no longer matches this activity'}]);
});
it('rejects a saved event scoped to a different current plan',()=>{
 const current=planDraftReducer(null,{type:'load',document:{...plan,plan_id:'q'},etag:'"q"',scope:'q'});
 expect(planDraftReducer(current,{type:'saved',document:{...plan,plan_id:'p'},etag:'"p"',scope:'p'})).toEqual(current);
});
it('rejects a stale rebase from an earlier visit to the same plan',()=>{
 const current=planDraftReducer(null,{type:'load',document:plan,etag:'"new"',scope:'p',generation:2});
 expect(planDraftReducer(current,{type:'rebase',etag:'"old"',scope:'p',generation:0})).toEqual(current);
});
