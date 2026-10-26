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
 await screen.findByTestId('clue-screen');await act(async()=>buzz('team_1'));expect(sendJeopardyCommand).toHaveBeenCalledWith('test',{type:'BUZZ',teamId:'team_1'},expect.objectContaining({expectedContext:expect.objectContaining({phase:'clue'})}));
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

it('acknowledges canonical selection for exactly 500ms without buzzing and skips it on direct clue load', async () => {
 vi.useFakeTimers();
 const next={...base,phase:'clue',active:{cat:0,row:0,clue:set.rounds[0].categories[0].clues[0]}};
 fetchSession.mockResolvedValueOnce({state:base}).mockResolvedValueOnce({state:next});
 const buzzers={subscribe:()=>()=>{},arm:vi.fn(),disarm:vi.fn()};
 const view=render(<Jeopardy sessionId="test" seats={teams} gamingServices={{buzzers}}/>);
 await act(async()=>{});
 expect(screen.getByText('Blue Team — choose the next question')).toBeVisible();
 await act(async()=>ws.handler({kind:'session-updated',sessionId:'test'}));
 expect(screen.getByTestId('jeopardy-board')).toBeVisible();
 expect(screen.getByRole('gridcell')).toHaveClass('is-selected');
 expect(screen.queryByTestId('clue-screen')).toBeNull();
 act(()=>vi.advanceTimersByTime(499));expect(screen.queryByTestId('clue-screen')).toBeNull();
 act(()=>vi.advanceTimersByTime(1));expect(screen.getByTestId('clue-screen')).toBeVisible();
 expect(sendJeopardyCommand).not.toHaveBeenCalled();
 view.unmount();
 fetchSession.mockResolvedValue({state:next});
 const direct=render(<Jeopardy sessionId="new" seats={teams}/>);await act(async()=>{});
 expect(screen.getByTestId('clue-screen')).toBeVisible();
 direct.unmount();vi.useRealTimers();
});

it('keeps the visible chooser aligned with canonical turns after assigned misses and ordinary correct answers', async () => {
 const {jeopardyRuleModule: rules}=await import('../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs');
 const seats=[{id:'red',name:'Red',color:'#f00'},{id:'blue',name:'Blue',color:'#00f'}];
 const pack={open_book:true,rounds:[{mode:'hosted',categories:[{name:'Mixed',clues:[{value:100,little_kids:true,clue:'Kids',answer:'One'},{value:200,clue:'Regular',answer:'Two'},{value:300,clue:'Remaining',answer:'Three'}]}]}]};
 let state={...rules.createInitialState(pack,{seats}),phase:'board'}; let revision=0;
 fetchSession.mockImplementation(async()=>({header:{revision},state}));
 render(<Jeopardy sessionId="choose" seats={seats}/>);
 await screen.findByText('Red — choose the next question');
 const host=async actions=>{for(const action of actions){const result=rules.handleCommand(state,action,pack,{actorId:'host'});state=result.state;revision++;}await act(async()=>ws.handler({kind:'session-updated',sessionId:'choose'}));};
 await host([{type:'SELECT_AT',cat:0,row:0},{type:'REVEAL'},{type:'JUDGE',correct:false}]);
 expect(screen.getByText('Red — choose the next question')).toBeVisible();
 await host([{type:'SELECT_AT',cat:0,row:1},{type:'BUZZ',teamId:'blue'},{type:'JUDGE',correct:true}]);
 expect(screen.getByText('Blue — choose the next question')).toBeVisible();
 expect(document.querySelector('.jp-choose').style.getPropertyValue('--team-color')).toBe('#00f');
});

