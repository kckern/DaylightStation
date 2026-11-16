import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import AgendaPlanEditor from './AgendaPlanEditor.jsx';

const plan={schema:'agenda-plan/v1',plan_id:'p',series_id:'s',household_id:'h',revision:1,title:'Week',week_of:'2026-11-23',scheduled_on:'2026-11-23',calendar:{timezone:'UTC',week_starts_on:'monday'},state:'draft',participants:[],list:{sections:[{uid:'section',items:[{uid:'one',title:'First',play:'song'},{uid:'two',title:'Second',play:'song2'}]}]},activity_settings:{}};
it('stages reorder and keeps the local buffer after a save conflict',async()=>{
 const client={plan:vi.fn(async()=>({document:plan,etag:'"one"'})),planningContext:vi.fn(async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}})),people:vi.fn(async()=>({document:{people:[]},etag:'"0"'})),describe:vi.fn(async()=>({document:null})),savePlan:vi.fn(async()=>{throw Object.assign(new Error('changed'),{status:409});})};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
 expect(await screen.findByText('Next week')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Move Second up'}));
 expect(client.savePlan).not.toHaveBeenCalled();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save draft'})).not.toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await screen.findByText(/changed elsewhere/i);
 expect(client.savePlan.mock.calls[0][2].list.sections[0].items.map(i=>i.uid)).toEqual(['two','one']);
 expect(screen.getByRole('button',{name:'Move Second down'})).toBeTruthy();
});
it('shows registered settings only for aware actions and saves explicit people',async()=>{
 const {CharadesParticipantSettings,defaultParticipantSettings,remapParticipantKeys}=await import('../../../../games/party-games/browser/participant-settings.mjs');
 const aware={...structuredClone(plan),participants:[{id:'visitor',person:{kind:'guest',id:'visitor'},display:{name:'Visitor',avatar:null}},{id:'anon1',anonymous:true,display:{name:'Guest 1',avatar:null}},{id:'anon2',anonymous:true,display:{name:'Guest 2',avatar:null}}],list:{sections:[{uid:'section',items:[{uid:'one',title:'Charades',open:'app-target'},{uid:'two',title:'Song',play:'song'}]}]}};
 const descriptor={consumer:{id:'party-games',version:1},editorKey:'party-games',selectorSupport:['all','explicit']};
 const client={plan:async()=>({document:aware,etag:'"one"'}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async(_target,action)=>({document:action==='open'?descriptor:null}),savePlan:vi.fn(async(_s,_p,document)=>({document,etag:'"two"'}))};
 const editors={'party-games':{consumer:descriptor.consumer,Panel:CharadesParticipantSettings,defaultSettings:defaultParticipantSettings,remapParticipantKeys}};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={editors}/>}/></Routes></MemoryRouter></MantineProvider>);
 expect(await screen.findAllByText('Participants')).toHaveLength(1);
 fireEvent.click(screen.getByLabelText('Choose participants'));
 fireEvent.click(screen.getByLabelText('Visitor'));
 fireEvent.change(screen.getByLabelText('Visitor clue mode'),{target:{value:'reader'}});
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await waitFor(()=>expect(client.savePlan).toHaveBeenCalled());
 expect(client.savePlan.mock.calls[0][2].activity_settings.one).toMatchObject({participants:{mode:'explicit',ids:['visitor']},consumer:descriptor.consumer,settings:{charades:{clue_modes:{visitor:'reader'}}}});
 expect(client.savePlan.mock.calls[0][2].activity_settings.two).toBeUndefined();
});
it('retains a newly created directory identity across a plan conflict',async()=>{
 const created={person:{kind:'guest',id:'new'},display:{name:'New Visitor',avatar:null},active:true};
 const client={plan:async()=>({document:plan,etag:'"one"'}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),createGuest:vi.fn(async()=>({document:created,etag:'"1"'})),savePlan:vi.fn(async()=>{throw Object.assign(new Error('changed'),{status:409});})};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
 fireEvent.change(await screen.findByLabelText('Named guest name'),{target:{value:'New Visitor'}});fireEvent.click(screen.getByRole('button',{name:'Add named guest'}));
 expect(await screen.findByText('New Visitor')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await screen.findByText(/changed elsewhere/i);expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Reapply my edits'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save draft'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await waitFor(()=>expect(client.savePlan).toHaveBeenCalledTimes(2));expect(client.createGuest).toHaveBeenCalledTimes(1);
});
it('saves the displayed default participant binding without requiring a settings edit',async()=>{
 const {CharadesParticipantSettings,defaultParticipantSettings,remapParticipantKeys}=await import('../../../../games/party-games/browser/participant-settings.mjs');
 const aware={...structuredClone(plan),list:{sections:[{uid:'s',items:[{uid:'i',title:'Game',open:'game'}]}]}};
 const descriptor={consumer:{id:'party-games',version:1},editorKey:'party-games'};
 const client={plan:async()=>({document:aware,etag:'"one"'}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:descriptor}),savePlan:vi.fn(async(_s,_p,document)=>({document,etag:'"two"'}))};
 const editors={'party-games':{consumer:descriptor.consumer,Panel:CharadesParticipantSettings,defaultSettings:defaultParticipantSettings,remapParticipantKeys}};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={editors}/>}/></Routes></MemoryRouter></MantineProvider>);
 await screen.findByText('Participants');fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await waitFor(()=>expect(client.savePlan).toHaveBeenCalled());expect(client.savePlan.mock.calls[0][2].activity_settings.i).toMatchObject({action:'open',participants:{mode:'plan'},consumer:descriptor.consumer});
});
it('refreshes named display snapshots only on explicit request',async()=>{
 const saved={...structuredClone(plan),participants:[{id:'visitor',person:{kind:'guest',id:'v'},display:{name:'Old name',avatar:null}}]};
 const client={plan:async()=>({document:saved,etag:'"one"'}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[{person:{kind:'guest',id:'v'},display:{name:'New name',avatar:null},active:true}]},etag:'"0"'}),describe:async()=>({document:null}),savePlan:vi.fn(async(_s,_p,document)=>({document,etag:'"two"'}))};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
 expect(await screen.findByText('Old name')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Refresh display snapshots'}));expect(screen.getByText('New name')).toBeTruthy();
 expect(saved.participants[0].display.name).toBe('Old name');
});
it('previews replacing a draft with defaults without changing the saved plan',async()=>{
 const defaults={participants:[],list:{sections:[{uid:'template',items:[{uid:'template-item',title:'Default song',play:'song'}]}]},activity_settings:{}};
 const client={plan:async()=>({document:plan,etag:'"one"'}),series:async()=>({document:{series_id:'s',revision:2,defaults},etag:'"series"'}),defaultsArtwork:async()=>({document:{revision:2,images:{'template-item':'/media/img/lists/template-item.jpg'}}}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),savePlan:vi.fn(async(_s,_p,document)=>({document,etag:'"two"'}))};
 vi.stubGlobal('confirm',vi.fn(()=>true));
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Replace draft with defaults'}));
 await screen.findByText('Default song');expect(window.confirm).toHaveBeenCalled();expect(client.savePlan).not.toHaveBeenCalled();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save draft'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await waitFor(()=>expect(client.savePlan).toHaveBeenCalled());
 const item=client.savePlan.mock.calls[0][2].list.sections[0].items[0];expect(item.uid).not.toBe('template-item');expect(item.image).toBe('/media/img/lists/template-item.jpg');expect(plan.list.sections[0].items[0].title).toBe('First');vi.unstubAllGlobals();
});
it('keeps plan editing available when the guest directory cannot load',async()=>{
 const client={plan:async()=>({document:plan,etag:'"one"'}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>{throw new Error('Directory unavailable');},describe:async()=>({document:null}),savePlan:vi.fn(async(_s,_p,document)=>({document,etag:'"two"'}))};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
 expect(await screen.findByRole('heading',{name:'Next week'})).toBeTruthy();expect(await screen.findByText(/Directory unavailable/)).toBeTruthy();expect(screen.getByRole('button',{name:'Save draft'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Add named guest'})).toBeNull();
});
it('duplicates a section with retained implicit source artwork and fresh IDs',async()=>{
 const client={plan:async()=>({document:plan,etag:'"one"'}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),resolveArtwork:vi.fn(async()=>({document:{images:{one:'/media/img/lists/source.jpg'}}})),savePlan:vi.fn(async(_s,_p,document)=>({document,etag:'"two"'}))};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Duplicate section'}));
 await waitFor(()=>expect(screen.getAllByRole('button',{name:'Duplicate section'})).toHaveLength(2));await waitFor(()=>expect(screen.getByRole('button',{name:'Save draft'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await waitFor(()=>expect(client.savePlan).toHaveBeenCalled());const saved=client.savePlan.mock.calls[0][2];expect(saved.list.sections[1].items[0]).toMatchObject({image:'/media/img/lists/source.jpg'});expect(saved.list.sections[1].items[0].uid).not.toBe('one');expect(plan.list.sections[0].items[0].image).toBeUndefined();
});
it('does not apply a delayed section duplicate over a newer edit',async()=>{
 let finish;const delayed=new Promise(resolve=>{finish=resolve;});
 const client={plan:async()=>({document:plan,etag:'"one"'}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),resolveArtwork:()=>delayed,savePlan:vi.fn(async(_s,_p,document)=>({document,etag:'"two"'}))};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Duplicate section'}));fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Newer edit'}});finish({document:{images:{one:'/media/img/lists/source.jpg'}}});
 await screen.findByText(/changed while artwork was loading/i);expect(screen.getByLabelText('Title').value).toBe('Newer edit');expect(screen.getAllByRole('button',{name:'Duplicate section'})).toHaveLength(1);
});
it('does not apply a delayed defaults replacement over a newer edit',async()=>{
 let finish;const delayed=new Promise(resolve=>{finish=resolve;});vi.stubGlobal('confirm',vi.fn(()=>true));
 const defaults={participants:[],list:{sections:[]},activity_settings:{}};
 const client={plan:async()=>({document:plan,etag:'"one"'}),series:()=>delayed,planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),defaultsArtwork:async()=>({document:{revision:1,images:{}}})};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Replace draft with defaults'}));fireEvent.change(screen.getByLabelText('Title'),{target:{value:'Newer edit'}});finish({document:{series_id:'s',revision:1,defaults}});
 await screen.findByText(/changed while defaults were loading/i);expect(screen.getByLabelText('Title').value).toBe('Newer edit');expect(screen.getByRole('button',{name:'Duplicate section'})).toBeTruthy();vi.unstubAllGlobals();
});

it('does not show or apply an old plan while a new scope is loading',async()=>{
 let finishArt,finishNext;const art=new Promise(resolve=>{finishArt=resolve;}),next=new Promise(resolve=>{finishNext=resolve;});
 const client={plan:async(_s,id)=>id==='p'?{document:plan,etag:'"one"'}:next,planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),resolveArtwork:()=>art};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Link to="/admin/content/agendas/s/plans/other">Next plan</Link><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={{}}/>}/></Routes></MemoryRouter></MantineProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Duplicate section'}));fireEvent.click(screen.getByRole('link',{name:'Next plan'}));finishArt({document:{images:{one:'/media/img/lists/source.jpg'}}});
 expect(screen.queryByLabelText('Title')).toBeNull();finishNext({document:{...structuredClone(plan),plan_id:'other',title:'Other plan',list:{sections:[]}},etag:'"other"'});
 await waitFor(()=>expect(screen.getByLabelText('Title').value).toBe('Other plan'));expect(screen.queryByRole('button',{name:'Duplicate section'})).toBeNull();
});
it('removes consumer-owned references when a person leaves an explicit activity subset',async()=>{
 const {CharadesParticipantSettings,defaultParticipantSettings,remapParticipantKeys}=await import('../../../../games/party-games/browser/participant-settings.mjs');
 const settings=defaultParticipantSettings();settings.charades.clue_modes={a:'reader',b:'image'};
 const aware={...structuredClone(plan),participants:[{id:'a',anonymous:true,display:{name:'Guest 1',avatar:null}},{id:'b',anonymous:true,display:{name:'Guest 2',avatar:null}}],list:{sections:[{uid:'s',items:[{uid:'i',title:'Game',open:'game'}]}]},activity_settings:{i:{schema:'agenda-activity-setup/v1',action:'open',participants:{mode:'explicit',ids:['a','b']},consumer:{id:'party-games',version:1},settings}}};
 const descriptor={consumer:{id:'party-games',version:1},editorKey:'party-games',selectorSupport:['all','explicit']};
 const client={plan:async()=>({document:aware,etag:'"one"'}),planningContext:async()=>({document:{thisWeek:'2026-11-16',nextWeek:'2026-11-23'}}),people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:descriptor}),savePlan:vi.fn(async(_s,_p,document)=>({document,etag:'"two"'}))};
 const editors={'party-games':{consumer:descriptor.consumer,Panel:CharadesParticipantSettings,defaultSettings:defaultParticipantSettings,remapParticipantKeys}};
 render(<MantineProvider><MemoryRouter initialEntries={['/admin/content/agendas/s/plans/p']}><Routes><Route path="/admin/content/agendas/:seriesId/plans/:planId" element={<AgendaPlanEditor client={client} editors={editors}/>}/></Routes></MemoryRouter></MantineProvider>);
 fireEvent.click(await screen.findByLabelText('Guest 2'));fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await waitFor(()=>expect(client.savePlan).toHaveBeenCalled());
 const setup=client.savePlan.mock.calls[0][2].activity_settings.i;expect(setup.participants.ids).toEqual(['a']);expect(setup.settings.charades.clue_modes).toEqual({a:'reader'});
});
