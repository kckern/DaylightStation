import React from 'react';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {MenuNavigationProvider} from '../../../../../__capabilities/screen-host/browser/menu-context.mjs';
import {ScreenOverlayProvider,useScreenOverlay} from '../../../../../__capabilities/screen-host/browser/overlays/ScreenOverlayProvider.jsx';
import {createParticipantBrowserRegistry} from '../../../../../frontend/src/composition/participants/participantBrowserRegistry.js';
import MenuStack from './MenuStack.jsx';
vi.mock('../../../../../frontend/src/lib/api.mjs', async original => ({...(await original()), DaylightAPI:vi.fn().mockResolvedValue({})}));
vi.mock('../../../../../frontend/src/modules/Displayer/Displayer.jsx',()=>({default:()=> <div>Ordinary display</div>}));
vi.mock('./PlexMenuRouter.jsx',()=>({PlexMenuRouter:()=>null}));
vi.mock('../surround-host.mjs',()=>({default:({children})=>children}));
vi.mock('../playback.mjs',()=>({default:()=>null,PlayerOverlayLoading:()=>null}));
it('routes a selected display result to the registered consumer with explicit context',async()=>{
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'};
 const context={schema:'participant-context/v1',participants:[]};
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'hash',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},participant_context:context,output:{schema:'neutral/v1',data:{}}})};
 const Adapter=({participantLaunch})=><div>Context: {participantLaunch.participant_context.schema}</div>;
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:Adapter}]);
 const root={title:'Week',items:[{uid:'row',label:'Display',display:{contentId:'fake:x'},participantLaunches:{display:ref}}]};
 render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={root} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Display'));
 fireEvent.click(await screen.findByRole('button',{name:'Start'}));
 expect(await screen.findByText('Context: participant-context/v1')).toBeTruthy();
 await waitFor(()=>expect(client.begin).toHaveBeenCalledTimes(1));
});

it('routes an app action through its registered adapter without spreading selection fields',async()=>{
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'};
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},participant_context:null,output:{schema:'neutral/v1',data:{}}})};
 const Adapter=props=><div>Adapter props: {Object.keys(props).sort().join(',')}</div>;
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:Adapter}]);
 const root={title:'Week',items:[{label:'Open neutral',open:{app:'neutral'},extraSecret:'not-forwarded',participantLaunches:{open:ref}}]};
 render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={root} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Open neutral'));
 fireEvent.click(await screen.findByRole('button',{name:'Start'}));
 expect(await screen.findByText('Adapter props: clear,participantLaunch')).toBeTruthy();
});

