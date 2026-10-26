import React from 'react';
import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import Jeopardy from '../../../../../__app_modules/games/party-games/browser/experiences/jeopardy/Jeopardy.jsx';
import {BuzzerArbiter} from '../../../../../__app_modules/games/party-games/browser/interaction/BuzzerArbiter.js';
import {fetchSession} from '../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import {sendJeopardyCommand} from '../../../../../__app_modules/games/party-games/browser/experiences/jeopardy/jeopardyClient.js';
const ws=vi.hoisted(()=>({handler:null}));
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketSubscription:(_,fn)=>{ws.handler=fn;}}));
vi.mock('@/services/WebSocketService.js',()=>({wsService:{onStatusChange:()=>()=>{}}}));
vi.mock('../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js',async(importOriginal)=>({...await importOriginal(),fetchSession:vi.fn()}));
vi.mock('../../../../../__app_modules/games/party-games/browser/experiences/jeopardy/jeopardyClient.js',()=>({sendJeopardyCommand:vi.fn()}));
vi.mock('../../../../../__app_modules/games/party-games/browser/experiences/jeopardy/useBuzzerSetup.js',()=>({useBuzzerSetup:()=>{}}));
const pack={title:'Diagnosis',open_book:true,rounds:[{name:'Round',mode:'hosted',categories:[{name:'Category',clues:[{value:200,clue:'First prompt',answer:'First answer'},{value:300,clue:'Second prompt',answer:'Second answer'}]}]}]};
const teams=[{id:'blue',name:'Blue Team',members:[]},{id:'gold',name:'Gold Team',members:[]}];
const initial={set:pack,jeopardyFlowVersion:2,presentationSeq:0,presentationEvents:[],phase:'clue',roundIndex:0,active:{cat:0,row:0,clue:pack.rounds[0].categories[0].clues[0]},answeringTeamId:null,revealed:false,turnTeamId:'blue',teamIds:['blue','gold'],scores:{blue:0,gold:0},attempted:[],cursor:{cat:0,row:0},used:{},finalWagers:{},finalJudged:{}};
beforeEach(()=>{fetchSession.mockReset();sendJeopardyCommand.mockReset();});
afterEach(()=>cleanup());
async function fixture() {
  let callback,resolveOld;
  const arbiter=new BuzzerArbiter();arbiter.restore({slotToTeam:{blue:'blue',gold:'gold'}});
  const buzzers={subscribe:fn=>{callback=fn;return()=>{};},arm:vi.fn(ids=>arbiter.arm(ids)),disarm:vi.fn(()=>arbiter.disarm())};
  fetchSession.mockResolvedValue({header:{revision:10},state:structuredClone(initial)});
  sendJeopardyCommand.mockImplementation(()=>new Promise(()=>{})).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}));
  render(<Jeopardy sessionId="diagnosis" seats={teams} gamingServices={{buzzers,audio:{play:vi.fn(),stopChannel:vi.fn()}}}/>);
  await screen.findByTestId('clue-screen');
  const press=team=>{const winner=arbiter.handleBuzz(team);if(winner)callback(winner);return winner;};
  const snapshot=async(revision,state)=>{
    fetchSession.mockResolvedValue({header:{revision},state:structuredClone(state)});
    await act(async()=>{ws.handler({kind:'session-updated',sessionId:'diagnosis'});await Promise.resolve();});
  };
  return {arbiter,buzzers,press,snapshot,resolveOld:value=>resolveOld(value)};
}
it('control: first eligible Gold press is sent when no earlier command is outstanding', async()=>{
  const h=await fixture();act(()=>h.press('gold'));
  expect(sendJeopardyCommand).toHaveBeenCalledWith('diagnosis',{type:'BUZZ',teamId:'gold'},expect.objectContaining({expectedContext:expect.any(Object)}));
});
it('an unrelated heartbeat cannot erase the first buzz lock while its acknowledgement is pending', async()=>{
  const h=await fixture();act(()=>h.press('blue'));
  expect(h.arbiter.lockedTeamId).toBe('blue');
  await h.snapshot(11,{...initial,buzzerSetup:{seenAt:Date.now()}});
  expect(h.arbiter.lockedTeamId).toBe('blue');
});
it('a valid Gold first press on a NEW clue is not discarded behind the previous clue request', async()=>{
  const h=await fixture();act(()=>h.press('blue'));
  expect(sendJeopardyCommand).toHaveBeenCalledTimes(1);
  await h.snapshot(11,{...initial,phase:'judging',answeringTeamId:'blue'});
  const next={...initial,active:{cat:0,row:1,clue:pack.rounds[0].categories[0].clues[1]},used:{'0:0:0':true},cursor:{cat:0,row:1}};
  await h.snapshot(14,next);
  expect(screen.getByText('Second prompt')).toBeVisible();
  let localWinner;act(()=>{localWinner=h.press('gold');});
  expect(localWinner).toBe('gold');
  expect(sendJeopardyCommand).toHaveBeenCalledTimes(2);
  expect(sendJeopardyCommand).toHaveBeenLastCalledWith('diagnosis',{type:'BUZZ',teamId:'gold'},expect.objectContaining({expectedContext:expect.objectContaining({row:1})}));
});

it('shows silent pending feedback immediately and ignores fifty extra presses',async()=>{
 const h=await fixture();act(()=>h.press('gold'));
 expect(screen.getByText('Gold Team buzz received — confirming…')).toBeVisible();
 for(let i=0;i<50;i++)act(()=>h.press(i%2?'gold':'blue'));
 expect(sendJeopardyCommand).toHaveBeenCalledTimes(1);
});
it('an old response cannot erase the newer question or its pending Gold indicator',async()=>{
 const h=await fixture();act(()=>h.press('blue'));
 await h.snapshot(11,{...initial,phase:'judging',answeringTeamId:'blue'});
 const next={...initial,active:{cat:0,row:1,clue:pack.rounds[0].categories[0].clues[1]},used:{'0:0:0':true},cursor:{cat:0,row:1}};
 await h.snapshot(14,next);
 sendJeopardyCommand.mockImplementationOnce(()=>new Promise(()=>{}));
 act(()=>h.press('gold'));
 expect(screen.getByText('Gold Team buzz received — confirming…')).toBeVisible();
 await act(async()=>h.resolveOld({header:{revision:11},state:{...initial,phase:'judging',answeringTeamId:'blue'}}));
 expect(screen.getByText('Second prompt')).toBeVisible();
 expect(screen.getByText('Gold Team buzz received — confirming…')).toBeVisible();
});
