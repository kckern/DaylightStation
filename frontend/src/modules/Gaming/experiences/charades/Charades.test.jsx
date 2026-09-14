import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Charades from './Charades.jsx';
import { fetchSession, sendRuleCommand } from '@gaming/platform/api/sessionClient.js';
const ws = vi.hoisted(() => ({ handler: null }));
vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: (_topic, handler) => { ws.handler = handler; } }));
vi.mock('@gaming/platform/api/sessionClient.js', () => ({ fetchSession: vi.fn(), sendRuleCommand: vi.fn() }));
vi.mock('@/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx', () => ({default: ({onComplete,onResult}) => <><button onClick={onResult}>Complete selection</button><button onClick={onComplete}>Complete wheel</button></>}));
const seats = [{id:'a',name:'Alice', color:'#3273dc', members:[{id:'a',name:'Alice',avatar:'/alice.jpg'}]}];
const state = { competition:false,phase:'challenge-ready',round:1,performer_id:'a',challenge:{prompt:'Rabbit',decoder:{image:'/rabbit.svg'}},clue_presentation:'image',challenge_index:0,turn_order:['a'] };
const sound_cues={pack:'charades',volume:0.4,performer_selected:'performer-selected',clue_revealed:'clue-revealed',acting_started:'acting-started',time_up:'time-up',turn_finished:'turn-finished',handoff:'handoff',game_finished:'game-finished'};
const view = (s=state, revision=1) => ({state:s,header:{revision},definition:{competition:false,rounds:1,timer_ms:60000,sound_cues,guessing_music:{source:'test:music',volume:0.2,order:'shuffle',repeat:'one',memory:'session'}},result:null});
beforeEach(() => { fetchSession.mockReset().mockResolvedValue(view()); sendRuleCommand.mockReset(); });
it('shows image decoder and Go without leaking answer, then hides clue while acting and reveals neutrally', async () => {
 const music = {start:vi.fn(() => vi.fn())}; const audio = {play:vi.fn()};
 const {container} = render(<Charades sessionId="one" seats={seats} gamingServices={{music,audio}} />);
 const go = await screen.findByRole('button',{name:'Go'}); expect(screen.queryByText('Rabbit')).toBeNull();
 expect(go.parentElement).toHaveClass('charades__center', 'charades__with-footer');
 expect(go.previousElementSibling).toHaveClass('charades__stage-content');
 expect(go.firstElementChild?.tagName).toBe('svg');
 expect(screen.getByRole('img',{name:'Round 1 of 1'})).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'Alice'})).toHaveAttribute('src','/alice.jpg');
 expect(screen.getByRole('heading',{name:'Charades'})).toBeInTheDocument();
 expect(screen.queryByText('Secret clue')).toBeNull();
 expect(screen.queryByText(/Performer only/)).toBeNull();
 expect(screen.getByTestId('image-decoder-subject').style.maskImage).toContain('/rabbit.svg');
 expect(screen.queryByRole('img',{name:'Rabbit'})).toBeNull();
 sendRuleCommand.mockResolvedValueOnce(view({...state,phase:'performing',deadline:Date.now()+60000},2)); fireEvent.click(go);
 const finish = await screen.findByRole('button',{name:'Finish turn'}); expect(screen.queryByTestId('image-decoder-subject')).toBeNull();
 expect(audio.play).toHaveBeenCalledWith('acting-started',{pack:'charades',volume:0.4});
 expect(finish.parentElement).toHaveClass('charades__center', 'charades__with-footer');
 expect(finish.previousElementSibling).toHaveClass('charades__stage-content');
 expect(screen.getByRole('timer')).toHaveAccessibleName(/seconds remaining/);
 expect(screen.getByRole('list',{name:'Charades rules'})).toHaveTextContent('No talkingNo spellingNo pointing');
 expect(screen.queryByText(/Act it out/)).toBeNull();
 expect(finish.querySelector('svg')).not.toBeNull();
 expect(screen.queryByRole('img',{name:'Rabbit'})).toBeNull();
 sendRuleCommand.mockResolvedValueOnce(view({...state,phase:'challenge-complete'},3)); fireEvent.click(screen.getByRole('button',{name:'Finish turn'}));
 expect(await screen.findByText('Rabbit')).toBeInTheDocument();
 expect(audio.play).toHaveBeenCalledWith('turn-finished',{pack:'charades',volume:0.4});
 expect(screen.getByRole('img',{name:'Rabbit'})).toHaveAttribute('src','/rabbit.svg');
 const revealContent = container.querySelector('.charades__reveal-content');
 expect(revealContent).toContainElement(screen.getByRole('heading',{name:'Rabbit'}));
 expect(revealContent).toContainElement(screen.getByRole('img',{name:'Rabbit'}));
 expect(revealContent).not.toContainElement(screen.getByRole('button',{name:'Finish game'}));
 expect(screen.queryByText('The clue was')).toBeNull();
 expect(screen.queryByText('Thanks for acting!')).toBeNull();
 expect(screen.getByRole('button',{name:'Finish game'}).firstElementChild?.tagName).toBe('svg');
 expect(screen.queryByTestId('image-decoder-subject')).toBeNull();
 expect(screen.queryByText(/score committed|wins/i)).toBeNull(); expect(screen.getByRole('button',{name:'Finish game'})).toBeEnabled();
});
it('drops concurrent commands and ignores an older refresh after a command response', async () => {
 render(<Charades sessionId="one" seats={seats} />); const go=await screen.findByRole('button',{name:'Go'});
 let refresh; fetchSession.mockImplementationOnce(() => new Promise(resolve => {refresh=resolve;}));
 act(() => ws.handler({kind:'session-updated',sessionId:'one'}));
 let command; sendRuleCommand.mockImplementation(() => new Promise(resolve => {command=resolve;}));
 fireEvent.click(go); fireEvent.click(go); expect(sendRuleCommand).toHaveBeenCalledTimes(1);
 await act(async () => command(view({...state,phase:'performing',deadline:Date.now()+60000},3)));
 await act(async () => refresh(view(state,2)));
 expect(screen.getByRole('button',{name:'Finish turn'})).toBeInTheDocument();
});
it('automatically advances from performer wheel completion', async () => {
 fetchSession.mockResolvedValue(view({...state,phase:'performer-ready'})); sendRuleCommand.mockResolvedValue(view());
 const audio={play:vi.fn()};render(<Charades sessionId="one" seats={seats} gamingServices={{audio}} />);
 expect(screen.queryByText('Alice')).toBeNull();
 fireEvent.click(await screen.findByRole('button',{name:'Complete selection'}));
 expect(audio.play).toHaveBeenCalledWith('performer-selected',{pack:'charades',volume:0.4});
 fireEvent.click(screen.getByRole('button',{name:'Complete wheel'}));
 await screen.findByRole('button',{name:'Go'}); expect(sendRuleCommand).toHaveBeenCalledWith('one',{type:'performer.ready'},undefined);
 expect(audio.play).toHaveBeenCalledWith('clue-revealed',{pack:'charades',volume:0.4});
});