it('does not push a menu after Retry was cancelled with Back',async()=>{
 let resolveRetry;
 const load=vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(()=>new Promise(resolve=>{resolveRetry=resolve;}));
 const root={title:'Root',items:[{label:'Open menu',list:{contentId:'agenda:s/weeks'}}]};
 render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={root} loadContentMenu={load}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Open menu')); fireEvent.click(await screen.findByRole('button',{name:'Retry'})); fireEvent.click(screen.getByRole('button',{name:'Back'}));
 await act(async()=>{resolveRetry({title:'Stale menu',items:[]});await Promise.resolve();});
 expect(screen.queryByText('Stale menu')).toBeNull(); expect(screen.getByText('Open menu')).toBeTruthy();
});
it('shows a safe error instead of silently ignoring an invalid participant reference',async()=>{
 const client={inspect:vi.fn()};const root={title:'Week',items:[{label:'Activity',open:{app:'fake'},participantLaunches:{open:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'.repeat(2049)}}}]};
 render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={root} participantClient={client}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Activity'));expect(await screen.findByRole('alert',{name:'Activity unavailable'})).toHaveTextContent('Activity launch unavailable');expect(client.inspect).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Back'}));expect(await screen.findByText('Activity')).toBeTruthy();
});
it('hands a nested participant-aware source to its capable host instead of a generic recent-on-top request',async()=>{
 const {DaylightAPI}=await import('../../../../../frontend/src/lib/api.mjs');const {resolveMenuSource}=await import('../../../../../frontend/src/composition/screens/menuSourceHosts.js');
 DaylightAPI.mockClear();const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'agenda:neutral/plans/p',title:'Week',notice:'Plan notice',navigationPolicy:'return-to-selected',items:[{label:'Aware action',disabled:true}]})});vi.stubGlobal('fetch',fetcher);
 try {
  const root={title:'Root',items:[{label:'Open week',list:{contentId:'agenda:neutral/current'}}]};
  render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={root} resolveMenuSource={resolveMenuSource}/></ScreenOverlayProvider></MenuNavigationProvider>);
  fireEvent.click(await screen.findByText('Open week'));await screen.findByText('Aware action');expect(screen.getByText('Plan notice')).toBeTruthy();
  expect(fetcher).toHaveBeenCalledWith('/api/v1/list/agenda/neutral/current',expect.objectContaining({headers:expect.objectContaining({'X-Daylight-Participant-Launch-Version':'1'})}));
  expect(DaylightAPI).not.toHaveBeenCalledWith('api/v1/list/agenda/neutral/current/recent_on_top');
 } finally {vi.unstubAllGlobals();}
});
it('opens a dated source frame, launches and returns there, then backs to the caller',async()=>{
 const {resolveMenuSource}=await import('../../../../../frontend/src/composition/screens/menuSourceHosts.js');
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'};const row={uid:'item',label:'Activity',display:{contentId:'neutral:one'},participantLaunches:{display:ref}};
 const menu={id:'agenda:neutral/plans/p',title:'Dated',revision:1,navigationPolicy:'return-to-selected',items:[row]};
 const fetcher=vi.fn().mockImplementation(async()=>({ok:true,json:async()=>structuredClone(menu)}));vi.stubGlobal('fetch',fetcher);
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}},return_to:{kind:'content',content_id:'agenda:neutral/plans/p',item_uid:'item'}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:({clear})=><button onClick={clear}>Close activity</button>}]);
 try {
  render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={{title:'Caller',items:[{label:'Open week',list:{contentId:'agenda:neutral/current'}}]}} resolveMenuSource={resolveMenuSource} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
  fireEvent.click(await screen.findByText('Open week'));fireEvent.click(await screen.findByText('Activity'));fireEvent.click(await screen.findByRole('button',{name:'Start'}));fireEvent.click(await screen.findByText('Close activity'));
  await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));await screen.findByText('Activity');expect(fetcher.mock.calls[1][0]).toBe('/api/v1/list/agenda/neutral/plans/p');
  fireEvent.popState(window);expect(await screen.findByText('Open week')).toBeTruthy();expect(screen.queryByText('Activity')).toBeNull();
 } finally {vi.unstubAllGlobals();}
});
it('cancels a pending nested ownership lookup on Back and does not push its late result',async()=>{
 let resolve;const pending=new Promise(done=>{resolve=done;});const cancel=vi.fn();const navigate=vi.fn().mockResolvedValue({id:'agenda:s/plans/p',title:'Late',items:[{label:'Late item'}]});const resolveSource=vi.fn(()=>pending);
 render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={{title:'Caller',items:[{label:'Open week',list:{contentId:'menu:neutral'}}]}} resolveMenuSource={resolveSource}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Open week'));await waitFor(()=>expect(resolveSource).toHaveBeenCalled());fireEvent.popState(window);
 await act(async()=>{resolve({contentId:'agenda:s',controller:{navigate,cancel}});await Promise.resolve();await Promise.resolve();});
 expect(screen.queryByText('Late item')).toBeNull();expect(screen.getByText('Open week')).toBeTruthy();expect(cancel).toHaveBeenCalled();
});
it('surfaces failed nested ownership lookup with retry and Back instead of ordinary fallback',async()=>{
 const resolve=vi.fn().mockRejectedValue(new Error('offline'));
 render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={{title:'Caller',items:[{label:'Open legacy',list:{contentId:'menu:neutral'}}]}} resolveMenuSource={resolve}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Open legacy'));expect(await screen.findByRole('alert',{name:'Menu error'})).toHaveTextContent('Unable to load menu');fireEvent.click(screen.getByRole('button',{name:'Back'}));expect(await screen.findByText('Open legacy')).toBeTruthy();expect(resolve).toHaveBeenCalledTimes(1);
});
it('keeps ordinary submenu children context-free and returns to the selected source frame',async()=>{
 const {resolveMenuSource}=await import('../../../../../frontend/src/composition/screens/menuSourceHosts.js');
 const rootMenu={id:'agenda:neutral/plans/p',title:'Dated',navigationPolicy:'return-to-selected',items:[{uid:'submenu',label:'Browse',list:{contentId:'neutral:collection'}}]};
 const fetcher=vi.fn().mockImplementation(async url=>({ok:true,json:async()=>url.includes('neutral/collection') ? {id:'neutral:collection',title:'Collection',items:[{uid:'child',label:'Ordinary',display:{contentId:'neutral:item'}}]} : structuredClone(rootMenu)}));vi.stubGlobal('fetch',fetcher);
 const inspect=vi.fn();
 try {
  render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={{title:'Caller',items:[{label:'Open week',list:{contentId:'agenda:neutral/current'}}]}} resolveMenuSource={resolveMenuSource} participantClient={{inspect}}/></ScreenOverlayProvider></MenuNavigationProvider>);
  fireEvent.click(await screen.findByText('Open week'));fireEvent.click(await screen.findByText('Browse'));fireEvent.click(await screen.findByText('Ordinary'));await screen.findByText('Ordinary display');expect(inspect).not.toHaveBeenCalled();
  fireEvent.popState(window);const browse=await screen.findByText('Browse');await waitFor(()=>expect(browse.closest('.menu-item')).toHaveClass('active'));expect(screen.queryByText('Ordinary')).toBeNull();await waitFor(()=>expect(fetcher.mock.calls.at(-1)[0]).toBe('/api/v1/list/agenda/neutral/plans/p'));
 } finally {vi.unstubAllGlobals();}
});
it('ignores a late dated refresh failure after a later activity begins',async()=>{
 const {resolveMenuSource}=await import('../../../../../frontend/src/composition/screens/menuSourceHosts.js');let rejectRefresh;
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'},row={uid:'item',label:'Activity',display:{contentId:'neutral:one'},participantLaunches:{display:ref}};
 const menu={id:'agenda:neutral/plans/p',title:'Dated',navigationPolicy:'return-to-selected',items:[row]};
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>structuredClone(menu)}).mockImplementationOnce(()=>new Promise((_,reject)=>{rejectRefresh=reject;}));vi.stubGlobal('fetch',fetcher);
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}},return_to:{kind:'content',content_id:'agenda:neutral/plans/p',item_uid:'item'}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:({clear})=><button onClick={clear}>Close activity</button>}]);
 try {
  render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={{title:'Caller',items:[{label:'Open week',list:{contentId:'agenda:neutral/current'}}]}} resolveMenuSource={resolveMenuSource} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
  fireEvent.click(await screen.findByText('Open week'));fireEvent.click(await screen.findByText('Activity'));fireEvent.click(await screen.findByRole('button',{name:'Start'}));fireEvent.click(await screen.findByText('Close activity'));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByText('Activity'));fireEvent.click(await screen.findByRole('button',{name:'Start'}));await screen.findByText('Close activity');await act(async()=>{rejectRefresh(new Error('offline'));await Promise.resolve();});
  expect(screen.getByText('Close activity')).toBeTruthy();expect(screen.queryByRole('alert',{name:'Menu error'})).toBeNull();
 } finally {vi.unstubAllGlobals();}
});
it('suppresses caller countdown in an authored source frame and restores it on Back',async()=>{
 let escape;function EscapeProbe(){escape=useScreenOverlay().escapeInterceptorRef;return null;}
 const {resolveMenuSource}=await import('../../../../../frontend/src/composition/screens/menuSourceHosts.js');
 const menu={id:'agenda:neutral/plans/p',title:'Dated',navigationPolicy:'return-to-selected',disableAutoCountdown:true,items:[{uid:'z',label:'First',display:{contentId:'neutral:first'}},{uid:'a',label:'Second',display:{contentId:'neutral:second'}}]};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>structuredClone(menu)}));const intervals=vi.spyOn(globalThis,'setInterval');
 try {
  render(<MenuNavigationProvider><ScreenOverlayProvider><EscapeProbe/><MenuStack rootMenu={{title:'Caller',items:[{label:'Open week',list:{contentId:'agenda:neutral/current'}}]}} resolveMenuSource={resolveMenuSource} MENU_TIMEOUT={60000}/></ScreenOverlayProvider></MenuNavigationProvider>);
  await screen.findByText('Open week');expect(intervals.mock.calls.some(([,ms])=>ms===15)).toBe(true);intervals.mockClear();
  fireEvent.click(screen.getByText('Open week'));await screen.findByText('First');expect(screen.getAllByRole('heading',{level:3}).map(x=>x.textContent)).toEqual(['First','Second']);expect(intervals.mock.calls.some(([,ms])=>ms===15)).toBe(false);
  act(()=>expect(escape.current()).toBe(true));await screen.findByText('Open week');expect(intervals.mock.calls.some(([,ms])=>ms===15)).toBe(true);
 } finally {intervals.mockRestore();vi.unstubAllGlobals();}
});
it('does not let a late source refresh failure replace the caller after Back',async()=>{
 const {resolveMenuSource}=await import('../../../../../frontend/src/composition/screens/menuSourceHosts.js');let rejectRefresh;
 const row={uid:'item',label:'Ordinary',display:{contentId:'neutral:one'}};const menu={id:'agenda:neutral/plans/p',title:'Dated',navigationPolicy:'return-to-selected',items:[row]};
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>structuredClone(menu)}).mockImplementationOnce(()=>new Promise((_,reject)=>{rejectRefresh=reject;}));vi.stubGlobal('fetch',fetcher);
 try {
  render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={{title:'Caller',items:[{label:'Open week',list:{contentId:'agenda:neutral/current'}}]}} resolveMenuSource={resolveMenuSource}/></ScreenOverlayProvider></MenuNavigationProvider>);
  fireEvent.click(await screen.findByText('Open week'));fireEvent.click(await screen.findByText('Ordinary'));await screen.findByText('Ordinary display');fireEvent.popState(window);await screen.findByText('Ordinary');await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
  fireEvent.popState(window);await screen.findByText('Open week');await act(async()=>{rejectRefresh(new Error('offline'));await Promise.resolve();});expect(screen.getByText('Open week')).toBeTruthy();expect(screen.queryByRole('alert',{name:'Menu error'})).toBeNull();
 } finally {vi.unstubAllGlobals();}
});
it('opens a claimed nested alias through its registered source and returns to caller',async()=>{
 const {DaylightAPI}=await import('../../../../../frontend/src/lib/api.mjs');const {resolveMenuSource}=await import('../../../../../frontend/src/composition/screens/menuSourceHosts.js');
 DaylightAPI.mockImplementation(async url=>url.includes('_ownership/menu/') ? {alias:{owner:'agenda',canonicalContentId:'agenda:neutral'}} : {});
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'agenda:neutral/plans/p',title:'Dated',navigationPolicy:'return-to-selected',disableAutoCountdown:true,items:[{label:'Activity',disabled:true}]})});vi.stubGlobal('fetch',fetcher);
 try {
  render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={{title:'Caller',items:[{label:'Legacy',list:{contentId:'menu:neutral'}}]}} resolveMenuSource={resolveMenuSource}/></ScreenOverlayProvider></MenuNavigationProvider>);
  fireEvent.click(await screen.findByText('Legacy'));await screen.findByText('Activity');expect(DaylightAPI).toHaveBeenCalledWith('/api/v1/list/_ownership/menu/neutral');expect(fetcher).toHaveBeenCalledWith('/api/v1/list/agenda/neutral',expect.objectContaining({headers:expect.objectContaining({'X-Daylight-Participant-Launch-Version':'1'})}));
  fireEvent.popState(window);expect(await screen.findByText('Legacy')).toBeTruthy();
 } finally {vi.unstubAllGlobals();DaylightAPI.mockReset().mockResolvedValue({});}
});
it.each([['show','show-view'],['season','season-view'],[undefined,'plex-menu']])('preserves ordinary Plex routing after a source miss for %s',async(type,expected)=>{
 const {useMenuNavigationContext}=await import('../../../../../__capabilities/screen-host/browser/menu-navigation.mjs');
 function Probe(){const {currentContent}=useMenuNavigationContext();return <output data-testid="stack-type">{currentContent?.type || ''}</output>;}
 render(<MenuNavigationProvider><ScreenOverlayProvider><Probe/><MenuStack rootMenu={{title:'Caller',items:[{label:'Plex',type,list:{contentId:'plex:123'}}]}} resolveMenuSource={async()=>null}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Plex'));await waitFor(()=>expect(screen.getByTestId('stack-type')).toHaveTextContent(expected));
});