it('plays accepted phone-host action cues once and stays silent on duplicate/replayed snapshots and direct clue refresh', async () => {
 const {jeopardyRuleModule:rules}=await import('../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs');
 const pack={...set,rounds:[{...set.rounds[0],mode:'turns',penalize_wrong:false,categories:[{name:'Two',clues:[{value:100,clue:'One',answer:'A'},{value:200,clue:'Two',answer:'B'}]}]}]};
 let state=rules.createInitialState(pack,{seats:teams});let revision=0;
 const audio={play:vi.fn(),stopChannel:vi.fn()};
 fetchSession.mockImplementation(async()=>({header:{revision},state}));
 const view=render(<Jeopardy sessionId="audio" seats={teams} gamingServices={{audio}}/>);
 await screen.findByText('Ready to play');audio.play.mockClear();
 const phone=async (command,observe=true)=>{const result=rules.handleCommand(state,command,pack,{actorId:'host',revision});expect(result.error).toBeUndefined();state=result.state;revision++;if(observe)await act(async()=>ws.handler({kind:'session-updated',sessionId:'audio'}));};
 await phone({type:'START_ROUND'});expect(audio.play).toHaveBeenCalledWith('board-fill',{pack:'jeopardy'});
 await phone({type:'SELECT_AT',cat:0,row:0});expect(audio.play).toHaveBeenCalledWith('reveal',{pack:'jeopardy'});
 await phone({type:'REVEAL'});await phone({type:'JUDGE',correct:false},false);
 await phone({type:'BUZZER_SETUP',epoch:'audio-tv'},false);
 await phone({type:'BUZZER_PRESENCE',epoch:'audio-tv'}); // heartbeat must preserve unobserved wrong cue
 expect(state.scores.team_1).toBe(0);expect(audio.play).toHaveBeenCalledWith('wrong',{pack:'jeopardy'});
 const heard=audio.play.mock.calls.length;
 await act(async()=>ws.handler({kind:'session-updated',sessionId:'audio'}));
 expect(audio.play.mock.calls.length).toBe(heard);
 // An unrelated accepted setup/presence snapshot must not replay judgment.
 revision++;await act(async()=>ws.handler({kind:'session-updated',sessionId:'audio'}));
 expect(audio.play.mock.calls.length).toBe(heard);
 await phone({type:'SELECT_AT',cat:0,row:1});
 view.unmount();audio.play.mockClear();
 const direct=render(<Jeopardy sessionId="direct-audio" seats={teams} gamingServices={{audio}}/>);
 await screen.findByTestId('clue-screen');expect(audio.play).not.toHaveBeenCalledWith('reveal',{pack:'jeopardy'});
 direct.unmount();
});

it.each([true,false])('local timeout cue follows accepted=%s and never doubles on its WS echo', async accepted => {
 const {jeopardyRuleModule:rules}=await import('../../../../../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs');
 vi.useFakeTimers();
 const pack={...set,open_book:false,rounds:[{...set.rounds[0],mode:'hosted',timer_seconds:1}]};
 let state={...rules.createInitialState(pack,{seats:teams}),phase:'clue',active:{cat:0,row:0,clue:pack.rounds[0].categories[0].clues[0]}};let revision=0;
 const audio={play:vi.fn(),stopChannel:vi.fn()};
 fetchSession.mockImplementation(async()=>({header:{revision},state}));
 sendJeopardyCommand.mockImplementation(async()=>{if(!accepted)throw new Error('Rejected');state=rules.handleCommand(state,{type:'TIMEOUT'},pack,{actorId:'host',revision}).state;revision++;return{header:{revision},state};});
 const view=render(<Jeopardy sessionId="local-audio" seats={teams} gamingServices={{audio}}/>);
 await act(async()=>{});await act(async()=>vi.advanceTimersByTime(1200));
 expect(audio.play.mock.calls.filter(([cue])=>cue==='time-up')).toHaveLength(accepted?1:0);
 if(accepted){await act(async()=>ws.handler({kind:'session-updated',sessionId:'local-audio'}));expect(audio.play.mock.calls.filter(([cue])=>cue==='time-up')).toHaveLength(1);}
 view.unmount();vi.useRealTimers();
});

it('hides pregame scores and renders durable answer review and round decision', async () => {
 fetchSession.mockResolvedValue({state:{...base,phase:'round-intro'}});
 const view=render(<Jeopardy sessionId="ready" seats={teams}/>);
 await screen.findByTestId('host-lobby');
 expect(screen.queryByTestId('scoreboard')).toBeNull();
 view.unmount();
 fetchSession.mockResolvedValue({state:{...base,phase:'answer-review',active:{cat:0,row:0,clue:set.rounds[0].categories[0].clues[0]},answerReview:{teamId:'team_1',correct:true,scoreDelta:100,judgmentPending:false}}});
 const review=render(<Jeopardy sessionId="review" seats={teams}/>);
 await screen.findByText('Answer',{exact:true});
 expect(screen.getByText(/Next question on your phone/)).toBeVisible();
 review.unmount();
 fetchSession.mockResolvedValue({state:{...base,phase:'round-decision'}});
 render(<Jeopardy sessionId="decision" seats={teams}/>);
 expect(await screen.findByText('Round 1 complete')).toBeVisible();
});
