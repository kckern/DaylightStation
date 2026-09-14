import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PartyGamesApp from './PartyGamesApp.jsx';
import AppContainer from '@/modules/AppContainer/AppContainer.jsx';
import { ScreenAutoplay } from '@/screen-framework/ScreenRenderer.jsx';
const navigation = vi.hoisted(() => ({ push: null }));
vi.mock('@/context/useMenuNavigationContext.js',()=>({useMenuNavigationContext:()=>({push:navigation.push})}));
vi.mock('@/screen-framework/widgets/builtins.js',()=>({registerBuiltinWidgets:()=>{}}));
vi.mock('@/lib/fkb.js',async importOriginal=>({...await importOriginal(),bindBackButton:()=>{},enableGlobalKeyCapture:()=>{}}));
import {fetchBoot,createSession} from './sessionClient.js';
vi.mock('./sessionClient.js',()=>({fetchBoot:vi.fn(),createSession:vi.fn()}));
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketStatus:()=>({connected:true})}));
vi.mock('../../../../../screen-framework/input/adapters/GamepadAdapter.js',()=>({acquireGamepadInputHost:()=>({release:()=>{}}),bindNextGamepadPress:()=>{}}));
vi.mock('../effects/EffectOverlay.jsx',()=>({default:()=> <div>Effect rail</div>}));
vi.mock('./PartyGamesExperience.jsx',()=>({default:({onComplete,sessionId})=><button onClick={()=>onComplete({outcome:{kind:'completed'},scores:[]})}>Complete {sessionId}</button>}));
const config={household_members:[{id:'a',name:'Alice'},{id:'b',name:'Bob'}],team_presets:[]};
const sets=[{id:'charades:family',definitionId:'charades:family',game:'charades',setId:'family',presenter_id:'charades-stage',setup:'individuals',setupProfile:{kind:'individuals'},competition:false,valid:true}];
afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>{window.localStorage.clear();window.history.replaceState({},'','/screens/living-room/fhe'); fetchBoot.mockReset().mockResolvedValue({config,sets});createSession.mockReset().mockResolvedValue({header:{session_id:'session-one'}});});
it('propagates AppContainer definition into casual setup and creates only one session in StrictMode', async()=>{
 render(<React.StrictMode><AppContainer open={{app:'party-games/charades:family'}} clear={()=>{}}/></React.StrictMode>);
 const start=await screen.findByRole('button',{name:'Start with 2 players'});
 fireEvent.click(start); await screen.findByRole('button',{name:'Complete session-one'});
 expect(createSession).toHaveBeenCalledTimes(1); expect(createSession.mock.calls[0][0].definitionId).toBe('charades:family');
 expect(window.location.pathname).toBe('/screens/living-room/party-games/charades:family'); expect(new URLSearchParams(window.location.search).get('session')).toBe('session-one');
 expect(screen.queryByText('Effect rail')).toBeNull();
});
it('traverses setup and neutral results using only remote controls and clears session on exit', async()=>{
 const exit=vi.fn(); render(<PartyGamesApp definitionId="charades:family" dismiss={exit}/>);
 await screen.findByRole('button',{name:'Start with 2 players'});
 fireEvent.keyDown(window,{key:'ArrowRight'}); expect(screen.getByRole('button',{name:'Alice'})).toHaveFocus();
 fireEvent.keyDown(window,{key:'Enter'}); expect(screen.getByRole('button',{name:'Start with 1 players'})).toBeEnabled();
 for(let i=0;i<3;i++) fireEvent.keyDown(window,{key:'ArrowRight'});
 fireEvent.keyDown(window,{key:'Enter'}); await screen.findByRole('button',{name:'Complete session-one'});
 fireEvent.keyDown(window,{key:'Enter'}); await screen.findByTestId('results');
 expect(screen.queryByText(/wins|score committed/i)).toBeNull();
 fireEvent.keyDown(window,{key:'ArrowRight'}); fireEvent.keyDown(window,{key:'Enter'});
 expect(exit).toHaveBeenCalledTimes(1); expect(window.location.pathname).toBe('/screens/living-room/fhe');expect(window.location.search).toBe('');
});
it('attaches durable session on refresh without creating another', async()=>{
 window.history.replaceState({},'','/screens/living-room/party-games/charades:family?session=saved&return_to=%2Fscreens%2Fliving-room%2Ffhe');
 fetchBoot.mockResolvedValue({config,sets,attachedSession:{header:{session_id:'saved',experience:{id:'charades'},seats:[]},state:{competition:false}}});
 render(<PartyGamesApp appPath="charades:family"/>);
 await screen.findByRole('button',{name:'Complete saved'}); expect(createSession).not.toHaveBeenCalled(); expect(fetchBoot).toHaveBeenCalledWith({diagnosticSessionId:null,sessionId:'saved'});
});

