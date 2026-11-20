import { it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor,act } from '@testing-library/react';
import GratitudeProgram from './GratitudeProgram.jsx';
const api=vi.hoisted(()=>({open:vi.fn(),submit:vi.fn(),retry:vi.fn(),take:vi.fn(),draft:vi.fn()}));
let receiveTake;
vi.mock('../shared/useTakeRecorder.js',()=>({default:({onTake})=>{receiveTake=onTake;return {phase:'idle',unavailable:false,stream:null,start:vi.fn(),stop:vi.fn()};}}));
vi.mock('./gratitudeApi.js',()=>({createGratitudeApi:()=>api}));
const log=vi.hoisted(()=>({}));
vi.mock('./gratitudeLog.js',()=>({gratitudeLog:new Proxy(log,{get:(target,name)=>(target[name]??=vi.fn())})}));
const initial={learnerId:'child',studyDay:'2026-11-16',today:'2026-11-16',serverNow:'2026-11-16T18:00:00Z',phase:'draft',draft:null,prompt:{id:'gratitude',text:'What are you grateful for today?',required:true},retryAt:null,attemptId:null};
it('reuses its take identity when a saved upload loses its response',async()=>{
  api.open.mockResolvedValue({ok:true,data:initial});api.take.mockReset();
  api.take.mockResolvedValueOnce({ok:false,status:0,data:null}).mockResolvedValueOnce({ok:true,data:{audioRef:'child/saved.webm',text:'My toys'}});
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}}/>);
  await screen.findByRole('textbox');const blob=new Blob(['voice']);
  await act(async()=>{await receiveTake({blob});});
  fireEvent.click(screen.getByRole('button',{name:'Retry recording upload'}));
  await screen.findByDisplayValue('My toys');
  expect(api.take.mock.calls[0][2]).toBe(api.take.mock.calls[1][2]);
  expect(api.take.mock.calls[0][1]).toBe(blob);expect(api.take.mock.calls[1][1]).toBe(blob);
});
it('accepts typing and displays the saved concise gratitude subject',async()=>{
  api.open.mockResolvedValue({ok:true,data:initial});
  api.submit.mockResolvedValue({ok:true,data:{...initial,phase:'completed',subject:'Toys'}});
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}} />);
  fireEvent.change(await screen.findByRole('textbox'),{target:{value:"I'm grateful for my toys"}});
  fireEvent.click(screen.getByRole('button',{name:/Submit/}));
  expect(await screen.findByText('Toys',{exact:true})).toBeVisible();
  expect(api.submit).toHaveBeenCalledWith('2026-11-16',expect.objectContaining({text:"I'm grateful for my toys",via:'typed'}));
});
it('disables new answers during a server-enforced cooldown and permits leaving',async()=>{
  api.open.mockResolvedValue({ok:true,data:{...initial,phase:'cooldown',reason:'repetition',retryAt:'2026-11-16T18:30:00Z'}});
  const exit=vi.fn();render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={exit} />);
  await waitFor(()=>expect(screen.getByText(/already used/i)).toBeVisible());
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(exit).toHaveBeenCalled();
  expect(log.closed).toHaveBeenCalledWith({phase:'cooldown'});
});
it('opens without raising the keyboard and offers one close control', async () => {
  api.open.mockResolvedValue({ok:true,data:initial});
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}}/>);
  const box=await screen.findByRole('textbox');
  expect(document.activeElement).not.toBe(box);
  expect(screen.getByRole('button',{name:'Close'})).toBeVisible();
  expect(screen.queryByRole('button',{name:/Back to School/})).toBeNull();
});
it('says the recording is being written down, then what to do next', async () => {
  api.open.mockResolvedValue({ok:true,data:initial});api.take.mockReset();
  let finish;api.take.mockReturnValue(new Promise(r=>{finish=r;}));
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}}/>);
  const box=await screen.findByRole('textbox');
  let upload;act(()=>{upload=receiveTake({blob:new Blob(['voice'])});});
  expect(await screen.findByText('Writing down what you said…')).toBeVisible();
  expect(log.transcribing).toHaveBeenCalledWith({promptId:'gratitude'});
  await act(async()=>{finish({ok:true,data:{audioRef:'child/a.webm',text:'I am grateful for eating cookies.'}});await upload;});
  expect(screen.getByText('Check your words, then tap Submit.')).toBeVisible();
  expect(document.activeElement).not.toBe(box);
});
const followUp={...initial,phase:'follow-up',attemptId:'a1',followUp:{question:'What about your mom are you grateful for today?',firstText:"I'm grateful for my mom"}};
it('asks the follow-up with the first answer shown and sends the answer as a follow-up',async()=>{
  api.open.mockResolvedValue({ok:true,data:initial});
  api.submit.mockReset().mockResolvedValueOnce({ok:true,data:followUp}).mockResolvedValueOnce({ok:true,data:{...initial,phase:'completed',subject:'Mom making pancakes'}});
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}}/>);
  fireEvent.change(await screen.findByRole('textbox'),{target:{value:"I'm grateful for my mom"}});
  fireEvent.click(screen.getByRole('button',{name:/Submit/}));
  expect(await screen.findByText('What about your mom are you grateful for today?')).toBeVisible();
  expect(screen.getByText(/I'm grateful for my mom/)).toBeVisible();
  expect(screen.queryByText(/a little clearer/)).toBeNull();
  const box=screen.getByRole('textbox');expect(box).toHaveValue('');expect(document.activeElement).not.toBe(box);
  expect(log.followUpShown).toHaveBeenCalledWith({promptId:'gratitude-follow-up'});
  fireEvent.change(box,{target:{value:'She made me pancakes'}});
  fireEvent.click(screen.getByRole('button',{name:/Submit/}));
  expect(await screen.findByText('Mom making pancakes',{exact:true})).toBeVisible();
  expect(api.submit.mock.calls[1][1]).toMatchObject({text:'She made me pancakes',followUpOf:'a1'});
  expect(api.submit.mock.calls[1][1].attemptId).not.toBe(api.submit.mock.calls[0][1].attemptId);
});
it('saves drafts while answering the follow-up',async()=>{
  api.open.mockResolvedValue({ok:true,data:followUp});api.draft.mockReset().mockResolvedValue({ok:true,data:followUp});
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}}/>);
  const box=await screen.findByRole('textbox');
  fireEvent.change(box,{target:{value:'pan'}});fireEvent.blur(box);
  await waitFor(()=>expect(api.draft).toHaveBeenCalled());
});
it('moves a stale first-prompt tab to the follow-up on a 409 and still shows why',async()=>{
  api.open.mockResolvedValue({ok:true,data:initial});
  api.submit.mockReset().mockResolvedValueOnce({ok:false,status:409,data:{error:'Please answer the follow-up question.'}});
  api.day=vi.fn().mockResolvedValue({ok:true,data:followUp});
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}}/>);
  fireEvent.change(await screen.findByRole('textbox'),{target:{value:'my mom'}});
  fireEvent.click(screen.getByRole('button',{name:/Submit/}));
  expect(await screen.findByText('What about your mom are you grateful for today?')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Please answer the follow-up question.');
  expect(api.day).toHaveBeenCalledWith('2026-11-16');
});
it('starts a new attempt after a saved answer is retried into an unclear verdict',async()=>{
  const pendingView={...initial,phase:'pending',attemptId:'a1',draft:{text:'my toys',via:'typed',audioRef:null,edited:false}};
  api.open.mockResolvedValue({ok:true,data:initial});
  api.submit.mockReset().mockResolvedValueOnce({ok:true,data:pendingView}).mockResolvedValueOnce({ok:true,data:{...initial,phase:'completed',subject:'Toys'}});
  // The server opens the retry box empty (2026-11-19), so the child says it again.
  api.retry.mockReset().mockResolvedValue({ok:true,data:{...pendingView,phase:'retry',reason:'unclear',draft:null}});
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}}/>);
  fireEvent.change(await screen.findByRole('textbox'),{target:{value:'my toys'}});
  fireEvent.click(screen.getByRole('button',{name:/Submit/}));
  fireEvent.click(await screen.findByRole('button',{name:'Try saved answer again'}));
  await screen.findByText(/a little clearer/);
  expect(screen.getByRole('textbox')).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'my toys'}});
  fireEvent.click(screen.getByRole('button',{name:/Submit/}));
  await screen.findByText('Toys',{exact:true});
  expect(api.submit.mock.calls[1][1].text).toBe('my toys');
  expect(api.submit.mock.calls[1][1].attemptId).not.toBe(api.submit.mock.calls[0][1].attemptId);
});
it('ties the follow-up box to the "You said" line for screen readers',async()=>{
  api.open.mockResolvedValue({ok:true,data:followUp});
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}}/>);
  const box=await screen.findByRole('textbox');
  const said=screen.getByText(/You said/);
  expect(said.id).toBeTruthy();expect(box).toHaveAttribute('aria-describedby',said.id);
  expect(box).toHaveAccessibleDescription(/I'm grateful for my mom/);
});
it('shows whose Gratitude this is in the header',async()=>{
  api.open.mockResolvedValue({ok:true,data:initial});
  render(<GratitudeProgram learnerId="kid" learnerName="Kid" gratitudeGrant="grant" today="2026-11-16" onExit={()=>{}}/>);
  await screen.findByRole('textbox');
  const header=screen.getByRole('banner');
  expect(header).toHaveTextContent('Kid');
  expect(header.querySelector('img[src*="/img/users/kid"]')).toBeTruthy();
});
