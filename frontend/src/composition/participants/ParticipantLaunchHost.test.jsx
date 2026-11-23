import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { ParticipantLaunchHost } from './ParticipantLaunchHost.jsx';
import {getActionBus} from '../../../../__capabilities/screen-host/browser/input.mjs';
import { GamepadAdapter } from '../../../../__capabilities/screen-host/browser/input/adapters/GamepadAdapter.js';

it('confirms before reserving and retries a failed begin with the same request ID', async () => {
  const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'hash',participant_summary:[],choices:[]});
  const begin=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'fake',version:1},output:{schema:'fake/v1',data:{}}});
  const ready=vi.fn();
  render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="display" client={{inspect,begin}} onReady={ready} onClose={()=>{}} requestIdFactory={()=> 'request-1'}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Start'}));
  await screen.findByRole('button',{name:'Retry'});
  fireEvent.click(screen.getByRole('button',{name:'Retry'}));
  await waitFor(()=>expect(ready).toHaveBeenCalledTimes(1));
  expect(begin.mock.calls[0][0]).toEqual(begin.mock.calls[1][0]);
  expect(begin.mock.calls[0][0]).toMatchObject({requestId:'request-1',expectedSetupHash:'hash',intent:'open'});
});

it('does not reserve when the consumer adapter is unavailable',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'missing',version:1},confirmation:'none',choices:[]});
 const begin=vi.fn();
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} canLaunch={()=>false} onClose={()=>{}}/>);
 expect(await screen.findByText('Launch unavailable')).toBeTruthy();
 expect(begin).not.toHaveBeenCalled();
});

it('resumes the one game in progress without a review screen when no confirmation is needed',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'none',setup_hash:'h',choices:[{launch_id:'old',label:'Earlier'}]});
 const resume=vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'fake',version:1},output:{schema:'fake/v1',data:{}}});
 const begin=vi.fn(); const ready=vi.fn();
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,resume,begin}} onReady={ready} onClose={()=>{}}/>);
 await waitFor(()=>expect(ready).toHaveBeenCalledTimes(1));
 expect(begin).not.toHaveBeenCalled();
 expect(resume).toHaveBeenCalledWith(expect.objectContaining({launchId:'old',action:'open'}));
});

it('offers Resume and New without reserving during inspection',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'h',choices:[{launch_id:'old',label:'Earlier'}]});
 const resume=vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'fake',version:1},output:{schema:'fake/v1',data:{}}});
 const begin=vi.fn(); const ready=vi.fn();
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,resume,begin}} onReady={ready} onClose={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Resume Earlier'}));
 await waitFor(()=>expect(ready).toHaveBeenCalledTimes(1));
 expect(begin).not.toHaveBeenCalled();
 expect(resume).toHaveBeenCalledWith(expect.objectContaining({launchId:'old',action:'open'}));
});

it('supports remote arrow navigation and Enter on the confirmation',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'h',choices:[]});
 const begin=vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'fake',version:1},output:{schema:'fake/v1',data:{}}});
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} onReady={()=>{}} onClose={()=>{}}/>);
 const start=await screen.findByRole('button',{name:'Start'});
 expect(document.activeElement).toBe(start);
 fireEvent.keyDown(start,{key:'ArrowDown'});
 expect(document.activeElement.textContent).toBe('Back');
 fireEvent.keyDown(document.activeElement,{key:'ArrowUp'});
 expect(document.activeElement).toBe(start);
});

it('does not attach a delayed result after the user closes the host',async()=>{
 let resolveBegin;
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'h',choices:[]});
 const begin=vi.fn().mockReturnValue(new Promise(resolve=>{resolveBegin=resolve;}));
 const ready=vi.fn();
 const view=render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} onReady={ready} onClose={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Start'}));
 view.unmount();
 resolveBegin({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'fake',version:1},output:{schema:'fake/v1',data:{}}});
 await Promise.resolve(); await Promise.resolve();
 expect(ready).not.toHaveBeenCalled();
});

it('cancels confirmation without reserving an execution',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'h',choices:[]});
 const begin=vi.fn(), close=vi.fn();
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} onClose={close}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Back'}));
 expect(close).toHaveBeenCalledTimes(1);
 expect(begin).not.toHaveBeenCalled();
});


