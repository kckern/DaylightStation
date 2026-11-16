import React from 'react';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {MenuNavigationProvider} from '../../../../../__capabilities/screen-host/browser/menu-context.mjs';
import {ScreenOverlayProvider} from '../../../../../__capabilities/screen-host/browser/overlays/ScreenOverlayProvider.jsx';
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
