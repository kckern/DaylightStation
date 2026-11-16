import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { ParticipantLaunchHost } from './ParticipantLaunchHost.jsx';

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
  expect(begin.mock.calls[0][0]).toMatchObject({requestId:'request-1',expectedSetupHash:'hash',intent:'new'});
});

it('does not reserve when the consumer adapter is unavailable',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'missing',version:1},confirmation:'none',choices:[]});
 const begin=vi.fn();
 render(<ParticipantLaunchHost refValue={{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}} action="open" client={{inspect,begin}} canLaunch={()=>false} onClose={()=>{}}/>);
 expect(await screen.findByText('Launch unavailable')).toBeTruthy();
 expect(begin).not.toHaveBeenCalled();
});

it('offers Resume and New without reserving during inspection',async()=>{
 const inspect=vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,confirmation:'none',setup_hash:'h',choices:[{launch_id:'old',label:'Earlier'}]});
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
