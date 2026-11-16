import React from 'react';
import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,act,waitFor} from '@testing-library/react';
import {MenuNavigationProvider} from '../../../../../__capabilities/screen-host/browser/menu-context.mjs';
import {useMenuNavigationContext} from '../../../../../__capabilities/screen-host/browser/menu-navigation.mjs';
import {ScreenOverlayProvider,useScreenOverlay} from '../../../../../__capabilities/screen-host/browser/overlays/ScreenOverlayProvider.jsx';
import {getActionBus} from '../../../../../__capabilities/screen-host/browser/input.mjs';
import {ScreenActionHandler} from './ScreenActionHandler.jsx';
import MenuWidget from '../widgets/MenuWidget.jsx';
import MenuStack from '../../../../../__app_modules/media/media/browser/menu.mjs';
import * as api from '../../../lib/api.mjs';
vi.mock('../../../lib/api.mjs',async original=>({...await original(),DaylightAPI:vi.fn()}));
vi.mock('../../../../../__app_modules/household/agenda/browser/screen.mjs',()=>({default:({contentId})=><div>Agenda host: {contentId}</div>,createAgendaMenuController:vi.fn()}));
vi.mock('../../../../../__app_modules/media/media/browser/menu/PlexMenuRouter.jsx',()=>({PlexMenuRouter:()=>null}));
vi.mock('../../../../../__app_modules/media/media/browser/surround-host.mjs',()=>({default:({children})=>children}));
vi.mock('../../../../../__app_modules/media/media/browser/playback.mjs',()=>({default:()=>null,PlayerOverlayLoading:()=>null}));
function Driver(){const {showOverlay}=useScreenOverlay();const {push,depth}=useMenuNavigationContext();return <><button onClick={()=>showOverlay(MenuStack,{rootMenu:{title:'Overlay',items:[]}},{priority:'high',ownsNavStack:true})}>Open overlay</button><button onClick={()=>push({type:'menu',props:{list:{title:'Nested',items:[{label:'Nested item'}]}}})}>Push nested</button><output data-testid="depth">{depth}</output></>;}
it('retries an ownership error without remounting the real widget or resetting the owning overlay stack',async()=>{
 api.DaylightAPI.mockImplementation(async url=>url.includes('_ownership/menu/') ? Promise.reject(new Error('offline')) : {title:'Widget',items:[{label:'Widget item'}]});
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenActionHandler/><Driver/><MenuWidget source="neutral"/></ScreenOverlayProvider></MenuNavigationProvider>);
 await screen.findByText('Widget item');fireEvent.click(screen.getByText('Open overlay'));fireEvent.click(screen.getByText('Push nested'));await screen.findByText('Nested item');expect(screen.getByTestId('depth')).toHaveTextContent('1');
 act(()=>getActionBus().emit('menu:open',{menuId:'menu:neutral'}));await screen.findByRole('alert',{name:'Menu error'});await act(async()=>{await Promise.resolve();await Promise.resolve();});expect(screen.queryByText('Widget item')).toBeNull();expect(screen.getByTestId('depth')).toHaveTextContent('1');
 api.DaylightAPI.mockImplementation(async url=>url.includes('_ownership/menu/') ? {alias:{owner:'agenda',canonicalContentId:'agenda:neutral'}} : {title:'Widget',items:[{label:'Widget item'}]});
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));expect(await screen.findByText('Agenda host: agenda:neutral')).toBeTruthy();await waitFor(()=>expect(screen.queryByRole('alert',{name:'Menu error'})).toBeNull());
});

