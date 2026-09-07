import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadYaml, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { MealFoodCommands } from './MealFoodCommands.mjs';
import { HealthOperations } from './HealthOperations.mjs';
import { validateCleanup } from '#domains/nutrition/services/cleanupPolicy.mjs';
let root, store, commands;
const date = '2026-09-06';
const base = {date,bucket:'evening'};
const id = row => row.uuid || row.id;
const food = uuid => ({uuid,userId:'u',name:uuid,date,mealTime:'evening',grams:12.345,unit:'g',amount:12.345,calories:23.456,protein:1.234,photoRef:'photo',nutrientProvenance:{protein:{source:'user'}}});
const rows = () => store.findByDate('u',date);
const versions = async () => Object.fromEntries((await rows()).map(r=>[id(r),r.version??1]));
const execute = async (action, extra={}) => commands.execute('u',{...base,action,operationId:`op-${action}`,selectedIds:['a','b'],expectedVersions:await versions(),...extra});
beforeEach(async()=> {root=fs.mkdtempSync(path.join(os.tmpdir(),'meal-command-'));store=new YamlNutriListDatastore({dataService:{user:{resolveDir:rel=>path.join(root,rel)}},logger:{info(){},warn(){}}}); commands=new MealFoodCommands({nutritionItems:store});await store.saveMany(['a','b','c'].map(food));});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
describe('reversible meal commands',()=>{
 it('groups, changes membership, and ungroups without changing any nutrition or metadata',async()=>{
  const before=await rows(); const grouped=await execute('group',{name:'Soup'});const group=grouped.items.find(r=>r.kind==='group');
  expect(group).toMatchObject({calories:0,protein:0});
  await execute('membership',{groupId:id(group),selectedIds:['b','c']});
  expect((await rows()).find(r=>id(r)==='a').parentId).toBeNull();
  const removed=await execute('ungroup',{groupId:id(group),selectedIds:[]});
  expect(removed.undoToken).toBeTruthy();expect(await rows()).toHaveLength(3);
  for(const row of await rows()) {const original=before.find(r=>id(r)===id(row)); expect({...row,parentId:undefined,version:undefined}).toEqual({...original,parentId:undefined,version:undefined});}
 });
 it('restores exact stored fields and prevents Undo overwriting later changes',async()=>{
  const before=await rows(); const result=await execute('group',{name:'Soup'});
  const undone=await commands.undo('u',{undoToken:result.undoToken,operationId:'undo-a'});
  expect(undone.entryIds).toContain('a');
  expect(await rows()).toEqual(before.map(r=>['a','b'].includes(id(r))?{...r,version:3}:r));
  expect(await commands.undo('u',{undoToken:result.undoToken,operationId:'undo-a'})).toEqual(undone);
  const next=await execute('group',{name:'Soup',operationId:'group-next'});await store.update('u','a',{calories:100});
  await expect(commands.undo('u',{undoToken:next.undoToken,operationId:'undo-b'})).rejects.toMatchObject({status:409});
 });
 it('rejects stale versions, cross-meal selections, and nested groups atomically',async()=>{
  await expect(execute('group',{name:'Soup',expectedVersions:{a:99,b:1}})).rejects.toMatchObject({status:409});
  await store.update('u','b',{mealTime:'morning'});
  await expect(execute('group',{name:'Soup',operationId:'cross'})).rejects.toMatchObject({status:400});
  expect((await rows()).filter(r=>r.kind==='group')).toHaveLength(0);
 });
 it('replays the exact Undo token after a commit whose response could not be saved',async()=>{
  const input={...base,action:'group',name:'Soup',operationId:'retry',selectedIds:['a','b'],expectedVersions:await versions()};
  const result=await commands.execute('u',input);
  const file=path.join(root,'lifelog/nutrition/ledger-operations');const operations=loadYaml(file);delete operations.retry.result;operations.retry.pending=true;saveYamlToPathAtomic(file+'.yml',operations);
  commands=new MealFoodCommands({nutritionItems:store});expect(await commands.execute('u',input)).toEqual(result);expect(await rows()).toHaveLength(4);
 });
 it('applies multiple proposals atomically and one Undo reverses all groups',async()=>{
  await store.saveMany([food('d')]);const input={groups:[{name:'First',selectedIds:['a','b']},{name:'Second',selectedIds:['c','d']}],selectedIds:['a','b','c','d']};
  const before=await rows();const result=await execute('groups',input);
  expect((await rows()).filter(r=>r.kind==='group')).toHaveLength(2);
  expect(loadYaml(path.join(root,'lifelog/nutrition/nutriday'))[date].calories).toBeCloseTo(before.reduce((sum,r)=>sum+r.calories,0),10);
  await commands.undo('u',{undoToken:result.undoToken,operationId:'undo-groups'});expect(await rows()).toEqual(before.map(r=>({...r,version:3})));
  await expect(execute('groups',{...input,operationId:'overlap',groups:[input.groups[0],{name:'Second',selectedIds:['a','c']}]})).rejects.toMatchObject({status:400});
  expect((await rows()).filter(r=>r.kind==='group')).toHaveLength(0);
 });
 it('reassignment removes only the emptied header and Undo restores it without reverting unrelated edits',async()=>{
  const first=await execute('group',{name:'Old'});const group=id(first.items.find(r=>r.kind==='group'));const before=await rows();
  const moved=await execute('group',{name:'New',operationId:'move'});expect((await rows()).some(r=>id(r)===group)).toBe(false);
  await store.update('u','c',{calories:777});await commands.undo('u',{undoToken:moved.undoToken,operationId:'undo-move'});
  expect((await rows()).find(r=>id(r)===group)).toMatchObject({name:'Old'});expect((await rows()).find(r=>id(r)==='c').calories).toBe(777);
  for (const key of ['a','b']) expect((await rows()).find(r=>id(r)===key)).toEqual({...before.find(r=>id(r)===key),version:4});
 });
 it('rejects nested membership and Undo when another food was attached to its new parent',async()=>{
  const grouped=await execute('group',{name:'Soup'});const group=id(grouped.items.find(r=>r.kind==='group'));
  await expect(execute('group',{operationId:'nested',name:'Nested',selectedIds:[group,'c']})).rejects.toMatchObject({status:400});
  await store.update('u','c',{parentId:group});await expect(commands.undo('u',{undoToken:grouped.undoToken,operationId:'undo-extra-child'})).rejects.toMatchObject({status:409});
  expect((await rows()).find(r=>id(r)==='a').parentId).toBe(group);
 });
 it('records capture Undo after a recovered commit and removes only new unedited foods',async()=>{
  await expect(store.runOperation('u','capture-new',{type:'voice'},async()=>{
    await store.saveMany([food('new-food')]);throw new Error('Lost response');
  })).rejects.toThrow('Lost response');
  const recovered=await store.runOperation('u','capture-new',{type:'voice'},()=>{throw new Error('Parser must not run');});
  const operations=new HealthOperations({nutritionItems:store});
  const attached=await operations.attachNutritionCaptureUndo('u','capture-new',recovered);
  const token={undoToken:attached.undoToken};
  const input={operationId:'capture-new',entryIds:['new-food']};
  expect(await store.recordCaptureUndo('u',input)).toEqual(token);
  await commands.undo('u',{...token,operationId:'undo-new'});
  expect((await rows()).map(id)).toEqual(['a','b','c']);
  await store.saveMany([food('changed-new')]);const second=await store.recordCaptureUndo('u',{operationId:'capture-changed',entryIds:['changed-new']});
  await store.update('u','changed-new',{calories:999});await expect(commands.undo('u',{...second,operationId:'undo-changed'})).rejects.toMatchObject({status:409});
 });
 it('scales quantity-only amendments precisely and protects corrected fields from cleanup',async()=>{
  await store.update('u','a',{grams:300,amount:300,calories:90,protein:7.12345,fiber:0.12345,settled:false});
  const before=await store.findByUuid('u','a');
  const result=await execute('amend',{selectedIds:['a'],changes:{a:{grams:150}}});
  const amended=await store.findByUuid('u','a');
  expect(amended).toMatchObject({grams:150,amount:150,calories:45,protein:3.561725,fiber:0.061725,manualFields:expect.arrayContaining(['grams','amount','calories','protein','fiber'])});
  expect(()=>validateCleanup({before:[amended],after:[{...amended,calories:90}],updates:[{id:'a',changes:{calories:90},expectedVersion:amended.version}],
    now:Date.parse('2026-09-06T18:00:00Z'),timezone:'UTC',userId:'u'})).toThrowError(expect.objectContaining({code:'CLEANUP_USER_PROTECTED'}));
  await commands.undo('u',{undoToken:result.undoToken,operationId:'undo-half'});
  expect(await store.findByUuid('u','a')).toEqual({...before,version:4});
 });
 it('scales same-unit serving amendments, while validated explicit nutrient values take precedence',async()=>{
  await store.update('u','a',{grams:null,amount:2,unit:'serving',calories:90,protein:6});
  await execute('amend',{selectedIds:['a'],changes:{a:{amount:1,unit:'serving',calories:44.321}}});
  expect(await store.findByUuid('u','a')).toMatchObject({grams:null,amount:1,unit:'serving',calories:44.321,protein:3});
 });
 it('preserves serving units when scaling an amount with a known gram weight',async()=>{
  await store.update('u','a',{grams:300,amount:1,unit:'serving',calories:90,protein:6});
  const before=await store.findByUuid('u','a');
  const result=await execute('amend',{selectedIds:['a'],changes:{a:{amount:2}}});
  expect(await store.findByUuid('u','a')).toMatchObject({grams:600,amount:2,unit:'serving',calories:180,protein:12});
  await commands.undo('u',{undoToken:result.undoToken,operationId:'undo-servings'});
  expect(await store.findByUuid('u','a')).toEqual({...before,version:4});
 });
 it('adds potatoes to broth with a zero parent, then restores original food exactly',async()=>{
  const before=await rows();const result=await execute('amend',{selectedIds:['a'],additions:[{name:'Potatoes',grams:50.125,calories:40.25,parentId:'a'}]});
  const after=await rows();expect(after.filter(r=>r.kind==='group')).toHaveLength(1);expect(after.find(r=>id(r)==='a').calories).toBe(before[0].calories);
  expect(after.filter(r=>r.kind!=='group').reduce((s,r)=>s+r.calories,0)).toBeCloseTo(before.reduce((s,r)=>s+r.calories,0)+40.25,10);
  await commands.undo('u',{undoToken:result.undoToken,operationId:'undo-amend'});expect(await rows()).toEqual(before.map(r=>id(r)==='a'?{...r,version:3}:r));
 });
});
