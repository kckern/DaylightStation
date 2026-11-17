import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as FileIO from '#system/utils/FileIO.mjs';
import {JsonlWorkState} from '../../../__app_modules/personal/work/server/adapters/JsonlWorkState.mjs';
import {WorkWriteAuthority} from '../../../__app_modules/personal/work/server/adapters/WorkWriteAuthority.mjs';
import {AS_OF,quiet} from './observations.mjs';
export const role={enabled:true,write:true,writer_env:'fixture-prod',writer_host:'fixture-writer'};
export const ref={provider:'todoist',accountId:'personal',kind:'task',id:'sample-task'};
export const refKey='["todoist","personal","task","sample-task"]';
export function relevance(state='paused',patch={}){return {type:'relevance.changed',ref,relevance:{key:refKey,state,confirmedAt:AS_OF,reviewAt:null,snoozedUntil:null,lastOfferedAt:null,ignoredOffers:0,...patch}};}
export function item(patch={}){return {ref:{...ref},title:'Contact Sample',description:null,status:{native:'open',category:'open'},containerRef:{...ref,kind:'container',id:'sample-project'},ancestorRefs:[],createdAt:Date.parse('2021-04-20T11:26:56.521Z'),modifiedAt:null,completedAt:null,due:null,assigneeIds:[],url:null,observedAt:AS_OF,version:'item-v1',...patch};}
export function snapshot(patch={}){return {items:[item()],containers:[],events:[],observedAt:AS_OF,coverage:{complete:true,scope:{accountId:'personal',containerIds:['sample-project'],assigneeIds:null},from:AS_OF-86400000,to:AS_OF,reason:null},revision:'source-v1',...patch};}
export function harness(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'work-state-')),resources=[];
 const rootForUser=user=>path.join(root,user,'work');
 const make=(options={})=>{const authority=options.authority??new WorkWriteAuthority({configuration:role,environment:'fixture-prod',hostId:'fixture-writer',logger:quiet});const store=new JsonlWorkState({rootForUser,authority,io:FileIO,clock:()=>AS_OF,logger:quiet,...options});resources.push(store);return store;};
 return {root,rootForUser,make,async close(){for(const resource of resources)await resource.close();fs.rmSync(root,{recursive:true,force:true});}};
}
export async function commit(store,id,events,username='sample'){
 const current=await store.read({username});return store.transact({username,id,expectedRevision:current.revision,events,asOf:AS_OF});
}