it.each(['success','failure'])('closes a pending ownership Retry on hardware Back and ignores late %s',async outcome=>{
 let resolveRetry,rejectRetry;
 const retryResponse=new Promise((resolve,reject)=>{resolveRetry=resolve;rejectRetry=reject;});
 let ownershipRequests=0;
 api.DaylightAPI.mockImplementation(async url=>{
  if(!url.includes('_ownership/menu/')) return {title:'Widget',items:[{label:'Widget item'}]};
  ownershipRequests++;
  if(ownershipRequests===1) throw new Error('offline');
  if(ownershipRequests===2) return retryResponse;
  return {alias:{owner:'agenda',canonicalContentId:'agenda:neutral'}};
 });
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenActionHandler actions={{menu:{duplicate:'ignore'}}}/><Driver/><MenuWidget source="neutral"/></ScreenOverlayProvider></MenuNavigationProvider>);
 await screen.findByText('Widget item');
 fireEvent.click(screen.getByText('Open overlay'));
 fireEvent.click(screen.getByText('Push nested'));
 await screen.findByText('Nested item');
 act(()=>getActionBus().emit('menu:open',{menuId:'menu:neutral'}));
 await screen.findByRole('alert',{name:'Menu error'});
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 expect(ownershipRequests).toBe(2);
 expect(screen.getByTestId('depth')).toHaveTextContent('1');
 fireEvent.popState(window);
 expect(screen.queryByRole('alert',{name:'Menu error'})).toBeNull();
 expect(await screen.findByText('Widget item')).toBeTruthy();
 expect(screen.getByTestId('depth')).toHaveTextContent('0');
 await act(async()=>{
  if(outcome==='success') resolveRetry({alias:{owner:'agenda',canonicalContentId:'agenda:stale'}});
  else rejectRetry(new Error('still offline'));
  await retryResponse.catch(()=>{});
 });
 expect(screen.queryByRole('alert',{name:'Menu error'})).toBeNull();
 expect(screen.queryByText('Agenda host: agenda:stale')).toBeNull();
 expect(screen.getByText('Widget item')).toBeTruthy();
 act(()=>getActionBus().emit('menu:open',{menuId:'menu:neutral'}));
 expect(await screen.findByText('Agenda host: agenda:neutral')).toBeTruthy();
 expect(screen.queryByText('Widget item')).toBeNull();
});

it.each(['before','success','failure'])('hardware Back closes the widget local error (%s Retry) without losing its frame/selection',async outcome=>{
 let resolveRetry,rejectRetry,requests=0;
 const retry=new Promise((resolve,reject)=>{resolveRetry=resolve;rejectRetry=reject;});
 api.DaylightAPI.mockImplementation(async url=>{
  if(!url.includes('_ownership/menu/')) return {title:'Widget',items:[{label:'Widget item'}]};
  requests++;if(requests===1)throw Error('offline');return retry;
 });
 function Nested(){const {push,setSelectionAtDepth,depth,getSelection}=useMenuNavigationContext();return <><button onClick={()=>{push({type:'menu',props:{list:{title:'Caller',items:[{uid:'safe',label:'Safe'},{uid:'nested',label:'Nested lookup',list:{contentId:'menu:child'}}]}}});setSelectionAtDepth(1,1,'nested');}}>Caller frame</button><output data-testid="caller">{depth}:{getSelection(1).key}</output></>;}
 render(<MenuNavigationProvider><ScreenOverlayProvider><ScreenActionHandler/><MenuWidget source="neutral"/><Nested/></ScreenOverlayProvider></MenuNavigationProvider>);
 await screen.findByText('Widget item');fireEvent.click(screen.getByText('Caller frame'));await screen.findByText('Nested lookup');
 fireEvent.click(screen.getByText('Nested lookup'));await screen.findByRole('alert',{name:'Menu error'});
 expect(screen.getByTestId('caller')).toHaveTextContent('1:nested');
 if(outcome!=='before') fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 fireEvent.popState(window);
 expect(screen.queryByRole('alert',{name:'Menu error'})).toBeNull();
 expect(screen.getByTestId('caller')).toHaveTextContent('1:nested');expect(screen.getByText('Nested lookup')).toBeTruthy();
 if(outcome!=='before') await act(async()=>{if(outcome==='success')resolveRetry({alias:null});else rejectRetry(Error('still offline'));await retry.catch(()=>{});});
 expect(screen.queryByRole('alert',{name:'Menu error'})).toBeNull();expect(screen.getByTestId('caller')).toHaveTextContent('1:nested');expect(screen.getByText('Nested lookup')).toBeTruthy();
});

it('commits a successful local Retry without treating its own push as cancellation',async()=>{
 const cancelled=vi.fn();let attempts=0;
 const resolveMenuSource=async()=>{attempts++;if(attempts===1)throw Error('offline');return null;};
 const rootMenu={title:'Caller',items:[{uid:'nested',label:'Nested retry',list:{contentId:'menu:child'}}]};
 api.DaylightAPI.mockResolvedValue({title:'Child',items:[{label:'Child item'}]});
 render(<MenuNavigationProvider><ScreenOverlayProvider><MenuStack rootMenu={rootMenu} resolveMenuSource={resolveMenuSource} onNavigationCancel={cancelled}/></ScreenOverlayProvider></MenuNavigationProvider>);
 fireEvent.click(await screen.findByText('Nested retry'));await screen.findByRole('alert',{name:'Menu error'});fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 expect(await screen.findByText('Child item')).toBeTruthy();expect(cancelled).not.toHaveBeenCalled();
});
