import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlAgendaRepository } from './YamlAgendaRepository.mjs';
import { AgendaPlanningService } from '../application/AgendaPlanningService.mjs';

const series = {schema:'agenda-series/v1',series_id:'family',household_id:'home',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'America/Los_Angeles',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{title:'Together',sections:[{uid:'s',items:[{uid:'i',title:'Song',play:{contentId:'files:song'}}]}]},activity_settings:{}}};
let dir, repo, service, n;
beforeEach(async () => { dir=mkdtempSync(path.join(tmpdir(),'agenda-')); n=0; repo=new YamlAgendaRepository({pathForHousehold:()=>dir}); service=new AgendaPlanningService({repository:repo,clock:()=>new Date('2026-11-16T20:00:00Z'),ids:Object.fromEntries(['plan','section','item','rosterEntry'].map(k=>[k,()=>`${k}_${++n}`])),resolveItemImage:async()=>null,validateActivities:async()=>({valid:true,errors:[]}),logger:{info(){}}}); await repo.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:null,mutate:()=>series}); });
afterEach(()=>rmSync(dir,{recursive:true,force:true}));
const create=(requestId,weekOf='2026-11-16')=>service.createPlan({householdId:'home',seriesId:'family',weekOf,requestId});
describe('atomic planning persistence',()=>{
 it('serializes same-week creation and retries the request',async()=>{const [a,b]=await Promise.all([create('a'),create('b')]); expect(a.document.plan_id).toBe(b.document.plan_id); expect((await create('a')).document.plan_id).toBe(a.document.plan_id); expect((await service.listPlans({householdId:'home',seriesId:'family'}))).toHaveLength(1);});
 it('allows one save for one etag and detects external changes',async()=>{const p=await create('a'); const save=title=>service.savePlan({householdId:'home',planId:p.document.plan_id,expectedEtag:p.etag,plan:{...p.document,title}}); const results=await Promise.allSettled([save('First'),save('Second')]); expect(results.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']); expect(results.find(r=>r.status==='rejected').reason.code).toBe('revision_conflict'); const current=await repo.readPlan({householdId:'home',planId:p.document.plan_id}); const file=path.join(dir,'agendas','series','family','plans',`${p.document.plan_id}.yml`); writeFileSync(file,JSON.stringify({...current.document,title:'Externally changed'})); await expect(service.savePlan({householdId:'home',planId:p.document.plan_id,expectedEtag:current.etag,plan:current.document})).rejects.toMatchObject({code:'revision_conflict'});});
 it('surfaces malformed documents and rejects traversal',async()=>{const p=await create('a'); writeFileSync(path.join(dir,'agendas','series','family','plans',`${p.document.plan_id}.yml`),'broken: ['); await expect(repo.readPlan({householdId:'home',planId:p.document.plan_id})).rejects.toThrow(); await expect(repo.readSeries({householdId:'home',seriesId:'../other'})).rejects.toThrow();});
});
it('persists create receipts across repository reconstruction and rejects reused request parameters',async()=>{const a=await create('retry'); const fresh=new YamlAgendaRepository({pathForHousehold:()=>dir}); const freshService=new AgendaPlanningService({repository:fresh,clock:()=>new Date('2026-11-16T20:00:00Z'),ids:Object.fromEntries(['plan','section','item','rosterEntry'].map(k=>[k,()=>`${k}_${++n}`])),resolveItemImage:async()=>null,validateActivities:async()=>({valid:true,errors:[]}),logger:{info(){}}}); expect((await freshService.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-16',requestId:'retry'})).document.plan_id).toBe(a.document.plan_id); await expect(freshService.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-23',requestId:'retry'})).rejects.toMatchObject({code:'idempotency_conflict'});});
it('serializes competing writers using different repository instances',async()=>{const p=await create('a'); const other=new YamlAgendaRepository({pathForHousehold:()=>dir}); let unblock; const pause=new Promise(r=>{unblock=r}); let entered; const started=new Promise(r=>{entered=r}); const a=repo.mutatePlan({householdId:'home',planId:p.document.plan_id,expectedEtag:p.etag,mutate:async d=>{entered(); await pause; d.title='One'; return d;}}); await started; let enteredSecond=false; const b=other.mutatePlan({householdId:'home',planId:p.document.plan_id,expectedEtag:p.etag,mutate:d=>{enteredSecond=true; return {...d,title:'Two'};}}); await new Promise(resolve=>setTimeout(resolve,20)); expect(enteredSecond).toBe(false); unblock(); const results=await Promise.allSettled([a,b]); expect(results.map(r=>r.status).sort()).toEqual(['fulfilled','rejected']); expect(results.find(r=>r.status==='rejected').reason.code).toBe('revision_conflict');});
it('preserves a complete document with an interrupted staging file',async()=>{const p=await create('a'); const dirPath=path.join(dir,'agendas','series','family','plans'); writeFileSync(path.join(dirPath,`.${p.document.plan_id}.yml.partial`),'incomplete: ['); expect((await repo.readPlan({householdId:'home',planId:p.document.plan_id})).document).toEqual(p.document); expect(await service.listPlans({householdId:'home',seriesId:'family'})).toHaveLength(1);});
it('records creation and update timestamps',async()=>{const p=await create('a'); expect(p.document.created_at).toBe('2026-11-16T20:00:00.000Z'); const saved=await service.savePlan({householdId:'home',planId:p.document.plan_id,expectedEtag:p.etag,plan:{...p.document,title:'Updated'}}); expect(saved.document.created_at).toBe(p.document.created_at); expect(saved.document.updated_at).toBe('2026-11-16T20:00:00.000Z');});
it('rejects request reuse with a different copy source, even for the same week',async()=>{const source=await create('source'); await create('retry','2026-11-23'); await expect(service.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-23',requestId:'retry',sourcePlanId:source.document.plan_id})).rejects.toMatchObject({code:'idempotency_conflict'});});
it('rejects malformed durable request receipts',async()=>{await create('a'); const requestDir=path.join(dir,'agendas','series','family','requests'); const {readdirSync}=await import('node:fs'); const file=path.join(requestDir,readdirSync(requestDir)[0]); const receipt=JSON.parse(JSON.stringify((await import('js-yaml')).default.load((await import('node:fs')).readFileSync(file,'utf8')))); writeFileSync(file,JSON.stringify({...receipt,schema:'wrong'})); await expect(create('a')).rejects.toMatchObject({code:'invalid_document'});});
it('recovers a committed plan when a crash left its receipt missing',async()=>{const original=await create('crash'); const fs=await import('node:fs'); const requestDir=path.join(dir,'agendas','series','family','requests'); fs.unlinkSync(path.join(requestDir,fs.readdirSync(requestDir)[0])); const fresh=new YamlAgendaRepository({pathForHousehold:()=>dir}); const freshService=new AgendaPlanningService({repository:fresh,clock:()=>new Date('2026-11-16T20:00:00Z'),ids:{},resolveItemImage:async()=>null,validateActivities:async()=>({valid:true,errors:[]}),logger:{info(){}}}); await expect(freshService.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-23',requestId:'crash'})).rejects.toMatchObject({code:'idempotency_conflict'}); const recovered=await freshService.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-16',requestId:'crash'}); expect(recovered.document.plan_id).toBe(original.document.plan_id); expect(fs.readdirSync(requestDir)).toHaveLength(1); expect(await fresh.listPlans({householdId:'home',seriesId:'family'})).toHaveLength(1);});
it('recovers an already committed create after the series is archived',async()=>{const p=await create('crash'); const fs=await import('node:fs'); const requestDir=path.join(dir,'agendas','series','family','requests'); fs.unlinkSync(path.join(requestDir,fs.readdirSync(requestDir)[0])); const s=await repo.readSeries({householdId:'home',seriesId:'family'}); await service.archiveSeries({householdId:'home',seriesId:'family',expectedEtag:s.etag}); expect((await create('crash')).document.plan_id).toBe(p.document.plan_id);});
it('preserves the original seed identity across saves',async()=>{const p=await create('a'); await expect(service.savePlan({householdId:'home',planId:p.document.plan_id,expectedEtag:p.etag,plan:{...p.document,seeded_from:{kind:'plan',id:'different',revision:0}}})).rejects.toMatchObject({code:'invalid_document'});});
it('a pending losing request keeps its input after a crash before receipt completion',async()=>{await create('winner'); const fs=await import('node:fs'); const {createHash}=await import('node:crypto'); const token=createHash('sha256').update(JSON.stringify(['home','family','loser'])).digest('hex'); const file=path.join(dir,'agendas','series','family','requests',`${token}.yml`); fs.writeFileSync(file,JSON.stringify({schema:'agenda-create-request/v1',household_id:'home',series_id:'family',week_of:'2026-11-16',source_plan_id:null,plan_id:null})); await expect(create('loser','2026-11-23')).rejects.toMatchObject({code:'idempotency_conflict'}); const recovered=await create('loser'); expect(recovered.document.week_of).toBe('2026-11-16'); expect(await service.listPlans({householdId:'home',seriesId:'family'})).toHaveLength(1);});
it('recovers a pending losing request after archival without allocating another plan',async()=>{const winner=await create('winner'); const fs=await import('node:fs'); const {createHash}=await import('node:crypto'); const token=createHash('sha256').update(JSON.stringify(['home','family','loser'])).digest('hex'); const file=path.join(dir,'agendas','series','family','requests',`${token}.yml`); fs.writeFileSync(file,JSON.stringify({schema:'agenda-create-request/v1',household_id:'home',series_id:'family',week_of:'2026-11-16',source_plan_id:null,plan_id:null})); const current=await repo.readSeries({householdId:'home',seriesId:'family'}); await service.archiveSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag}); const fresh=new YamlAgendaRepository({pathForHousehold:()=>dir}); const recovered=await fresh.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-16',requestId:'loser',make:()=>{throw new Error('must not allocate');}}); expect(recovered.document.plan_id).toBe(winner.document.plan_id); const yaml=(await import('js-yaml')).default; expect(yaml.load(fs.readFileSync(file,'utf8')).plan_id).toBe(winner.document.plan_id); expect(await fresh.listPlans({householdId:'home',seriesId:'family'})).toHaveLength(1);});
it('lists validated series and pins copy request revision across retries',async()=>{const source=await create('source'); expect((await repo.listSeries({householdId:'home'})).map(x=>x.document.series_id)).toEqual(['family']); const input={householdId:'home',seriesId:'family',weekOf:'2026-11-23',requestId:'copy',sourcePlanId:source.document.plan_id,sourceRevision:source.document.revision}; const copy=await service.createPlan(input); await service.savePlan({householdId:'home',planId:source.document.plan_id,expectedEtag:source.etag,plan:{...source.document,title:'Changed'},viewer:{}}); expect((await service.createPlan(input)).document.plan_id).toBe(copy.document.plan_id); await expect(service.createPlan({...input,sourceRevision:1})).rejects.toMatchObject({code:'idempotency_conflict'}); await expect(service.createPlan({...input,weekOf:'2026-11-30',requestId:'new'})).rejects.toMatchObject({code:'revision_conflict'});});
it('pins template revision for new weeks while retaining admitted retries',async()=>{const args={householdId:'home',seriesId:'family',weekOf:'2026-11-16',requestId:'template',sourceRevision:0};const created=await service.createPlan(args);const current=await service.readSeries({householdId:'home',seriesId:'family'});await service.saveSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,series:{...current.document,title:'Changed'}});expect((await service.createPlan(args)).document.plan_id).toBe(created.document.plan_id);await expect(service.createPlan({...args,requestId:'new',weekOf:'2026-11-23'})).rejects.toMatchObject({code:'revision_conflict'});await expect(service.createPlan({...args,sourceRevision:1})).rejects.toMatchObject({code:'idempotency_conflict'});});
it('surfaces an invalid series document during enumeration',async()=>{const fs=await import('node:fs');const invalid=path.join(dir,'agendas','series','broken');fs.mkdirSync(invalid,{recursive:true});fs.writeFileSync(path.join(invalid,'series.yml'),'household_id: foreign\n');await expect(repo.listSeries({householdId:'home'})).rejects.toMatchObject({code:'invalid_document'});});

it('rejects unsupported embedded list values before changing a persisted template', async () => {
 const {EmbeddedListCodec:ListConfigCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:ListConfigCodec});
 const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const bad=structuredClone(current.document);
 bad.defaults.list.sections[0].items[0]={uid:'i',title:'Game',open:{app:'party-games/test'}};
 await expect(strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>bad})).rejects.toMatchObject({code:'invalid_document'});
 expect((await strict.readSeries({householdId:'home',seriesId:'family'})).etag).toBe(current.etag);
});

