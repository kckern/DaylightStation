// @vitest-environment node
import {describe,it,expect,beforeEach,afterEach} from 'vitest';
import {ReadWorkContext} from './ReadWorkContext.mjs';
import {resolveWorkPolicy} from '../adapters/WorkConfig.mjs';
import {harness,commit,relevance,ref,refKey,snapshot,item} from '../../../../../tests/_lib/work/stateHarness.mjs';
import {AS_OF} from '../../../../../tests/_lib/work/observations.mjs';
let h;beforeEach(()=>{h=harness();});afterEach(async()=>{await h.close();});
const configuration={work:{enabled:true,providers:{personal:{type:'todoist',accountId:'personal',authScope:'user',operations:['read']}},domains:{personal:{provider:'personal',containerId:'sample-project',role:'tasks',autoComplete:'linked_explicit'}},users:{sample:{},other:{}}}};
function setup({view=snapshot(),config=configuration}={}){const store=h.make(),principal=Object.freeze({username:'sample',authored:true}),verifyPrincipal=p=>p===principal?p:null;const provider={readSnapshot:async()=>view,getItem:async({ref:r})=>r.accountId==='personal'?item():null};const context=new ReadWorkContext({state:store,providers:new Map([['["todoist","personal"]',provider]]),resolvePolicy:username=>resolveWorkPolicy({configuration:config,username,timezone:'America/Los_Angeles'}),verifyPrincipal});return {store,principal,context};}
describe('work context and explicit links',()=>{
 it('treats imported/old source facts as unconfirmed and keeps pauses through refresh',async()=>{const {store,context}=setup();expect((await context.execute({username:'sample',asOf:AS_OF})).relevance[refKey].state).toBe('unconfirmed');await commit(store,'pause',[relevance()]);expect((await context.execute({username:'sample',asOf:AS_OF+1000})).relevance[refKey].state).toBe('paused');expect((await context.execute({username:'other',asOf:AS_OF})).relevance[refKey].state).toBe('unconfirmed');});
 it('confirms one stable link once and never silently replaces its relation',async()=>{const {context,principal,store}=setup();const args={principal,kbObjectId:'loop.sample',workRef:ref,relation:'action_for',basisRefs:['journalist:msg:sample'],expectedRevision:(await store.read({username:'sample'})).revision,asOf:AS_OF};expect((await context.confirmLink(args)).applied).toBe(true);expect((await context.confirmLink(args)).applied).toBe(false);expect(Object.keys((await store.read({username:'sample'})).links)).toHaveLength(1);await expect(context.confirmLink({...args,relation:'same_commitment'})).rejects.toMatchObject({code:'WORK_LINK_CONFLICT'});});
 it('rejects copied principals and another account before writing any link',async()=>{const {context,principal,store}=setup();const args={principal:{...principal},kbObjectId:'loop.sample',workRef:ref,relation:'same_commitment',basisRefs:[],asOf:AS_OF,expectedRevision:(await store.read({username:'sample'})).revision};await expect(context.confirmLink(args)).rejects.toMatchObject({code:'WORK_PRINCIPAL_REQUIRED'});await expect(context.confirmLink({...args,principal,workRef:{...ref,accountId:'other-account'}})).rejects.toMatchObject({code:'WORK_REF_NOT_AVAILABLE'});expect(Object.keys((await store.read({username:'sample'})).links)).toHaveLength(0);});
 it('retains last known facts as unavailable context when a provider read fails or is too old',async()=>{const missing=snapshot({items:[],coverage:{complete:false,reason:'snapshot_missing'},revision:'unavailable'}),{context,store}=setup({view:missing});await commit(store,'known',[{type:'snapshot.observed',provider:'todoist',accountId:'personal',snapshot:snapshot()}]);const view=await context.execute({username:'sample',asOf:AS_OF+25*3600000});expect(view.items[0].title).toBe('Contact Sample');expect(view.coverage.complete).toBe(false);});
 it('does not select the first domain for an unknown domain request',async()=>{const {context}=setup();const view=await context.execute({username:'sample',domainIds:['missing'],asOf:AS_OF});expect(view.items).toEqual([]);expect(view.coverage.reason).toBe('unconfigured_domain');});
});
it('uses canonical reference identity for idempotent links even if a caller includes display metadata',async()=>{
 const {context,principal,store}=setup();const args={principal,kbObjectId:'loop.sample',workRef:ref,relation:'action_for',basisRefs:[],expectedRevision:(await store.read({username:'sample'})).revision,asOf:AS_OF};
 await context.confirmLink(args);expect((await context.confirmLink({...args,workRef:{...ref,label:'Display name'}})).applied).toBe(false);expect(Object.keys((await store.read({username:'sample'})).links)).toHaveLength(1);
});
it('carries scoped completion evidence through the real provider reader into read context',async()=>{
 const {TodoistWorkProvider}=await import('../adapters/TodoistWorkProvider.mjs');
 const resolvePolicy=username=>resolveWorkPolicy({configuration,username,timezone:'America/Los_Angeles'});
 const current={accountId:'personal',observedAt:AS_OF,coverage:{complete:true,scope:{accountId:'personal'},from:AS_OF-86400000,to:AS_OF,reason:null},tasks:[],containers:[]};
 const provider=new TodoistWorkProvider({accountId:'personal',resolvePolicy,loadCurrent:async()=>current,loadHistory:async()=>({'2026-11-17':[{id:'sample-task',accountId:'personal',provider:'todoist',projectId:'sample-project',action:'completed',occurredAt:AS_OF-3600000,occurrenceId:'sample-occurrence',assigneeIds:[]} ]})});
 const context=new ReadWorkContext({state:h.make(),providers:new Map([['["todoist","personal"]',provider]]),resolvePolicy,verifyPrincipal:()=>null});
 const result=await context.execute({username:'sample',asOf:AS_OF});expect(result.events).toHaveLength(1);expect(result.events[0].ref.id).toBe('sample-task');
});
it.each(['live','saved'])('does not leak %s snapshot observations newer than the requested as-of',async mode=>{
 const future=snapshot({observedAt:AS_OF+60000}),{context,store}=setup({view:mode==='live'?future:snapshot({items:[],coverage:{complete:false,reason:'snapshot_missing'}})});
 if(mode==='saved')await commit(store,'future',[{type:'snapshot.observed',provider:'todoist',accountId:'personal',snapshot:future}]);
 const result=await context.execute({username:'sample',asOf:AS_OF});expect(result.items).toEqual([]);expect(result.coverage.complete).toBe(false);
});
