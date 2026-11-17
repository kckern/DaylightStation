import React from 'react';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {MenuNavigationProvider} from '../../../../__capabilities/screen-host/browser/menu-context.mjs';
import {useMenuNavigationContext} from '../../../../__capabilities/screen-host/browser/menu-navigation.mjs';
function SelectionProbe(){const nav=useMenuNavigationContext();return <div data-testid="selection-probe">{JSON.stringify(nav.getSelection(1))}</div>}
import {ScreenOverlayProvider} from '../../../../__capabilities/screen-host/browser/overlays/ScreenOverlayProvider.jsx';
import {createParticipantBrowserRegistry} from '../../../../frontend/src/composition/participants/participantBrowserRegistry.js';
import {AgendaMenuHost} from './AgendaMenuHost.jsx';
import {ScreenActionHandler} from '../../../../frontend/src/composition/screens/actions/ScreenActionHandler.jsx';
import {getActionBus} from '../../../../__capabilities/screen-host/browser/input.mjs';
import {GamepadAdapter} from '../../../../__capabilities/screen-host/browser/input/adapters/GamepadAdapter.js';
vi.mock('../../../../frontend/src/lib/api.mjs', async original => ({...(await original()),DaylightAPI:vi.fn().mockResolvedValue({})}));
vi.mock('../../../media/media/browser/menu/LaunchCard.jsx',()=>({default:()=> <div>External activity</div>}));
vi.mock('../../../media/media/browser/menu/PlexMenuRouter.jsx',()=>({PlexMenuRouter:()=>null}));
vi.mock('../../../media/media/browser/surround-host.mjs',()=>({default:({children})=>children}));
vi.mock('../../../media/media/browser/playback.mjs',()=>({default:()=>null,PlayerOverlayLoading:()=>null}));
it('returns to the selected dated plan and refreshes it after an activity',async()=>{
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'};
 const row={uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:ref}};
 const response=(title,items)=>({ok:true,json:async()=>({id:'agenda:s/plans/p',title,items,navigationPolicy:'return-to-selected',disableAutoCountdown:true})});
 const fetcher=vi.fn().mockResolvedValueOnce(response('Original',[row])).mockResolvedValueOnce(response('Updated',[{uid:'other',label:'Other',disabled:true},{uid:'uid',label:'Cancelled',disabled:true}]));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}},return_to:{kind:'content',content_id:'agenda:s/plans/p',item_uid:'uid'}})};
 const Adapter=({clear})=><button onClick={clear}>Close activity</button>;
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:Adapter}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Activity'));
 fireEvent.click(await screen.findByRole('button',{name:'Start'}));
 fireEvent.click(await screen.findByRole('button',{name:'Close activity'}));
 const cancelled=await screen.findByText('Cancelled');
 await waitFor(()=>expect(cancelled.closest('.menu-item').classList.contains('active')).toBe(true));
 await waitFor(()=>expect(fetcher.mock.calls[1][0]).toBe('/api/v1/list/agenda/s/plans/p'));
});

it('preserves the nested dated menu and UID after return refresh fails and retries',async()=>{
 const row={uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}}};
 const result=(id,title,items)=>({ok:true,json:async()=>({id,title,items,navigationPolicy:'return-to-selected',disableAutoCountdown:true})});
 const fetcher=vi.fn().mockResolvedValueOnce(result('agenda:s/weeks','Weeks',[{label:'Week',list:{contentId:'agenda:s/plans/p'}}])).mockResolvedValueOnce(result('agenda:s/plans/p','Plan',[row])).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(result('agenda:s/plans/p','Plan updated',[{uid:'other',label:'Other',disabled:true},{...row,label:'Activity updated'}]));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:({clear})=><button onClick={clear}>Close activity</button>}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><AgendaMenuHost contentId="agenda:s/weeks" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Week')); fireEvent.click(await screen.findByText('Activity')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); fireEvent.click(await screen.findByText('Close activity'));
 const retry=await screen.findByRole('button',{name:'Retry'}); expect(document.activeElement).toBe(retry);
 new GamepadAdapter(getActionBus())._emit({action:'select',key:'Enter'});
 const updated=await screen.findByText('Activity updated');
 await waitFor(()=>expect(updated.closest('.menu-item').classList.contains('active')).toBe(true));
 expect(screen.queryByText('Week')).toBeNull();
});