it('rejects unknown embedded item fields without changing plan data', async () => {
 const {EmbeddedListCodec:ListConfigCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const p=await create('unknown');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:ListConfigCodec});
 await expect(strict.mutatePlan({householdId:'home',planId:p.document.plan_id,expectedEtag:p.etag,mutate:plan=>{plan.list.sections[0].items[0].unsupported='lost';return plan;}})).rejects.toMatchObject({code:'invalid_document'});
 expect((await strict.readPlan({householdId:'home',planId:p.document.plan_id})).etag).toBe(p.etag);
});

it('rejects unsupported list fields before creating a plan', async () => {
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const existing=await create('source');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});
 await expect(strict.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-23',requestId:'bad',make:({planId})=>({...existing.document,plan_id:planId,week_of:'2026-11-23',scheduled_on:'2026-11-23',list:{sections:[{uid:'s',items:[{uid:'i',open:{app:'bad'}}]}]}})})).rejects.toMatchObject({code:'invalid_document'});
 expect((await strict.listPlans({householdId:'home',seriesId:'family'}))).toHaveLength(1);
 const {readdirSync}=await import('node:fs');expect(readdirSync(path.join(dir,'agendas','series','family','requests'))).toHaveLength(1);
});

it('rejects action options the persistence codec would drop', async () => {
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});
 const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const bad=structuredClone(current.document);bad.defaults.list.sections[0].items[0].play={contentId:'files:song',extra:'lost'};
 await expect(strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>bad})).rejects.toMatchObject({code:'invalid_document'});
});

