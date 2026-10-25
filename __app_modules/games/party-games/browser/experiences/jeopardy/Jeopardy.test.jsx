import React from 'react';
import {act,render,screen,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import Jeopardy from './Jeopardy.jsx';
import {fetchSession} from '../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import {sendJeopardyCommand} from './jeopardyClient.js';
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketSubscription:()=>{}}));
vi.mock('../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js',()=>({fetchSession:vi.fn()}));
vi.mock('./jeopardyClient.js',()=>({sendJeopardyCommand:vi.fn()}));

it('suppresses held judgments and ignores extra presses while a command is in flight',async()=>{
 const set={title:'Quiz',rounds:[{name:'Round',mode:'turns',categories:[{name:'Pictures',clues:[{value:100,clue:'Question',answer:'Answer'}]}]}]};
 const state={set,phase:'judging',roundIndex:0,active:{cat:0,row:0,clue:set.rounds[0].categories[0].clues[0]},revealed:true,answeringTeamId:'team_1',turnTeamId:'team_1',scores:{team_1:0},attempted:[],cursor:{cat:0,row:0},used:{}};
 fetchSession.mockResolvedValue({state});let handler;let finish;
 sendJeopardyCommand.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 render(<Jeopardy sessionId="test-session" seats={[{id:'team_1',name:'Blue Team',members:[]}]} registerRemoteAction={value=>{handler=value;return()=>{};}}/>);
 await screen.findByTestId('clue-screen');
 await waitFor(()=>expect(handler({action:'navigate',direction:'up',repeat:true})).toBe(true));
 expect(sendJeopardyCommand).not.toHaveBeenCalled();
 act(()=>{handler({action:'navigate',direction:'up'});handler({action:'navigate',direction:'down'});});
 expect(sendJeopardyCommand).toHaveBeenCalledTimes(1);
 expect(sendJeopardyCommand).toHaveBeenCalledWith('test-session',{type:'JUDGE',correct:true});
 await act(async()=>finish({state:{...state,phase:'board',active:null,answeringTeamId:null}}));
 await waitFor(()=>expect(screen.getByTestId('jeopardy-board')).toBeVisible());
});