it.each(['failure','success'])('does not dismiss a second activity when the preceding refresh settles late: %s',async outcome=>{
 let rejectRefresh,resolveRefresh;
 const row={uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}}};
 const result={ok:true,json:async()=>({id:'agenda:s/plans/p',title:'Plan',items:[row],navigationPolicy:'return-to-selected'})};
 const fetcher=vi.fn().mockResolvedValueOnce(result).mockImplementationOnce(()=>new Promise((resolve,reject)=>{resolveRefresh=resolve;rejectRefresh=reject;}));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:({clear})=><button onClick={clear}>Close activity</button>}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Activity')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); fireEvent.click(await screen.findByText('Close activity'));
 fireEvent.click(await screen.findByText('Activity')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); await screen.findByText('Close activity');
 await act(async()=>{ if (outcome === 'failure') rejectRefresh(new Error('offline')); else resolveRefresh({ok:true,json:async()=>({id:'agenda:s/plans/p',title:'Stale update',items:[],navigationPolicy:'return-to-selected'})}); await Promise.resolve(); await Promise.resolve(); });
 await waitFor(()=>expect(screen.getByText('Close activity')).toBeTruthy());
 expect(screen.queryByRole('button',{name:'Retry'})).toBeNull();
});

it('uses the dated return policy and refresh on browser Back',async()=>{
 const row={uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}}};
 const response=(title,items)=>({ok:true,json:async()=>({id:'agenda:s/plans/p',title,items,navigationPolicy:'return-to-selected'})});
 const fetcher=vi.fn().mockResolvedValueOnce(response('Plan',[row])).mockResolvedValueOnce(response('Updated',[{uid:'uid',label:'Cancelled',disabled:true}]));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:()=> <div>Activity running</div>}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenActionHandler/><AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Activity')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); await screen.findByText('Activity running');
 fireEvent.popState(window);
 expect(await screen.findByText('Cancelled')).toBeTruthy(); expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(['revision_conflict','setup_conflict'])('refreshes after %s and requires confirmation of the new setup',async code=>{
 const ref=x=>({schema:'participant-launch-ref/v1',provider:'agenda',ref:x});
 const row=x=>({uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:ref(x)}});
 const response=items=>({ok:true,json:async()=>({id:'agenda:s/plans/p',title:'Plan',items,navigationPolicy:'return-to-selected'})});
 const fetcher=vi.fn().mockResolvedValueOnce(response([row('old')])).mockResolvedValueOnce(response([row(code === 'revision_conflict' ? 'new' : 'old')]));
 const inspect=vi.fn().mockResolvedValueOnce({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'old',choices:[]}).mockResolvedValueOnce({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'none',setup_hash:'new',choices:[]});
 const begin=vi.fn().mockRejectedValueOnce(Object.assign(new Error('changed'),{code,status:409})).mockResolvedValueOnce({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}});
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:()=> <div>Ready</div>}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher} participantClient={{inspect,begin}} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Activity')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); fireEvent.click(await screen.findByRole('button',{name:'Refresh'}));
 await waitFor(()=>expect(inspect).toHaveBeenCalledTimes(2)); expect(inspect.mock.calls[1][0].ref.ref).toBe(code === 'revision_conflict' ? 'new' : 'old');
 expect(begin).toHaveBeenCalledTimes(1); fireEvent.click(await screen.findByRole('button',{name:'Start'})); await screen.findByText('Ready');
 expect(begin.mock.calls[1][0]).toMatchObject({ref:ref(code === 'revision_conflict' ? 'new' : 'old'),intent:'open',expectedSetupHash:'new'});
});

it('returns to the refreshed disabled menu when conflict refresh finds cancellation',async()=>{
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'old'};
 const response=items=>({ok:true,json:async()=>({id:'agenda:s/plans/p',title:'Plan',items,navigationPolicy:'return-to-selected'})});
 const fetcher=vi.fn().mockResolvedValueOnce(response([{uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:ref}}])).mockResolvedValueOnce(response([{uid:'uid',label:'Cancelled',disabled:true}]));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockRejectedValue(Object.assign(new Error('changed'),{code:'revision_conflict',status:409}))};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:()=>null}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Activity')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); fireEvent.click(await screen.findByRole('button',{name:'Refresh'}));
 const cancelled=await screen.findByText('Cancelled'); fireEvent.click(cancelled); fireEvent.keyDown(window,{key:'Enter'});
 expect(client.begin).toHaveBeenCalledTimes(1); expect(client.inspect).toHaveBeenCalledTimes(1);
});

