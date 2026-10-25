import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PartyGamesApp from "./PartyGamesApp.jsx";
import AppContainer from '@/modules/AppContainer/AppContainer.jsx';
import { ScreenAutoplay } from "../../../../../frontend/src/composition/screens/ScreenRenderer.jsx";
const socket=vi.hoisted(()=>({handler:null,connected:true}));
const navigation = vi.hoisted(() => ({ push: null }));
vi.mock("../../../../../__capabilities/screen-host/browser/menu-navigation.mjs",()=>({useMenuNavigationContext:()=>({push:navigation.push})}));
vi.mock("../../../../../frontend/src/composition/screens/widgets/builtins.js",()=>({registerBuiltinWidgets:()=>{}}));
vi.mock('@/lib/fkb.js',async importOriginal=>({...await importOriginal(),bindBackButton:()=>{},enableGlobalKeyCapture:()=>{}}));
import {fetchBoot,createSession} from "./sessionClient.js";
vi.mock("./sessionClient.js",async original=>({...await original(),fetchBoot:vi.fn(),createSession:vi.fn()}));
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketStatus:()=>({connected:socket.connected}),useWebSocketSubscription:(_,fn)=>{socket.handler=fn;}}));
vi.mock("../../../../../__capabilities/screen-host/browser/input/adapters/GamepadAdapter.js",()=>({acquireGamepadInputHost:()=>({release:()=>{}}),bindNextGamepadPress:()=>{},cancelPendingGamepadBind:()=>{},clearGamepadRoleBindings:()=>{},restoreGamepadRoleBindings:()=>{}}));
vi.mock("../effects/EffectOverlay.jsx",()=>({default:()=> <div>Effect rail</div>}));
vi.mock("./PartyGamesExperience.jsx",()=>({default:function Experience({onComplete,sessionId,setId,registerRemoteAction}) {
 React.useEffect(()=>setId==='remote-navigation'?registerRemoteAction(()=>false):undefined,[setId,registerRemoteAction]);
 return setId==='remote-navigation'?<><button>Decrease wager</button><button>Increase wager</button><button>Lock wager</button></>:<button onClick={()=>onComplete({outcome:{kind:'completed'},scores:[]})}>Complete {sessionId}</button>;
}}));
const config={household_members:[{id:'a',name:'Alice'},{id:'b',name:'Bob'}],team_presets:[]};
const sets=[{id:'charades:family',definitionId:'charades:family',game:'charades',setId:'family',presenter_id:'charades-stage',setup:'individuals',setupProfile:{kind:'individuals'},competition:false,valid:true}];
afterEach(()=>vi.restoreAllMocks());
beforeEach(()=>{socket.connected=true;window.localStorage.clear();window.history.replaceState({},'','/screens/living-room/fhe'); fetchBoot.mockReset().mockResolvedValue({config,sets});createSession.mockReset().mockResolvedValue({header:{session_id:'session-one'}});});
it('propagates AppContainer definition into casual setup and creates only one session in StrictMode', async()=>{
 render(<React.StrictMode><AppContainer open={{app:'party-games/charades:family'}} clear={()=>{}}/></React.StrictMode>);
 const start=await screen.findByRole('button',{name:'Start with 2 players'});
 fireEvent.click(start); await screen.findByRole('button',{name:'Complete session-one'});
 expect(createSession).toHaveBeenCalledTimes(1); expect(createSession.mock.calls[0][0].definitionId).toBe('charades:family');
 expect(window.location.pathname).toBe('/screens/living-room/party-games/charades:family'); expect(new URLSearchParams(window.location.search).get('session')).toBe('session-one');
 expect(screen.queryByText('Effect rail')).toBeNull();
});
it('keeps the scoped FHE test route and creates a history-disabled session', async()=>{
 window.history.replaceState({},'','/screens/living-room/fhe/charades/test');
 fetchBoot.mockResolvedValue({config,sets:[{...sets[0],id:'charades:fhe',definitionId:'charades:fhe',setId:'fhe',launch:{autostart:true,participants:['a','b']}}]});
 render(<PartyGamesApp appPath="charades:fhe?history=disabled"/>);
 await screen.findByRole('button',{name:'Complete session-one'});
 expect(createSession.mock.calls[0][0]).toMatchObject({definitionId:'charades:fhe',historyPolicy:'disabled'});
 expect(window.location.pathname).toBe('/screens/living-room/fhe/charades/test');
});
it('rejects a recorded session attached through the history-disabled route', async()=>{
 window.history.replaceState({},'','/screens/living-room/fhe/charades/test?session=real-session');
 fetchBoot.mockResolvedValue({config,sets:[{...sets[0],id:'charades:fhe',definitionId:'charades:fhe',setId:'fhe'}],attachedSession:{header:{session_id:'real-session'},state:{charades_history_policy:'recorded'}}});
 render(<PartyGamesApp appPath="charades:fhe?history=disabled"/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('history policy');
 expect(createSession).not.toHaveBeenCalled();
});
it('clears only the test resume slot when test-session recovery fails', async()=>{
 window.history.replaceState({},'','/screens/living-room/fhe/charades/test');
 window.localStorage.setItem('party-games:charades:fhe:active-session','real-session');
 window.localStorage.setItem('party-games:charades:fhe:test:active-session','missing-test-session');
 fetchBoot.mockRejectedValueOnce(new Error('missing')).mockResolvedValueOnce({config,sets:[]});
 render(<PartyGamesApp appPath="charades:fhe?history=disabled"/>);
 await waitFor(()=>expect(fetchBoot).toHaveBeenCalledTimes(2));
 expect(window.localStorage.getItem('party-games:charades:fhe:active-session')).toBe('real-session');
 expect(window.localStorage.getItem('party-games:charades:fhe:test:active-session')).toBeNull();
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

it('keeps the active attachment after confirmed leave and resumes it when reopened', async()=>{
 const exit=vi.fn();const first=render(<PartyGamesApp definitionId="charades:family" dismiss={exit}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Start with 2 players'}));
 await screen.findByRole('button',{name:'Complete session-one'});
 fireEvent.keyDown(window,{key:'Escape'});
 const dialog=await screen.findByRole('dialog',{name:'Leave game?'});
 expect(exit).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Keep playing'})).toHaveFocus();
 fireEvent.keyDown(window,{key:'Enter'});expect(dialog).not.toBeInTheDocument();expect(exit).not.toHaveBeenCalled();
 fireEvent.keyDown(window,{key:'Escape'});fireEvent.click(await screen.findByRole('button',{name:'Leave game'}));
 expect(exit).toHaveBeenCalledTimes(1);
 expect(window.localStorage.getItem('party-games:charades:family:active-session')).toBe('session-one');
 first.unmount();
 fetchBoot.mockResolvedValue({config,sets,attachedSession:{header:{session_id:'session-one',experience:{id:'charades'},seats:[],status:'active'},state:{competition:false}}});
 render(<PartyGamesApp definitionId="charades:family"/>);
 await screen.findByRole('button',{name:'Complete session-one'});
 expect(fetchBoot).toHaveBeenLastCalledWith({diagnosticSessionId:null,sessionId:'session-one'});
 expect(createSession).toHaveBeenCalledTimes(1);
});

it('clears the attachment only on results or Play Again', async()=>{
 const key='party-games:charades:family:active-session';
 window.localStorage.setItem(key,'completed-session');
 fetchBoot.mockResolvedValue({config,sets,attachedSession:{header:{session_id:'completed-session',experience:{id:'charades'},seats:[],status:'complete'},state:{competition:false},result:{outcome:{kind:'completed'},scores:[]}}});
 createSession.mockResolvedValueOnce({header:{session_id:'session-two'}});
 render(<PartyGamesApp definitionId="charades:family"/>);
 await screen.findByTestId('results');
 await waitFor(()=>expect(window.localStorage.getItem(key)).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:'Play another game'}));
 fireEvent.click(await screen.findByRole('button',{name:/Choose your players/}));
 fireEvent.click(await screen.findByRole('button',{name:'Start with 2 players'}));
 fireEvent.click(await screen.findByRole('button',{name:'Complete session-two'}));
 await screen.findByTestId('results');
 window.localStorage.setItem(key,'session-two');
 fireEvent.click(screen.getByRole('button',{name:'Play another game'}));
 expect(window.localStorage.getItem(key)).toBeNull();
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

it('discards only automatic sessions with obsolete setup metadata',async()=>{
 window.localStorage.setItem('party-games:jeopardy:night:active-session','old-session');
 const jeopardy={...sets[0],id:'jeopardy:night',definitionId:'jeopardy:night',game:'jeopardy',presenter_id:'jeopardy-board',competition:true,setup:'teams',setupProfile:{kind:'teams',setup_revision:'new',anonymous_teams:[{name:'Blue Team',color:'#3273dc'},{name:'Gold Team',color:'#e6b325'}]}};
 fetchBoot.mockResolvedValueOnce({config,sets:[jeopardy],attachedSession:{header:{session_id:'old-session'},state:{set:{}}}}).mockResolvedValueOnce({config,sets:[jeopardy]});
 render(<PartyGamesApp definitionId="jeopardy:night"/>);
 expect(await screen.findByRole('button',{name:'Start with 2 teams'})).toHaveFocus();
 expect(window.localStorage.getItem('party-games:jeopardy:night:active-session')).toBeNull();
 expect(createSession).not.toHaveBeenCalled();
});

it('lets an experience that owns its remote matrix use Left for button focus instead of exit',async()=>{
 const mounted={id:'jeopardy:remote-navigation',definitionId:'jeopardy:remote-navigation',game:'jeopardy',setId:'remote-navigation',presenter_id:'jeopardy-board',setup:'none',setupProfile:{kind:'none'},valid:true};
 fetchBoot.mockResolvedValue({config,sets:[mounted]});
 render(<PartyGamesApp definitionId="jeopardy:remote-navigation"/>);
 await screen.findByRole('button',{name:'Increase wager'});
 fireEvent.keyDown(window,{key:'ArrowRight'});
 expect(screen.getByRole('button',{name:'Increase wager'})).toHaveFocus();
 fireEvent.keyDown(window,{key:'ArrowLeft'});
 expect(screen.queryByRole('dialog',{name:'Leave game?'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Decrease wager'})).toHaveFocus();
 fireEvent.keyDown(window,{key:'Escape'});
 expect(screen.getByRole('dialog',{name:'Leave game?'})).toBeVisible();
});

const jeopardySet={id:'jeopardy:night',definitionId:'jeopardy:night',game:'jeopardy',setId:'night',presenter_id:'jeopardy-board',setup:'none',setupProfile:{kind:'none'},competition:true,valid:true};
const attached=(id,status='active')=>({header:{session_id:id,experience:{id:'jeopardy'},seats:[],status},state:{competition:true},...(status==='complete'?{result:{outcome:{kind:'completed'},scores:[]}}:{})});
it.each(['active','complete'])('follows host restart from %s and completes replacement',async status=>{
 window.history.replaceState({},'','/screens/living-room/party-games/jeopardy:night?session=old');
 fetchBoot.mockResolvedValueOnce({config,sets:[jeopardySet],attachedSession:attached('old',status)}).mockResolvedValueOnce({config,sets:[jeopardySet],attachedSession:attached('diagnostic:new')});
 render(<PartyGamesApp definitionId="jeopardy:night"/>);
 if(status==='active') {await screen.findByRole('button',{name:'Complete old'});fireEvent.keyDown(window,{key:'Escape'});await screen.findByRole('dialog');}else await screen.findByTestId('results');
 act(()=>socket.handler({kind:'session-restarted',sessionId:'unrelated',replacementSessionId:'ignored'}));expect(fetchBoot).toHaveBeenCalledTimes(1);
 act(()=>socket.handler({kind:'session-restarted',sessionId:'old',replacementSessionId:'diagnostic:new'}));
 const completeNew=await screen.findByRole('button',{name:'Complete diagnostic:new'});
 expect(window.localStorage.getItem('party-games:jeopardy:night:active-session')).toBe('diagnostic:new');
 fireEvent.click(completeNew);await screen.findByTestId('results');
 expect(screen.queryByRole('dialog')).toBeNull();expect(fetchBoot).toHaveBeenLastCalledWith({diagnosticSessionId:'diagnostic:new',sessionId:null});
 expect(new URLSearchParams(window.location.search).get('diagnostic_session')).toBe('diagnostic:new');
});
it('keeps other game QR while Jeopardy owns its lobby QR and disconnect copy',async()=>{
 socket.connected=false;fetchBoot.mockResolvedValue({config,sets:[jeopardySet],attachedSession:attached('old')});
 const view=render(<PartyGamesApp definitionId="jeopardy:night"/>);await screen.findByRole('button',{name:'Complete old'});
 expect(screen.queryByRole('img',{name:/Scan/})).toBeNull();expect(screen.getByText('Host controls are unavailable. Reconnecting…')).toBeVisible();view.unmount();
 const other={...jeopardySet,id:'charades:family',definitionId:'charades:family',game:'charades',presenter_id:'charades-stage'};
 fetchBoot.mockResolvedValue({config,sets:[other],attachedSession:{...attached('other'),header:{session_id:'other',experience:{id:'charades'},seats:[]}}});
 render(<PartyGamesApp definitionId="charades:family"/>);await screen.findByRole('button',{name:'Complete other'});expect(screen.getByRole('img',{name:/Scan/})).toBeVisible();
});

it.each(['active','complete'])('transfers same-team physical buzzer bindings from %s before restart remount', async status => {
  window.history.replaceState({}, '', '/screens/living-room/party-games/jeopardy:night?session=old');
  const seats = [{id:'red',name:'Red'}];
  const bindings = { 'gamepad:0:button:0': 'red' };
  window.localStorage.setItem('party-games:buzzers:old', JSON.stringify(bindings));
  fetchBoot.mockResolvedValueOnce({config, sets:[jeopardySet], attachedSession:{...attached('old',status),header:{...attached('old',status).header,seats}}})
    .mockResolvedValueOnce({config, sets:[jeopardySet], attachedSession:{...attached('new'),header:{...attached('new').header,seats}}});
  render(<PartyGamesApp definitionId="jeopardy:night" />);
  if (status === 'active') await screen.findByRole('button', {name:'Complete old'});
  else await screen.findByTestId('results');
  act(() => socket.handler({kind:'session-restarted',sessionId:'old',replacementSessionId:'new'}));
  await screen.findByRole('button', {name:'Complete new'});
  expect(JSON.parse(window.localStorage.getItem('party-games:buzzers:new'))).toEqual(bindings);
  expect(window.localStorage.getItem('party-games:buzzers:old')).toBeNull();
});
it('completed Jeopardy leaves game restart with the phone host', async () => {
  fetchBoot.mockResolvedValue({config,sets:[jeopardySet],attachedSession:attached('old','complete')});
  render(<PartyGamesApp definitionId="jeopardy:night" />);
  await screen.findByTestId('results');
  expect(screen.queryByRole('button',{name:'Play another game'})).toBeNull();
  expect(screen.getByRole('button',{name:'Exit Party Games'})).toBeVisible();
});