it('persists template lists through the real codec and reads back canonical actions', async () => {
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});
 const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const next=structuredClone(current.document);next.defaults.list.sections[0].items[0]={uid:'i',title:'Song',label:'Opening song',image:'/art.jpg',active:false,play:{contentId:'files:song'},resume:true};
 const saved=await strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>next});
 const {readFileSync}=await import('node:fs');const yaml=(await import('js-yaml')).default;
 const disk=yaml.load(readFileSync(path.join(dir,'agendas','series','family','series.yml'),'utf8'));
 expect(disk.defaults.list.sections[0].items[0]).toMatchObject({uid:'i',input:'files:song'});
 expect(saved.document.defaults.list.sections[0].items[0]).toMatchObject({uid:'i',title:'Song',label:'Opening song',image:'/art.jpg',active:false,play:{contentId:'files:song'},resume:true});
});

it('surfaces unknown embedded fields from disk instead of normalizing them away', async () => {
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const file=path.join(dir,'agendas','series','family','series.yml');
 const current=(await repo.readSeries({householdId:'home',seriesId:'family'})).document;
 current.defaults.list.surprise='lost';writeFileSync(file,JSON.stringify(current));
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});
 await expect(strict.readSeries({householdId:'home',seriesId:'family'})).rejects.toMatchObject({code:'invalid_document'});
});