it('reattaches the saved active preset after leaving and reopening from its menu item', async()=>{
 window.localStorage.setItem('party-games:charades:family:active-session','saved');
 fetchBoot.mockResolvedValue({config,sets,attachedSession:{header:{session_id:'saved',experience:{id:'charades'},seats:[],status:'active'},state:{competition:false}}});
 render(<PartyGamesApp definitionId="charades:family"/>);
 await screen.findByRole('button',{name:'Complete saved'});
 expect(fetchBoot).toHaveBeenCalledWith(expect.objectContaining({sessionId:'saved'}));
 expect(createSession).not.toHaveBeenCalled();
});

it('requires confirmation before Back leaves an active session', async()=>{
 const exit=vi.fn();render(<PartyGamesApp definitionId="charades:family" dismiss={exit}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Start with 2 players'}));
 await screen.findByRole('button',{name:'Complete session-one'});
 fireEvent.keyDown(window,{key:'Escape'});
 const dialog=await screen.findByRole('dialog',{name:'Leave game?'});
 expect(exit).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Keep playing'})).toHaveFocus();
 fireEvent.keyDown(window,{key:'Enter'});expect(dialog).not.toBeInTheDocument();expect(exit).not.toHaveBeenCalled();
 fireEvent.keyDown(window,{key:'Escape'});fireEvent.keyDown(window,{key:'ArrowRight'});fireEvent.keyDown(window,{key:'Enter'});
 expect(exit).toHaveBeenCalledTimes(1);
 expect(window.localStorage.getItem('party-games:charades:family:active-session')).toBe('session-one');
});

it('rebuilds the FHE menu when exiting a session reloaded without its original menu stack',async()=>{
 window.history.replaceState({},'','/screens/living-room/party-games/charades:family?session=saved&return_to=%2Fscreens%2Fliving-room%2Ffhe');
 fetchBoot.mockResolvedValue({config,sets,attachedSession:{header:{session_id:'saved',experience:{id:'charades'},seats:[],status:'complete'},state:{competition:false},result:{outcome:{kind:'completed'},scores:[]}}});
 function ReloadedScreen() {
   const [open,setOpen]=React.useState(true);
   return <><p>Root TV menu</p>{open && <PartyGamesApp appPath="charades:family" dismiss={()=>setOpen(false)}/>}</>;
 }
 function ReturnedScreen() {
   const [menu,setMenu]=React.useState('Root TV menu');
   navigation.push=React.useCallback(({props})=>setMenu(props.list.contentId),[]);
   return <><ScreenAutoplay routes={{fhe:{contentId:'menu:fhe'}}}/><p>{menu}</p></>;
 }
 const view=render(<ReloadedScreen/>);
 // Emulate the browser's document replacement, then run the real route autoplay.
 const replace=vi.spyOn(window.location,'replace').mockImplementation(url=>{
   window.history.replaceState({},'',url);view.rerender(<ReturnedScreen/>);
 });
 fireEvent.click(await screen.findByRole('button',{name:'Exit Party Games'}));
 expect(await screen.findByText('menu:fhe')).toBeInTheDocument();
 expect(replace).toHaveBeenCalledExactlyOnceWith('/screens/living-room/fhe');
 expect(window.location.search).toBe('');expect(screen.queryByText('Root TV menu')).toBeNull();
});
it('canonicalizes direct-route return targets and rejects a backslash-normalized external host',async()=>{
 window.history.replaceState({},'','/screens/living-room/party-games/charades:family?return_to='+encodeURIComponent('/\\external.invalid/steal'));
 const replace=vi.spyOn(window.location,'replace').mockImplementation(()=>{});
 render(<PartyGamesApp appPath="charades:family"/>);
 await screen.findByTestId('team-setup');fireEvent.keyDown(window,{key:'Escape'});
 expect(replace).toHaveBeenCalledExactlyOnceWith('/screens/living-room');
});

it('launches a menu-configured roster directly without setup and keeps its parameters on refresh',async()=>{
 render(<React.StrictMode><AppContainer open={{app:'party-games/charades:family?autostart=true&participants=b,a'}} clear={()=>{}}/></React.StrictMode>);
 await screen.findByRole('button',{name:'Complete session-one'});
 expect(screen.queryByTestId('team-setup')).toBeNull();
 expect(screen.queryByText('+ Guest')).toBeNull();
 expect(createSession).toHaveBeenCalledTimes(1);
 expect(createSession.mock.calls[0][0]).toMatchObject({definitionId:'charades:family',seats:[{id:'b',members:[{id:'b',name:'Bob'}]},{id:'a',members:[{id:'a',name:'Alice'}]}]});
 const params=new URLSearchParams(window.location.search);
 expect(params.get('participants')).toBe('b,a');expect(params.get('autostart')).toBe('true');
});
it('fails visibly instead of silently changing an invalid configured roster',async()=>{
 render(<PartyGamesApp definitionId="charades:family?autostart=true&participants=a,missing"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Unknown configured participant: missing');
 expect(createSession).not.toHaveBeenCalled();expect(screen.queryByTestId('team-setup')).toBeNull();
});
it('requires explicit distinct participants for an automatic launch',async()=>{
 render(<PartyGamesApp definitionId="charades:family?autostart=true&participants=a,a"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('distinct participant');
 expect(createSession).not.toHaveBeenCalled();
});
it('restores automatic launch parameters from a direct URL before session creation',async()=>{
 window.history.replaceState({},'','/screens/living-room/party-games/charades:family?autostart=true&participants=b');
 render(<PartyGamesApp appPath="charades:family"/>);
 await screen.findByRole('button',{name:'Complete session-one'});
 expect(createSession.mock.calls[0][0].seats.map(s=>s.id)).toEqual(['b']);
});
it('does not infer a roster when automatic launch has no participants',async()=>{
 render(<PartyGamesApp definitionId="charades:family?autostart=true"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('distinct participant');
 expect(createSession).not.toHaveBeenCalled();
});
it('keeps the saved session roster authoritative over automatic launch parameters',async()=>{
 window.history.replaceState({},'','/screens/living-room/party-games/charades:family?session=saved&autostart=true&participants=missing');
 fetchBoot.mockResolvedValue({config,sets,attachedSession:{header:{session_id:'saved',experience:{id:'charades'},seats:[{id:'b',members:[config.household_members[1]]}]},state:{competition:false}}});
 render(<PartyGamesApp appPath="charades:family"/>);
 await screen.findByRole('button',{name:'Complete saved'});
 expect(createSession).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).toBeNull();
});

it('launches a named YAML preset without adding roster parameters to the URL',async()=>{
 fetchBoot.mockResolvedValue({config,sets:[{...sets[0],launch:{autostart:true,participants:['b','a']}}]});
 render(<React.StrictMode><AppContainer open={{app:'party-games/charades:family'}} clear={()=>{}}/></React.StrictMode>);
 await screen.findByRole('button',{name:'Complete session-one'});
 expect(createSession).toHaveBeenCalledTimes(1);
 expect(createSession.mock.calls[0][0].seats.map(s=>s.id)).toEqual(['b','a']);
 expect(screen.queryByTestId('team-setup')).toBeNull();
 expect(new URLSearchParams(window.location.search).has('participants')).toBe(false);
 expect(new URLSearchParams(window.location.search).has('autostart')).toBe(false);
});
it('allows explicit inline overrides of named preset defaults',async()=>{
 fetchBoot.mockResolvedValue({config,sets:[{...sets[0],launch:{autostart:true,participants:['b','a']}}]});
 render(<PartyGamesApp definitionId="charades:family?autostart=false"/>);
 await screen.findByTestId('team-setup');expect(createSession).not.toHaveBeenCalled();
});

it('uses the same named preset defaults when selected from the game picker',async()=>{
 fetchBoot.mockResolvedValue({config,sets:[{...sets[0],title:'FHE Charades',launch:{autostart:true,participants:['a','b']}}]});
 render(<PartyGamesApp/>);
 fireEvent.click(await screen.findByRole('button',{name:/FHE Charades/}));
 await screen.findByRole('button',{name:'Complete session-one'});
 expect(screen.queryByTestId('team-setup')).toBeNull();
 expect(createSession.mock.calls[0][0].seats.map(s=>s.id)).toEqual(['a','b']);
});