it('keeps competitive performer instructions in the centered stage', async () => {
 fetchSession.mockResolvedValue(view({...state,competition:true,phase:'performer-ready'}));
 render(<Charades sessionId="one" seats={seats}/>);
 const section=(await screen.findByRole('button',{name:'Reveal with decoder'})).closest('.charades__center');
 expect(section).toHaveClass('charades__center');
 expect(section).not.toHaveClass('charades__selector-stage');
});

it('keeps music playing across equivalent refreshed definitions and cleans it up at reveal', async () => {
 const stop=vi.fn();const music={start:vi.fn(()=>stop)};
 const performing={...state,phase:'performing',deadline:Date.now()+60000};
 fetchSession.mockResolvedValue(view(performing));
 render(<Charades sessionId="one" seats={seats} gamingServices={{music}}/>);
 await screen.findByRole('button',{name:'Finish turn'});await waitFor(()=>expect(music.start).toHaveBeenCalledTimes(1));
 expect(music.start).toHaveBeenCalledWith(expect.objectContaining({source:'test:music',order:'shuffle',repeat:'one',memory:'session'}),expect.objectContaining({sessionId:'one',turnKey:'0'}));
 fetchSession.mockResolvedValue(view({...performing},2));
 await act(async()=>ws.handler({kind:'session-updated',sessionId:'one'}));
 await waitFor(()=>expect(fetchSession).toHaveBeenCalledTimes(2));expect(music.start).toHaveBeenCalledTimes(1);expect(stop).not.toHaveBeenCalled();
 sendRuleCommand.mockResolvedValue(view({...state,phase:'challenge-complete'},3));fireEvent.click(screen.getByRole('button',{name:'Finish turn'}));
 await screen.findByText('Rabbit');await waitFor(()=>expect(stop).toHaveBeenCalledTimes(1));
});

it('retries a failed automatic wheel command without leaving the performer stuck',async()=>{
 fetchSession.mockResolvedValue(view({...state,phase:'performer-ready'}));sendRuleCommand.mockRejectedValueOnce(new Error('Network unavailable'));
 render(<Charades sessionId="one" seats={seats}/>);fireEvent.click(await screen.findByRole('button',{name:'Complete wheel'}));
 await screen.findByRole('alert');sendRuleCommand.mockResolvedValueOnce(view());fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 await screen.findByRole('button',{name:'Go'});expect(sendRuleCommand).toHaveBeenCalledTimes(2);
});

it('labels another clue within the same timed turn distinctly from the next performer',async()=>{
 const result=view({...state,phase:'challenge-complete',clue_index:0,remaining_ms:5000});result.definition.clues_per_turn=2;
 fetchSession.mockResolvedValue(result);render(<Charades sessionId="one" seats={seats}/>);
 expect(await screen.findByRole('button',{name:'Next clue'})).toBeEnabled();expect(screen.queryByRole('button',{name:'Next performer'})).toBeNull();
});

it('keeps text-only clue reveals free of a plain image even if a decoder asset is present',async()=>{
 fetchSession.mockResolvedValue(view({...state,phase:'challenge-complete',clue_presentation:'text'}));
 render(<Charades sessionId="one" seats={seats}/>);
 expect(await screen.findByText('Rabbit')).toBeInTheDocument();expect(screen.queryByRole('img',{name:'Rabbit'})).toBeNull();
});

it('registers remote Back as a rewind while the timer is running', async () => {
 const registerBackAction=vi.fn(handler=>{registerBackAction.handler=handler;return vi.fn();});
 fetchSession.mockResolvedValue(view({...state,phase:'performing',deadline:Date.now()+60000}));
 sendRuleCommand.mockResolvedValue(view(state,2));
 render(<Charades sessionId="one" seats={seats} registerBackAction={registerBackAction}/>);
 await screen.findByRole('button',{name:'Finish turn'});
 expect(registerBackAction.handler()).toBe(true);
 await waitFor(()=>expect(sendRuleCommand).toHaveBeenCalledWith('one',{type:'challenge.rewind'},undefined));
 await screen.findByRole('button',{name:'Go'});
});