it('rejects malformed string content actions that the codec would discard', async () => {
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});
 const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const bad=structuredClone(current.document);bad.defaults.list.sections[0].items[0].play='song';
 await expect(strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>bad})).rejects.toMatchObject({code:'invalid_document'});
});

it('preserves an intentionally empty template through codec persistence', async () => {
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});
 const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const next=structuredClone(current.document);next.defaults.list.sections=[];
 const saved=await strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>next});
 expect(saved.document.defaults.list.sections).toEqual([]);
});

it('preserves an authored label even when it equals the title',async()=>{
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const next=structuredClone(current.document);next.defaults.list.sections[0].items[0]={uid:'i',title:'Song',label:'Song',play:{contentId:'files:song'}};
 const saved=await strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>next});
 expect(saved.document.defaults.list.sections[0].items[0]).toHaveProperty('label','Song');
});

it('rejects an unsupported legacy action before it can normalize to Play',async()=>{
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const bad=structuredClone(current.document);bad.defaults.list.sections[0].items[0]={uid:'i',label:'Song',input:'files:song',action:'Teleport'};
 await expect(strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>bad})).rejects.toMatchObject({code:'invalid_document'});
});

it('retains supported legacy playback fields across the embedded codec',async()=>{
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const next=structuredClone(current.document);next.defaults.list.sections[0].items[0]={uid:'i',label:'Song',input:'files:song',action:'Play',priority:3,hold:true,resume:false,seconds:0,image:'/image.jpg',active:false};
 const saved=await strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>next});
 expect(saved.document.defaults.list.sections[0].items[0]).toMatchObject({uid:'i',label:'Song',priority:3,hold:true,resume:false,seconds:0,image:'/image.jpg',active:false,play:{contentId:'files:song'}});
});

