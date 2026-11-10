import React from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,act,fireEvent,cleanup} from '@testing-library/react';
import PartyGamesApp from './PartyGamesApp.jsx';
import {fetchBoot} from './sessionClient.js';
import {fetchSession} from '../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import {jeopardyRuleModule} from '../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
const socket=vi.hoisted(()=>({handlers:new Set()}));
vi.mock('./sessionClient.js',async original=>({...await original(),fetchBoot:vi.fn()}));
vi.mock('../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js',async original=>({...await original(),fetchSession:vi.fn()}));
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketStatus:()=>({connected:true}),useWebSocketSubscription:(_topic,fn)=>{React.useEffect(()=>{socket.handlers.add(fn);return()=>socket.handlers.delete(fn);},[fn]);}}));
vi.mock('@/services/WebSocketService.js',()=>({wsService:{onStatusChange:()=>()=>{}}}));
vi.mock('../effects/EffectOverlay.jsx',()=>({default:()=>null}));
const teams=[{id:'blue',name:'Blue Team'},{id:'gold',name:'Gold Team'}];
let instances;
beforeEach(()=>{
 instances=[];socket.handlers.clear();window.localStorage.clear();window.history.replaceState({},'','/screens/living-room/party-games/jeopardy:night?session=game:audio');
 vi.stubGlobal('Audio',class extends EventTarget{constructor(src){super();this.src=src;this.pause=vi.fn();this.currentTime=0;this.play=vi.fn(()=>new Promise(resolve=>{this.start=resolve;}));instances.push(this);}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function fixture({complete=false}={}){
 const definition={id:'night',title:'Audio game',rounds:[{mode:'turns',categories:[{name:'One',clues:[{value:100,clue:'Prompt',answer:'Secret'}]}]}]};
 const initial=jeopardyRuleModule.createInitialState(definition,{seats:teams,setup:{jeopardy_flow_version:2}});
 const result={status:'completed',outcome:{kind:'completed',winner_ids:['blue']},scores:[{subject_id:'blue',value:100},{subject_id:'gold',value:0}]};
 const header={session_id:'game:audio',revision:0,experience:{id:'jeopardy'},seats:teams,status:'active'};
 let view={header,state:{...initial,phase:'board'}};
 const finished={header:{...header,revision:1,status:'complete'},state:{...initial,phase:'done',status:'complete',scores:{blue:100,gold:0},presentationSeq:1,presentationEvents:[{seq:1,revision:1,type:'GAME_DONE'}]},result};
 if(complete)view=finished;
 fetchBoot.mockResolvedValue({config:{household_members:[],team_presets:[],defaults:{mute:false}},sets:[{id:'jeopardy:night',definitionId:'jeopardy:night',game:'jeopardy',setId:'night',presenter_id:'jeopardy-board',setup:'teams',setupProfile:{kind:'teams'},competition:true,valid:true}],attachedSession:view});
 fetchSession.mockImplementation(async()=>view);
 render(<PartyGamesApp definitionId="jeopardy:night" dismiss={vi.fn()}/>);
 if(!complete)await screen.findByTestId('jeopardy-board');
 const finish=async()=>{view=finished;await act(async()=>{for(const handler of [...socket.handlers])handler({kind:'session-updated',sessionId:'game:audio'});});await screen.findByTestId('results');};
 const restart=async()=>{
  view={header:{...header,session_id:'game:next'},state:{...initial,phase:'board'}};
  const boot=await fetchBoot();fetchBoot.mockResolvedValue({...boot,attachedSession:view});
  await act(async()=>{for(const handler of [...socket.handlers])handler({kind:'session-restarted',sessionId:'game:audio',replacementSessionId:'game:next'});});
  await screen.findByTestId('jeopardy-board');
 };
 return{finish,restart};
}
it.each(['Exit Party Games','host restart'])('lets the single asynchronous victory cue survive real presenter unmount, then stops on %s',async action=>{
 const f=await fixture();await f.finish();const wins=instances.filter(a=>a.src.endsWith('/win.mp3'));
 expect(wins).toHaveLength(1);expect(wins[0].pause).not.toHaveBeenCalled();
 await act(async()=>wins[0].start());expect(wins[0].pause).not.toHaveBeenCalled();
 if(action==='host restart')await f.restart();else fireEvent.click(screen.getByRole('button',{name:action}));expect(wins[0].pause).toHaveBeenCalled();
});
it('attaches a completed historical game silently',async()=>{
 await fixture({complete:true});await screen.findByTestId('results');expect(instances.filter(a=>a.src.endsWith('/win.mp3'))).toHaveLength(0);
});
