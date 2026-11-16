import React from 'react';
import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {MantineProvider} from '@mantine/core';
import {MemoryRouter} from 'react-router-dom';
import AgendaDefaultsEditor from './AgendaDefaultsEditor.jsx';
it('keeps defaults edits local and labels the scope',async()=>{
 const document={series_id:'s',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),saveSeries:vi.fn(async(_id,doc)=>({document:doc,etag:'"2"'}))};
 render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"1"'}} client={client} editors={{}} onClose={()=>{}} onSaved={()=>{}}/></MemoryRouter></MantineProvider>);
 expect(screen.getByText('Defaults for newly created weeks')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Add anonymous guest'}));
 expect(client.saveSeries).not.toHaveBeenCalled();
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());
 fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));
 await waitFor(()=>expect(client.saveSeries.mock.calls[0][1].defaults.participants).toHaveLength(1));
 expect(document.defaults.participants).toHaveLength(0);
});
it('edits registered settings in the defaults template',async()=>{
 const {CharadesParticipantSettings,defaultParticipantSettings,remapParticipantKeys}=await import('../../../../games/party-games/browser/participant-settings.mjs');
 const descriptor={consumer:{id:'party-games',version:1},editorKey:'party-games',selectorSupport:['all','explicit']};
 const document={series_id:'s',defaults:{participants:[{id:'p',anonymous:true,display:{name:'Guest 1',avatar:null}}],list:{sections:[{uid:'s',items:[{uid:'i',title:'Game',open:'game'}]}]},activity_settings:{}}};
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:descriptor}),saveSeries:vi.fn(async(_id,doc)=>({document:doc,etag:'"2"'}))};
 const editors={'party-games':{consumer:descriptor.consumer,Panel:CharadesParticipantSettings,defaultSettings:defaultParticipantSettings,remapParticipantKeys}};
 render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"1"'}} client={client} editors={editors} onClose={()=>{}} onSaved={()=>{}}/></MemoryRouter></MantineProvider>);
 fireEvent.change(await screen.findByLabelText('Guest 1 clue mode'),{target:{value:'image'}});
 fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));
 await waitFor(()=>expect(client.saveSeries).toHaveBeenCalled());
 expect(client.saveSeries.mock.calls[0][1].defaults.activity_settings.i.settings.charades.clue_modes).toEqual({p:'image'});
});
it('retains defaults edits on conflict and requires deliberate reapplication',async()=>{
 const document={series_id:'s',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),series:async()=>({document,etag:'"new"'}),saveSeries:vi.fn().mockRejectedValueOnce(Object.assign(new Error('changed'),{status:409})).mockImplementation(async(_id,doc)=>({document:doc,etag:'"after"'}))};
 render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"old"'}} client={client} editors={{}} onClose={()=>{}} onSaved={()=>{}}/></MemoryRouter></MantineProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Add anonymous guest'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));
 await screen.findByText(/changed elsewhere/);expect(screen.getByRole('button',{name:'Save defaults'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Reapply defaults edits'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));
 await waitFor(()=>expect(client.saveSeries).toHaveBeenCalledTimes(2));expect(client.saveSeries.mock.calls[1][2]).toBe('"new"');expect(client.saveSeries.mock.calls[1][1].defaults.participants).toHaveLength(1);
});
it('duplicates template sections with resolved artwork and fresh item IDs',async()=>{
 const document={series_id:'s',defaults:{participants:[],list:{sections:[{uid:'section',items:[{uid:'item',title:'Song',play:'song'}]}]},activity_settings:{}}};
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),resolveArtwork:async()=>({document:{images:{item:'/media/img/lists/item.jpg'}}}),saveSeries:vi.fn(async(_id,doc)=>({document:doc,etag:'"2"'}))};
 render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"1"'}} client={client} editors={{}} onClose={()=>{}} onSaved={()=>{}}/></MemoryRouter></MantineProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Duplicate section'}));await waitFor(()=>expect(screen.getAllByRole('button',{name:'Duplicate section'})).toHaveLength(2));await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));
 await waitFor(()=>expect(client.saveSeries).toHaveBeenCalled());const saved=client.saveSeries.mock.calls[0][1];expect(saved.defaults.list.sections[1].items[0]).toMatchObject({image:'/media/img/lists/item.jpg'});expect(saved.defaults.list.sections[1].items[0].uid).not.toBe('item');expect(document.defaults.list.sections[0].items[0].image).toBeUndefined();
});
it('does not apply a delayed template duplicate over a newer roster edit',async()=>{
 let finish;const delayed=new Promise(resolve=>{finish=resolve;});
 const document={series_id:'s',defaults:{participants:[],list:{sections:[{uid:'section',items:[{uid:'item',title:'Song',play:'song'}]}]},activity_settings:{}}};
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),describe:async()=>({document:null}),resolveArtwork:()=>delayed};
 render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"1"'}} client={client} editors={{}} onClose={()=>{}} onSaved={()=>{}}/></MemoryRouter></MantineProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Duplicate section'}));fireEvent.click(screen.getByRole('button',{name:'Add anonymous guest'}));finish({document:{images:{item:'/media/img/lists/item.jpg'}}});
 await screen.findByText(/defaults changed while artwork was loading/i);expect(screen.getByLabelText('Guest 1 name')).toBeTruthy();expect(screen.getAllByRole('button',{name:'Duplicate section'})).toHaveLength(1);
});
it('retains a newer defaults edit when a pending save completes',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const document={series_id:'s',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};const onSaved=vi.fn();
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),saveSeries:vi.fn(()=>pending)};
 render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"1"'}} client={client} editors={{}} onClose={()=>{}} onSaved={onSaved}/></MemoryRouter></MantineProvider>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));expect(screen.getByRole('button',{name:'Save defaults'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Add anonymous guest'}));finish({document,etag:'"2"'});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());expect(onSaved).not.toHaveBeenCalled();expect(screen.getByLabelText('Guest 1 name')).toBeTruthy();
});
it('shows returned defaults field paths and preserves the draft',async()=>{
 const document={series_id:'s',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),saveSeries:vi.fn(async()=>{throw Object.assign(new Error('Invalid document'),{status:422,errors:[{field:'defaults.participants.0.display.name',message:'Name required'}]});})};
 render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"1"'}} client={client} editors={{}} onClose={()=>{}} onSaved={()=>{}}/></MemoryRouter></MantineProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Add anonymous guest'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));
 expect(await screen.findByText(/defaults.participants.0.display.name/)).toBeTruthy();expect(screen.getByLabelText('Guest 1 name')).toBeTruthy();
});
it.each(['Reload defaults','Reapply defaults edits'])('ignores delayed %s after a newer defaults edit',async label=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const document={series_id:'s',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),saveSeries:async()=>{throw Object.assign(new Error('changed'),{status:409});},series:()=>pending};
 render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"1"'}} client={client} editors={{}} onClose={()=>{}} onSaved={()=>{}}/></MemoryRouter></MantineProvider>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));await screen.findByText(/changed elsewhere/);fireEvent.click(screen.getByRole('button',{name:label}));fireEvent.click(screen.getByRole('button',{name:'Add anonymous guest'}));finish({document,etag:'"new"'});await screen.findByText(/changed while the request was pending/i);expect(screen.getByLabelText('Guest 1 name')).toBeTruthy();
});
it('does not close a defaults editor after its pending save outlives the editor',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const document={series_id:'s',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};const onSaved=vi.fn();
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),saveSeries:()=>pending};
 const view=render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"1"'}} client={client} editors={{}} onClose={()=>{}} onSaved={onSaved}/></MemoryRouter></MantineProvider>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));view.unmount();await act(async()=>finish({document,etag:'"new"'}));expect(onSaved).not.toHaveBeenCalled();
});
it('invalidates a pending save as soon as defaults are closed',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const document={series_id:'s',defaults:{participants:[],list:{sections:[]},activity_settings:{}}};const onSaved=vi.fn(),onClose=vi.fn();
 const client={people:async()=>({document:{people:[]},etag:'"0"'}),saveSeries:()=>pending};
 render(<MantineProvider><MemoryRouter><AgendaDefaultsEditor series={{document,etag:'"1"'}} client={client} editors={{}} onClose={onClose} onSaved={onSaved}/></MemoryRouter></MantineProvider>);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Save defaults'})).not.toBeDisabled());fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(onClose).toHaveBeenCalledOnce();await act(async()=>finish({document,etag:'"new"'}));expect(onSaved).not.toHaveBeenCalled();
});