it.each(['captured','synthetic'])('accepts %s gamepad arrows and Enter exactly once',async path=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'h',choices:[]});
 const begin=vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'fake',version:1},output:{schema:'fake/v1',data:{}}});
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} onReady={()=>{}} onClose={()=>{}}/>);
 await screen.findByRole('button',{name:'Start'});
 const adapter=new GamepadAdapter(path === 'captured' ? getActionBus() : {emit:()=>false});
 adapter._emit({action:'navigate',key:'ArrowDown',payload:{direction:'down'}}); expect(document.activeElement.textContent).toBe('Back');
 adapter._emit({action:'navigate',key:'ArrowUp',payload:{direction:'up'}}); adapter._emit({action:'select',key:'Enter'});
 await waitFor(()=>expect(begin).toHaveBeenCalledTimes(1)); expect(begin.mock.calls[0][0].intent).toBe('open');
});

it('uses a fresh New request after open returns choices',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'h',choices:[]});
 const begin=vi.fn().mockResolvedValueOnce({schema:'participant-launch-result/v1',kind:'resume_available',current_setup_hash:'h',choices:[{launch_id:'old',label:'Earlier'}]}).mockResolvedValueOnce({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'fake',version:1},output:{schema:'fake/v1',data:{}}});
 let next=0;
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} onReady={()=>{}} onClose={()=>{}} requestIdFactory={()=>`id-${++next}`}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Start'}));
 fireEvent.click(await screen.findByRole('button',{name:'New'}));
 await waitFor(()=>expect(begin).toHaveBeenCalledTimes(2));
 expect(begin.mock.calls.map(([x])=>[x.intent,x.requestId])).toEqual([['open','id-1'],['new','id-2']]);
});

it('offers fresh source refresh on setup conflict instead of replaying stale begin',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'old',choices:[]});
 const begin=vi.fn().mockRejectedValue(Object.assign(new Error('changed'),{code:'setup_conflict',status:409}));
 const refresh=vi.fn();
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} onConflict={refresh} onClose={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Start'}));
 fireEvent.click(await screen.findByRole('button',{name:'Refresh'}));
 expect(refresh).toHaveBeenCalledTimes(1); expect(begin).toHaveBeenCalledTimes(1);
});

it('activates Retry and Back through the gamepad synthetic route',async()=>{
 const inspect=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'h',choices:[]});
 const close=vi.fn();
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect}} onClose={close}/>);
 await screen.findByRole('button',{name:'Retry'}); const adapter=new GamepadAdapter(getActionBus());
 adapter._emit({action:'select',key:'Enter'}); await screen.findByRole('button',{name:'Start'});
 adapter._emit({action:'navigate',key:'ArrowDown',payload:{direction:'down'}}); adapter._emit({action:'select',key:'Enter'});
 expect(close).toHaveBeenCalledTimes(1); expect(inspect).toHaveBeenCalledTimes(2);
});
it('logs safe lifecycle and validation outcomes without participant or setup details',async()=>{
 const {getLogger}=await import('../../lib/logging/Logger.js');
 const info=vi.spyOn(getLogger(),'info');const warn=vi.spyOn(getLogger(),'warn');
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'required',setup_hash:'secret-hash',participant_summary:[{key:'a',display:{name:'Private name'}}],choices:[{launch_id:'old',label:'Earlier'}]});
 const resume=vi.fn().mockRejectedValue(Object.assign(new Error('private failure'),{code:'revision_conflict'}));
 const close=vi.fn();render(<ParticipantLaunchHost refValue={{provider:'agenda',ref:'private-ref'}} action="open" client={{inspect,resume}} onClose={close}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Resume Earlier'}));await screen.findByRole('button',{name:'Refresh'});fireEvent.click(screen.getByRole('button',{name:'Back'}));
 expect(info).toHaveBeenCalledWith('participant-launch.operation',expect.objectContaining({operation:'inspect'}));
 expect(info).toHaveBeenCalledWith('participant-launch.operation',expect.objectContaining({operation:'resume'}));
 expect(warn).toHaveBeenCalledWith('participant-launch.error',expect.objectContaining({code:'revision_conflict'}));
 expect(info).toHaveBeenCalledWith('participant-launch.cancel',expect.any(Object));
 const logged=JSON.stringify([...info.mock.calls,...warn.mock.calls]);expect(logged).not.toMatch(/Private name|secret-hash|private-ref|private failure/);
 info.mockRestore();warn.mockRestore();
});
it('renders a registered readable preview without dumping opaque consumer data',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'hash',participant_summary:[{key:'internal-key',display:{name:'Guest'}}],consumer_summary:{schema:'neutral-preview/v1',data:{secret_id:'internal-id',mode:'Image'}},choices:[]});
 const Preview=({summary})=><p>Guest — {summary.data.mode}</p>;
 render(<ParticipantLaunchHost refValue={{provider:'agenda',ref:'x'}} action="display" client={{inspect}} resolvePreview={()=>Preview} onClose={()=>{}}/>);
 expect(await screen.findByText('Guest — Image')).toBeVisible();expect(screen.queryByText(/internal-id|internal-key/)).toBeNull();expect(screen.getByRole('button',{name:'Start'})).toBeVisible();
});