it('does not pop a newer activity when a cancelled conflict refresh completes late',async()=>{
 let resolveRefresh;
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'old'};
 const row={uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:ref}};
 const result={ok:true,json:async()=>({id:'agenda:s/plans/p',title:'Plan',items:[row],navigationPolicy:'return-to-selected'})};
 const fetcher=vi.fn().mockResolvedValueOnce(result).mockImplementationOnce(()=>new Promise(resolve=>{resolveRefresh=resolve;}));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockRejectedValueOnce(Object.assign(new Error('changed'),{code:'revision_conflict'})).mockResolvedValueOnce({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:()=> <div>Second running</div>}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Activity')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); fireEvent.click(await screen.findByRole('button',{name:'Refresh'}));
 fireEvent.click(await screen.findByRole('button',{name:'Back'})); fireEvent.click(await screen.findByText('Activity')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); await screen.findByText('Second running');
 await act(async()=>{resolveRefresh(result); await Promise.resolve();}); expect(screen.getByText('Second running')).toBeTruthy();
});


it('keeps an external launch open when an earlier refresh fails late',async()=>{
 let rejectRefresh;
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'};
 const rows=[{uid:'aware',label:'Aware',display:{contentId:'fake:x'},participantLaunches:{display:ref}},{uid:'external',label:'External',launch:{contentId:'fake:y'}}];
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({id:'agenda:s/plans/p',title:'Plan',items:rows,navigationPolicy:'return-to-selected'})}).mockImplementationOnce(()=>new Promise((_resolve,reject)=>{rejectRefresh=reject;}));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:({clear})=><button onClick={clear}>Close activity</button>}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Aware')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); fireEvent.click(await screen.findByText('Close activity'));
 fireEvent.click(await screen.findByText('External')); await screen.findByText('External activity');
 await act(async()=>{rejectRefresh(new Error('offline'));await Promise.resolve();});
 expect(screen.getByText('External activity')).toBeTruthy(); expect(screen.queryByRole('button',{name:'Retry'})).toBeNull();
});

it('hardware Back dismisses a nested return error without popping the dated menu or losing UID focus',async()=>{
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'};
 const row={uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:ref}};
 const result=(id,title,items)=>({ok:true,json:async()=>({id,title,items,navigationPolicy:'return-to-selected'})});
 const fetcher=vi.fn().mockResolvedValueOnce(result('agenda:s/weeks','Weeks',[{label:'Week',list:{contentId:'agenda:s/plans/p'}}])).mockResolvedValueOnce(result('agenda:s/plans/p','Plan',[{uid:'other',label:'Other',disabled:true},row])).mockRejectedValueOnce(new Error('offline'));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:({clear})=><button onClick={clear}>Close activity</button>}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenActionHandler/><SelectionProbe/><AgendaMenuHost contentId="agenda:s/weeks" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Week')); fireEvent.click(await screen.findByText('Activity')); await screen.findByRole('button',{name:'Start'});
 expect(screen.getByTestId('selection-probe').textContent).toBe(JSON.stringify({index:1,key:'uid'}));
 fireEvent.click(screen.getByRole('button',{name:'Start'})); fireEvent.click(await screen.findByText('Close activity')); await screen.findByRole('button',{name:'Retry'});
 expect(screen.getByTestId('selection-probe').textContent).toBe(JSON.stringify({index:1,key:'uid'}));
 fireEvent.popState(window);
 const activity=await screen.findByText('Activity');
 await waitFor(()=>expect(activity.closest('.menu-item').classList.contains('active')).toBe(true));
 expect(screen.queryByRole('button',{name:'Retry'})).toBeNull(); expect(screen.queryByText('Week')).toBeNull();
});