it('rejects malformed empty legacy input instead of dropping it',async()=>{
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const bad=structuredClone(current.document);bad.defaults.list.sections[0].items[0]={uid:'i',label:'Song',input:'',action:'Play'};
 await expect(strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>bad})).rejects.toMatchObject({code:'invalid_document'});
});

it('retains a supported Android legacy launch while rejecting malformed targets',async()=>{
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});const current=await strict.readSeries({householdId:'home',seriesId:'family'});
 const next=structuredClone(current.document);next.defaults.list.sections[0].items[0]={uid:'i',label:'App',input:'android:org.example/Main',action:'Android'};
 const saved=await strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:current.etag,mutate:()=>next});expect(saved.document.defaults.list.sections[0].items[0].android).toEqual({package:'org.example',activity:'Main'});
 const again=await strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:saved.etag,mutate:doc=>doc});expect(again.document.defaults.list.sections[0].items[0].android).toEqual({package:'org.example',activity:'Main'});
});

it('round trips plan list edits without passing roster or settings to the codec',async()=>{
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const calls=[];const codec={...EmbeddedListCodec,validateEmbeddedList:list=>{calls.push(list);return EmbeddedListCodec.validateEmbeddedList(list);}};
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:codec});const existing=await create('plan-codec');const before=await strict.readPlan({householdId:'home',planId:existing.document.plan_id});
 const saved=await strict.mutatePlan({householdId:'home',planId:existing.document.plan_id,expectedEtag:before.etag,mutate:plan=>{plan.list.sections[0].items[0].resume=false;return plan;}});
 expect(saved.document.list.sections[0].items[0]).toMatchObject({resume:false,play:{contentId:'files:song'}});
 expect(saved.document.participants).toEqual(before.document.participants);expect(saved.document.activity_settings).toEqual(before.document.activity_settings);
 expect(calls.length).toBeGreaterThan(0);expect(calls.every(value=>!Object.hasOwn(value,'participants') && !Object.hasOwn(value,'activity_settings'))).toBe(true);
});

it('rejects multiple persisted actions before writing a plan or receipt',async()=>{
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const existing=await create('source-mixed');const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});
 const {readdirSync}=await import('node:fs');const receipts=path.join(dir,'agendas','series','family','requests');const before=readdirSync(receipts);
 for (const [index,item] of [
  {uid:'i',title:'Two',play:{contentId:'files:song'},list:{contentId:'menu:other'}},
  {uid:'i',title:'Two',android:{package:'org.example',activity:'Main'},open:'party-games/charades:test'},
  {uid:'i',title:'Two',src:'files',media_key:'song',list:{contentId:'menu:other'}},
 ].entries()) {
  await expect(strict.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-23',requestId:`mixed-${index}`,make:({planId})=>({...existing.document,plan_id:planId,week_of:'2026-11-23',scheduled_on:'2026-11-23',list:{sections:[{uid:'s',items:[item]}]}})})).rejects.toMatchObject({code:'invalid_document'});
 }
 expect(readdirSync(receipts)).toEqual(before);expect(await strict.listPlans({householdId:'home',seriesId:'family'})).toHaveLength(1);
});

it('retains equivalent watchlist and legacy encodings across repeated saves',async()=>{
 const {EmbeddedListCodec}=await import('../../../../../__capabilities/content-catalog/server/list-codec.mjs');
 const strict=new YamlAgendaRepository({pathForHousehold:()=>dir,listCodec:EmbeddedListCodec});const initial=await strict.readSeries({householdId:'home',seriesId:'family'});
 const next=structuredClone(initial.document);next.defaults.list.sections[0].items=[{uid:'watch',title:'Watch',src:'files',media_key:'one'},{uid:'legacy',label:'Song',input:'files:song',action:'Play'}];
 const first=await strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:initial.etag,mutate:()=>next});
 const second=await strict.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:first.etag,mutate:doc=>doc});
 expect(second.document.defaults.list.sections[0].items).toMatchObject([{uid:'watch',src:'files',media_key:'one',play:{contentId:'files:one'}},{uid:'legacy',label:'Song',play:{contentId:'files:song'}}]);
});