it('blocks fresh launches for an unknown preview while preserving retained Resume', async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'none',consumer:{id:'neutral',version:1},setup_hash:'hash',consumer_summary:{schema:'unknown/v1',data:{secret:'private'}},choices:[{launch_id:'old',label:'Resume old'}]});
 const begin=vi.fn();const resume=vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready'});const ready=vi.fn();
 render(<ParticipantLaunchHost refValue={{provider:'agenda',ref:'x'}} action="open" client={{inspect,begin,resume}} onReady={ready} onClose={()=>{}}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Activity preview unavailable');
 expect(screen.queryByText('private')).toBeNull();expect(screen.queryByRole('button',{name:'New'})).toBeNull();expect(begin).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Resume old'}));await waitFor(()=>expect(resume).toHaveBeenCalledWith(expect.objectContaining({launchId:'old'})));
});

it('does not autostart an unrenderable preview without retained choices', async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'none',consumer:{id:'neutral',version:1},consumer_summary:{schema:'unknown/v1',data:{}},choices:[]});const begin=vi.fn();
 render(<ParticipantLaunchHost refValue={{provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} onClose={()=>{}}/>);
 expect(await screen.findByRole('alert')).toBeVisible();expect(screen.queryByRole('button',{name:'Start'})).toBeNull();expect(begin).not.toHaveBeenCalled();
});

it('scrolls a long Party Games preview with captured remote input and returns focus to controls',async()=>{
 const {participantBrowserRegistry}=await import('./participantBrowserRegistry.js');
 const people=Array.from({length:20},(_,index)=>({name:`Person ${index+1}`,avatar:null,clue_mode:'text'}));
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'party-games',version:1},confirmation:'required',setup_hash:'hash',consumer_summary:{schema:'party-games-preview/v2',data:{participants:people}},choices:[]});
 const close=vi.fn(),begin=vi.fn();render(<ParticipantLaunchHost refValue={{provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} resolvePreview={participantBrowserRegistry.resolvePreview} onClose={close}/>);
 const list=await screen.findByRole('list',{name:'Participants and clue modes'});
 Object.defineProperties(list,{clientHeight:{value:100},scrollHeight:{value:400}});list.scrollTop=0;
 await waitFor(()=>expect(list).toHaveFocus());const adapter=new GamepadAdapter(getActionBus());
 for(let i=0;i<4;i++) adapter._emit({action:'navigate',key:'ArrowDown',payload:{direction:'down'}});
 expect(list.scrollTop).toBe(300);expect(screen.getByText('Person 20')).toBeInTheDocument();
 adapter._emit({action:'select',key:'Enter'});expect(list).toHaveFocus();expect(begin).not.toHaveBeenCalled();
 for(let i=0;i<4;i++) adapter._emit({action:'navigate',key:'ArrowUp',payload:{direction:'up'}});expect(list.scrollTop).toBe(0);expect(list).toHaveFocus();
 adapter._emit({action:'navigate',key:'ArrowUp',payload:{direction:'up'}});expect(screen.getByRole('button',{name:'Back'})).toHaveFocus();adapter._emit({action:'navigate',key:'ArrowDown',payload:{direction:'down'}});expect(list).toHaveFocus();
 for(let i=0;i<4;i++) adapter._emit({action:'navigate',key:'ArrowDown',payload:{direction:'down'}});expect(list.scrollTop).toBe(300);
 adapter._emit({action:'navigate',key:'ArrowDown',payload:{direction:'down'}});expect(screen.getByRole('button',{name:'Start'})).toHaveFocus();
 fireEvent.keyDown(document.activeElement,{key:'ArrowDown'});expect(screen.getByRole('button',{name:'Back'})).toHaveFocus();
 adapter._emit({action:'select',key:'Enter'});expect(close).toHaveBeenCalledTimes(1);
});