it.each([['button','failure'],['button','success'],['hardware','failure'],['hardware','success']])('%s Back cancels a pending return Retry and ignores its late %s',async (backKind,outcome)=>{
 let resolveRetry,rejectRetry;
 const ref={schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'};
 const row={uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:ref}};
 const result=(title,items)=>({ok:true,json:async()=>({id:'agenda:s/plans/p',title,items,navigationPolicy:'return-to-selected'})});
 const fetcher=vi.fn().mockResolvedValueOnce(result('Plan',[row])).mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(()=>new Promise((resolve,reject)=>{resolveRetry=resolve;rejectRetry=reject;}));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:({clear})=><button onClick={clear}>Close activity</button>}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenActionHandler/><AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Activity')); fireEvent.click(await screen.findByRole('button',{name:'Start'})); fireEvent.click(await screen.findByText('Close activity')); fireEvent.click(await screen.findByRole('button',{name:'Retry'}));
 if (backKind === 'hardware') fireEvent.popState(window); else fireEvent.click(screen.getByRole('button',{name:'Back'}));
 await act(async()=>{if(outcome==='failure') rejectRetry(new Error('late failure')); else resolveRetry(result('Stale update',[{uid:'uid',label:'Stale',disabled:true}])); await Promise.resolve();await Promise.resolve();});
 expect(screen.getByText('Activity')).toBeTruthy(); expect(screen.queryByRole('button',{name:'Retry'})).toBeNull(); expect(screen.queryByText('Stale')).toBeNull();
});
it('restores the saved item UID when opening a dated menu after a document reload',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'agenda:s/plans/p',title:'Dated plan',navigationPolicy:'return-to-selected',disableAutoCountdown:true,items:[{uid:'first',label:'First',display:{contentId:'fake:a'}},{uid:'saved',label:'Saved activity',display:{contentId:'fake:b'}}]})});
 render(<MenuNavigationProvider><ScreenOverlayProvider><AgendaMenuHost contentId="agenda:s/plans/p" initialFocusUid="saved" fetcher={fetcher}/></ScreenOverlayProvider></MenuNavigationProvider>);
 const saved=await screen.findByText('Saved activity');await waitFor(()=>expect(saved.closest('.menu-item')).toHaveClass('active'));
});
it('reopens the saved UID through ScreenAutoplay and the screen action host',async()=>{
 const {ScreenAutoplay}=await import('../../../../frontend/src/composition/screens/ScreenRenderer.jsx');
 window.history.replaceState({},'','/screen/living-room?list=agenda%3As%2Fplans%2Fp&focus_uid=saved');
 const previous=globalThis.fetch;
 globalThis.fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'agenda:s/plans/p',title:'Dated plan',navigationPolicy:'return-to-selected',disableAutoCountdown:true,items:[{uid:'first',label:'First',display:{contentId:'fake:a'}},{uid:'saved',label:'Saved activity',display:{contentId:'fake:b'}}]})});
 try {
  render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenActionHandler/><ScreenAutoplay/></ScreenOverlayProvider></MenuNavigationProvider>);
  const saved=await screen.findByText('Saved activity');await waitFor(()=>expect(saved.closest('.menu-item')).toHaveClass('active'));
 } finally {globalThis.fetch=previous;window.history.replaceState({},'','/');}
});

it('notices a metadata-only plan revision after returning from an activity',async()=>{
 const row={uid:'uid',label:'Activity',display:{contentId:'fake:x'},participantLaunches:{display:{schema:'participant-launch-ref/v1',provider:'agenda',ref:'x'}}};
 const response=(revision,title)=>({ok:true,json:async()=>({id:'agenda:s/plans/p',revision,title,items:[row],navigationPolicy:'return-to-selected',disableAutoCountdown:true})});
 const fetcher=vi.fn().mockResolvedValueOnce(response(1,'Original')).mockResolvedValueOnce(response(2,'Renamed'));
 const client={inspect:vi.fn().mockResolvedValue({schema:'participant-launch-options/v1',ready:true,consumer:{id:'neutral',version:1},confirmation:'required',setup_hash:'h',choices:[]}),begin:vi.fn().mockResolvedValue({schema:'participant-launch-result/v1',kind:'ready',consumer:{id:'neutral',version:1},output:{schema:'neutral/v1',data:{}}})};
 const registry=createParticipantBrowserRegistry([{consumer:{id:'neutral',version:1},outputSchema:'neutral/v1',render:({clear})=><button onClick={clear}>Close activity</button>}]);
 render(<MenuNavigationProvider><ScreenOverlayProvider><AgendaMenuHost contentId="agenda:s/current" fetcher={fetcher} participantClient={client} participantRegistry={registry}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Activity'));fireEvent.click(await screen.findByRole('button',{name:'Start'}));fireEvent.click(await screen.findByText('Close activity'));
 expect(await screen.findByText('This plan has been updated.')).toBeTruthy();
});
