import React from 'react';
import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {MantineProvider} from '@mantine/core';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {YamlAgendaRepository} from '../../server/adapters/YamlAgendaRepository.mjs';
import {AgendaPlanningService} from '../../server/application/AgendaPlanningService.mjs';
import AgendaPlanEditor from './AgendaPlanEditor.jsx';

it('retains an edit during committed publication and saves it after deliberate conflict recovery',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-publish-ui-'));let release,committed;
 const replyGate=new Promise(resolve=>{release=resolve;});
 const committedGate=new Promise(resolve=>{committed=resolve;});
 try {
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});let counter=0;
  const service=new AgendaPlanningService({repository:repo,clock:()=>new Date('2026-11-17T12:00:00Z'),ids:Object.fromEntries(['plan','section','item','rosterEntry'].map(kind=>[kind,()=>`${kind}_${++counter}`])),resolveItemImage:async()=>null,validateActivities:async()=>({valid:true,errors:[]}),logger:{info(){}}});
  const series={schema:'agenda-series/v1',series_id:'family',household_id:'home',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[{uid:'section',items:[{uid:'item',title:'Song',play:'song'}]}]},activity_settings:{}}};
  await repo.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:null,mutate:()=>series});
  const created=await service.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-16',requestId:'create',sourceRevision:0});
  const args={householdId:'home',seriesId:'family',planId:created.document.plan_id};
  const client={plan:()=>service.readPlan(args),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),savePlan:vi.fn(async(_s,_p,plan,etag)=>{try{return await service.savePlan({...args,plan,expectedEtag:etag,viewer:{}});}catch(error){if(error.code==='revision_conflict')error.status=409;throw error;}}),transition:async(_s,_p,_action,etag)=>{const result=await service.publishPlan({...args,expectedEtag:etag,viewer:{}});committed(result);await replyGate;return result;}};
  render(<MantineProvider><MemoryRouter initialEntries={[`/admin/content/agendas/family/plans/${created.document.plan_id}`]}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Publish'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Publish'}));
  const published=await committedGate;expect(published.document.state).toBe('published');fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Newer local title'}});
  await act(async()=>release());
  expect(screen.getByLabelText('Title').value).toBe('Newer local title');expect(await screen.findByRole('button',{name:'Save and update published plan'})).toBeTruthy();
  const external=await service.savePlan({...args,expectedEtag:published.etag,plan:{...published.document,title:'External'},viewer:{}});
  fireEvent.click(screen.getByRole('button',{name:'Save and update published plan'}));await screen.findByText(/changed elsewhere/i);
  fireEvent.click(screen.getByRole('button',{name:'Reapply my edits'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Save and update published plan'})).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button',{name:'Save and update published plan'}));await waitFor(()=>expect(client.savePlan).toHaveBeenCalledTimes(3));
  await waitFor(async()=>expect((await repo.readPlan(args)).document.title).toBe('Newer local title'));
  expect((await repo.readPlan(args)).document.state).toBe('published');expect(external.document.revision).toBeGreaterThan(published.document.revision);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
it('reapplies a local draft after another editor publishes it and saves through the real repository',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'agenda-rebase-ui-'));
 try {
  const repo=new YamlAgendaRepository({pathForHousehold:()=>dir});let counter=0;
  const service=new AgendaPlanningService({repository:repo,clock:()=>new Date('2026-11-17T12:00:00Z'),ids:Object.fromEntries(['plan','section','item','rosterEntry'].map(kind=>[kind,()=>`${kind}_${++counter}`])),resolveItemImage:async()=>null,validateActivities:async()=>({valid:true,errors:[]}),logger:{info(){}}});
  const series={schema:'agenda-series/v1',series_id:'family',household_id:'home',revision:0,title:'Together',calendar:{frequency:'weekly',timezone:'UTC',week_starts_on:'monday',default_day:'monday'},status:'active',defaults:{participants:[],list:{sections:[{uid:'section',items:[{uid:'item',title:'Song',play:'song'}]}]},activity_settings:{}}};
  await repo.mutateSeries({householdId:'home',seriesId:'family',expectedEtag:null,mutate:()=>series});
  const created=await service.createPlan({householdId:'home',seriesId:'family',weekOf:'2026-11-16',requestId:'create',sourceRevision:0});const args={householdId:'home',seriesId:'family',planId:created.document.plan_id};
  const client={plan:()=>service.readPlan(args),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),savePlan:vi.fn(async(_s,_p,plan,etag)=>{try{return await service.savePlan({...args,plan,expectedEtag:etag,viewer:{}});}catch(error){if(error.code==='revision_conflict')error.status=409;throw error;}})};
  render(<MantineProvider><MemoryRouter initialEntries={[`/admin/content/agendas/family/plans/${created.document.plan_id}`]}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
  fireEvent.change(await screen.findByLabelText('Title'),{target:{value:'Retained edit'}});
  await service.publishPlan({...args,expectedEtag:created.etag,viewer:{}});
  await waitFor(()=>expect(screen.getByRole('button',{name:'Save draft'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText(/changed elsewhere/i);
  fireEvent.click(screen.getByRole('button',{name:'Reapply my edits'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Save and update published plan'})).not.toBeDisabled());
  expect(screen.getByLabelText('Title').value).toBe('Retained edit');fireEvent.click(screen.getByRole('button',{name:'Save and update published plan'}));
  await waitFor(async()=>expect((await repo.readPlan(args)).document.title).toBe('Retained edit'));expect((await repo.readPlan(args)).document.state).toBe('published');
 } finally {rmSync(dir,{recursive:true,force:true});}
});
