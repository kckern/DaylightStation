import React,{useRef} from 'react';
import {useScopedRemoteControls} from '../../../../../../__capabilities/screen-host/browser/input.mjs';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
import Jeopardy from './Jeopardy.jsx';
import {fetchSession} from '../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import {sendJeopardyCommand} from './jeopardyClient.js';
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketSubscription:()=>{}}));
vi.mock('../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js',()=>({fetchSession:vi.fn()}));
vi.mock('./jeopardyClient.js',()=>({sendJeopardyCommand:vi.fn()}));

beforeEach(()=>{fetchSession.mockReset();sendJeopardyCommand.mockReset();});

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

function RemoteJeopardy(props){
 const root=useRef(null),remote=useRef(null);
 useScopedRemoteControls(root,{onAction:value=>remote.current?.(value)===true});
 return <div ref={root}><Jeopardy {...props} registerRemoteAction={handler=>{remote.current=handler;return()=>{if(remote.current===handler)remote.current=null;};}}/></div>;
}
it('recovers a failed command by reloading authoritative state without replaying it',async()=>{
 const set={title:'Quiz',rounds:[{name:'Round',mode:'turns',categories:[{name:'Pictures',clues:[{value:100,clue:'Question',answer:'Answer'},{value:200,clue:'Next',answer:'Next answer'}]}]}]};
 const state={set,phase:'board',roundIndex:0,active:null,revealed:false,turnTeamId:'team_1',scores:{team_1:0},attempted:[],cursor:{cat:0,row:0},used:{}};
 fetchSession.mockResolvedValueOnce({state}).mockResolvedValueOnce({state:{...state,scores:{team_1:100},used:{'0:0:0':true},cursor:{cat:0,row:1}}});
 sendJeopardyCommand.mockRejectedValue(new Error('Temporary connection failure'));
 render(<RemoteJeopardy sessionId="test-session" seats={[{id:'team_1',name:'Blue Team',members:[]}]}/>);
 await screen.findByTestId('jeopardy-board');
 fireEvent.keyDown(window,{key:'Enter'});
 await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'Retry connection'})).toHaveFocus();
 document.activeElement.blur();fireEvent.keyDown(window,{key:'Enter'});
 await screen.findByTestId('jeopardy-board');
 expect(screen.getByLabelText('Blue Team score')).toHaveTextContent('100');
 expect(screen.getByRole('gridcell',{name:'Pictures for $200'})).toHaveFocus();
 expect(sendJeopardyCommand).toHaveBeenCalledTimes(1);
});

it('uses the acknowledged phase for the next press before React paints the new board',async()=>{
 const set={title:'Quiz',rounds:[{name:'Round',mode:'turns',categories:[{name:'Pictures',clues:[{value:100,clue:'Question',answer:'Answer'}]}]}]};
 const state={set,phase:'judging',roundIndex:0,active:{cat:0,row:0,clue:set.rounds[0].categories[0].clues[0]},revealed:true,answeringTeamId:'team_1',turnTeamId:'team_1',scores:{team_1:0},attempted:[],cursor:{cat:0,row:0},used:{}};
 const board={...state,phase:'board',active:null,answeringTeamId:null};let finish,handler;
 fetchSession.mockResolvedValue({state});
 sendJeopardyCommand.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValue({state:board});
 render(<Jeopardy sessionId="test-session" seats={[]} registerRemoteAction={value=>{handler=value;return()=>{};}}/>);
 await screen.findByTestId('clue-screen');await waitFor(()=>expect(handler({action:'navigate',direction:'up',repeat:true})).toBe(true));
 act(()=>handler({action:'navigate',direction:'up'}));
 await act(async()=>{finish({state:board});await Promise.resolve();handler({action:'navigate',direction:'down'});});
 expect(sendJeopardyCommand).toHaveBeenLastCalledWith('test-session',{type:'MOVE_CURSOR',dir:'down'});
});

it('ignores the previous Final button after acknowledgment but before paint',async()=>{
 const set={title:'Quiz',rounds:[{name:'Round',mode:'turns',categories:[{name:'A',clues:[{value:100}]}]}],final:{category:'Final',clue:'Question',answer:'Answer'}};
 const state={set,phase:'final-judging',roundIndex:0,finalWagers:{team_1:100,team_2:100},finalJudged:{},scores:{team_1:0,team_2:0},teamIds:['team_1','team_2']};
 const teams=[{id:'team_1',name:'Blue Team',members:[]},{id:'team_2',name:'Gold Team',members:[]}];let finish;
 fetchSession.mockResolvedValue({state});sendJeopardyCommand.mockReturnValueOnce(new Promise(resolve=>{finish=resolve;})).mockResolvedValue({state});
 render(<RemoteJeopardy sessionId="test-session" seats={teams}/>);
 const oldButton=(await screen.findAllByRole('button',{name:'Correct',exact:true}))[0];
 act(()=>fireEvent.click(oldButton));
 await act(async()=>{finish({state:{...state,finalJudged:{team_1:true},scores:{team_1:100,team_2:0}}});await Promise.resolve();fireEvent.click(oldButton);});
 expect(sendJeopardyCommand).toHaveBeenCalledTimes(1);
 expect(screen.getByLabelText('Blue Team score')).toHaveTextContent('100');
});

it.each(['wager','final-wager'])('preserves the selected amount after a failed %s and retry',async phase=>{
 const set={title:'Quiz',rounds:[{name:'Round',mode:'turns',multiplier:1,categories:[{name:'A',clues:[{value:300,clue:'Question',answer:'Answer',daily_double:true}]}]}],final:{category:'Final',clue:'Question',answer:'Answer'}};
 const state={set,phase,roundIndex:0,active:{cat:0,row:0,clue:set.rounds[0].categories[0].clues[0]},isDailyDouble:true,answeringTeamId:'team_1',turnTeamId:'team_1',finalWagers:{},finalJudged:{},scores:{team_1:0,team_2:0},teamIds:['team_1','team_2'],cursor:{cat:0,row:0},used:{}};
 fetchSession.mockResolvedValue({state});sendJeopardyCommand.mockRejectedValue(new Error('Temporary connection failure'));
 render(<RemoteJeopardy sessionId="test-session" seats={[{id:'team_1',name:'Blue Team',members:[]},{id:'team_2',name:'Gold Team',members:[]}]}/>);
 await screen.findByRole('button',{name:'Lock wager'});
 fireEvent.keyDown(window,{key:'ArrowLeft'});fireEvent.keyDown(window,{key:'Enter'});
 expect(screen.getByText('200',{exact:true})).toBeVisible();
 fireEvent.keyDown(window,{key:'ArrowRight'});fireEvent.keyDown(window,{key:'Enter'});
 await screen.findByRole('alert');fireEvent.keyDown(window,{key:'Enter'});
 await screen.findByRole('button',{name:'Lock wager'});
 expect(screen.getByText('200',{exact:true})).toBeVisible();
});
