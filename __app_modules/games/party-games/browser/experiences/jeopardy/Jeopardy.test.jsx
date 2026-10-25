import React from 'react';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
import Jeopardy from './Jeopardy.jsx';
import {fetchSession} from '../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js';
import {sendJeopardyCommand} from './jeopardyClient.js';
const ws=vi.hoisted(()=>({handler:null}));
vi.mock('@/hooks/useWebSocket.js',()=>({useWebSocketSubscription:(_,fn)=>{ws.handler=fn;}}));
vi.mock('../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js',()=>({fetchSession:vi.fn()}));
vi.mock('./jeopardyClient.js',()=>({sendJeopardyCommand:vi.fn()}));
const set={title:'Quiz',open_book:true,rounds:[0,1].map(()=>({name:'Round',mode:'turns',categories:[{name:'Pictures',clues:[{value:100,clue:'Question',answer:'Answer'}]}]})),final:{category:'Final',clue:'Final question',answer:'Final answer'}};
const base={set,phase:'board',roundIndex:0,active:null,revealed:false,turnTeamId:'team_1',scores:{team_1:0},attempted:[],cursor:{cat:0,row:0},used:{},finalWagers:{},finalJudged:{}};
const teams=[{id:'team_1',name:'Blue Team',members:[]}];
beforeEach(()=>{fetchSession.mockReset();sendJeopardyCommand.mockReset();});
it.each(['round-intro','board','wager','clue','judging','final-category','final-wager','final-clue','final-judging'])('TV input never mutates %s',async phase=>{
 fetchSession.mockResolvedValue({state:{...base,phase,answeringTeamId:'team_1',active:{cat:0,row:0,clue:set.rounds[0].categories[0].clues[0]}}});
 const remote=vi.fn();render(<Jeopardy sessionId="test" seats={teams} registerRemoteAction={remote}/>);
 await waitFor(()=>expect(document.querySelector('.jeopardy')).toHaveAttribute('data-phase',phase));
 for(const key of ['Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'])fireEvent.keyDown(window,{key});
 screen.queryAllByRole('gridcell').forEach(tile=>fireEvent.click(tile));
 if(phase!=='round-intro')expect(screen.queryByRole('img',{name:/Scan/})).toBeNull();
 expect(remote).not.toHaveBeenCalled();expect(sendJeopardyCommand).not.toHaveBeenCalled();
 expect(screen.queryAllByRole('button')).toHaveLength(0);expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
});
it.each([[0,{},true],[1,{},false],[0,{'0:0:0':true},false]])('only initial intro has QR (%s)',async(roundIndex,used,qr)=>{
 fetchSession.mockResolvedValue({state:{...base,phase:'round-intro',roundIndex,used}});render(<Jeopardy sessionId="test" seats={teams}/>);
 await screen.findByText('Quiz',{exact:false});expect(Boolean(document.querySelector('img[src*="qrcode"]'))).toBe(qr);
});
it('recovers authoritative scores after a failed refresh without replaying commands',async()=>{
 fetchSession.mockResolvedValueOnce({state:base}).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({state:{...base,scores:{team_1:100}}});
 render(<Jeopardy sessionId="test" seats={teams}/>);await screen.findByTestId('jeopardy-board');
 await act(async()=>ws.handler({kind:'session-updated',sessionId:'test'}));
 fireEvent.click(await screen.findByRole('button',{name:'Retry connection'}));
 await screen.findByTestId('jeopardy-board');expect(screen.getByLabelText('Blue Team score')).toHaveTextContent('100');expect(sendJeopardyCommand).not.toHaveBeenCalled();
});
it('preserves hosted hardware buzzer dispatch',async()=>{
 const hosted={...set,open_book:false,rounds:[{...set.rounds[0],mode:'hosted'}]};
 const state={...base,set:hosted,phase:'clue',active:{cat:0,row:0,clue:set.rounds[0].categories[0].clues[0]}};
 fetchSession.mockResolvedValue({state});sendJeopardyCommand.mockResolvedValue({state});let buzz;
 render(<Jeopardy sessionId="test" seats={teams} gamingServices={{buzzers:{subscribe:fn=>{buzz=fn;return()=>{};},arm:vi.fn(),disarm:vi.fn()}}}/>);
 await screen.findByTestId('clue-screen');await act(async()=>buzz('team_1'));expect(sendJeopardyCommand).toHaveBeenCalledWith('test',{type:'BUZZ',teamId:'team_1'});
});
it('remounts fresh lobby after completion and ignores late old refresh',async()=>{
 let late;const completed={outcome:{kind:'completed'},scores:[]};const finish=vi.fn();
 fetchSession.mockResolvedValueOnce({state:{...base,phase:'done'},result:completed}).mockReturnValueOnce(new Promise(resolve=>{late=resolve;})).mockResolvedValueOnce({state:{...base,phase:'round-intro'}}).mockResolvedValueOnce({state:{...base,phase:'done'},result:completed});
 const view=render(<Jeopardy key="old" sessionId="old" seats={teams} onComplete={finish}/>);
 await waitFor(()=>expect(finish).toHaveBeenCalledTimes(1));
 act(()=>ws.handler({kind:'session-updated',sessionId:'old'}));
 view.rerender(<Jeopardy key="new" sessionId="new" seats={teams} onComplete={finish}/>);
 await screen.findByRole('img',{name:/Scan/});
 await act(async()=>late({state:{...base,phase:'board'}}));expect(screen.getByRole('img',{name:/Scan/})).toBeVisible();
 await act(async()=>ws.handler({kind:'session-updated',sessionId:'new'}));await waitFor(()=>expect(finish).toHaveBeenCalledTimes(2));
});
it('open book ignores legacy and default clue timers for sixty seconds',async()=>{
 vi.useFakeTimers();fetchSession.mockResolvedValue({state:{...base,set:{...set,rounds:[{...set.rounds[0],timer_seconds:25}]},phase:'clue',active:{cat:0,row:0,clue:set.rounds[0].categories[0].clues[0]}}});
 const view=render(<Jeopardy sessionId="test" seats={teams} config={{defaults:{timer_seconds:12}}}/>);
 await act(async()=>{await Promise.resolve();});act(()=>vi.advanceTimersByTime(60000));expect(sendJeopardyCommand).not.toHaveBeenCalled();expect(screen.queryByText('Answer',{exact:true})).toBeNull();expect(document.querySelector('.gp-timerring')).toBeNull();view.unmount();vi.useRealTimers();
});
