import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Charades from './Charades.jsx';
import { fetchSession, sendRuleCommand } from '@gaming/platform/api/sessionClient.js';
const ws = vi.hoisted(() => ({ handler: null }));
vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: (_topic, handler) => { ws.handler = handler; } }));
vi.mock('@gaming/platform/api/sessionClient.js', () => ({ fetchSession: vi.fn(), sendRuleCommand: vi.fn() }));
vi.mock('@/modules/AppContainer/Apps/FamilySelector/FamilySelector.jsx', () => ({default: ({onComplete}) => <button onClick={onComplete}>Complete wheel</button>}));
const seats = [{id:'a',name:'Alice', members:[]}];
const state = { competition:false,phase:'challenge-ready',round:1,performer_id:'a',challenge:{prompt:'Rabbit',decoder:{image:'/rabbit.svg'}},clue_presentation:'image',challenge_index:0,turn_order:['a'] };
const view = (s=state, revision=1) => ({state:s,header:{revision},definition:{competition:false,rounds:1,timer_ms:60000,guessing_music:{source:'test:music',volume:0.2,order:'shuffle',repeat:'after-cycle',memory:'session'}},result:null});
beforeEach(() => { fetchSession.mockReset().mockResolvedValue(view()); sendRuleCommand.mockReset(); });
it('shows image decoder and Go without leaking answer, then hides clue while acting and reveals neutrally', async () => {
 const music = {start:vi.fn(() => vi.fn())};
 render(<Charades sessionId="one" seats={seats} gamingServices={{music}} />);
 const go = await screen.findByRole('button',{name:'Go'}); expect(screen.queryByText('Rabbit')).toBeNull();
 expect(screen.getByTestId('image-decoder-subject').style.maskImage).toContain('/rabbit.svg');
 expect(screen.queryByRole('img',{name:'Rabbit'})).toBeNull();
 sendRuleCommand.mockResolvedValueOnce(view({...state,phase:'performing',deadline:Date.now()+60000},2)); fireEvent.click(go);
 await screen.findByRole('button',{name:'Finish turn'}); expect(screen.queryByTestId('image-decoder-subject')).toBeNull();
 expect(screen.queryByRole('img',{name:'Rabbit'})).toBeNull();
 sendRuleCommand.mockResolvedValueOnce(view({...state,phase:'challenge-complete'},3)); fireEvent.click(screen.getByRole('button',{name:'Finish turn'}));
 expect(await screen.findByText('Rabbit')).toBeInTheDocument();
 expect(screen.getByRole('img',{name:'Rabbit'})).toHaveAttribute('src','/rabbit.svg');
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
 render(<Charades sessionId="one" seats={seats} />); fireEvent.click(await screen.findByRole('button',{name:'Complete wheel'}));
 await screen.findByRole('button',{name:'Go'}); expect(sendRuleCommand).toHaveBeenCalledWith('one',{type:'performer.ready'},undefined);
});

it('keeps music playing across equivalent refreshed definitions and cleans it up at reveal', async () => {
 const stop=vi.fn();const music={start:vi.fn(()=>stop)};
 const performing={...state,phase:'performing',deadline:Date.now()+60000};
 fetchSession.mockResolvedValue(view(performing));
 render(<Charades sessionId="one" seats={seats} gamingServices={{music}}/>);
 await screen.findByRole('button',{name:'Finish turn'});expect(music.start).toHaveBeenCalledTimes(1);
 expect(music.start).toHaveBeenCalledWith(expect.objectContaining({source:'test:music',order:'shuffle',repeat:'after-cycle',memory:'session'}),expect.objectContaining({sessionId:'one'}));
 fetchSession.mockResolvedValue(view({...performing},2));
 await act(async()=>ws.handler({kind:'session-updated',sessionId:'one'}));
 await waitFor(()=>expect(fetchSession).toHaveBeenCalledTimes(2));expect(music.start).toHaveBeenCalledTimes(1);expect(stop).not.toHaveBeenCalled();
 sendRuleCommand.mockResolvedValue(view({...state,phase:'challenge-complete'},3));fireEvent.click(screen.getByRole('button',{name:'Finish turn'}));
 await screen.findByText('Rabbit');expect(stop).toHaveBeenCalledTimes(1);
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
