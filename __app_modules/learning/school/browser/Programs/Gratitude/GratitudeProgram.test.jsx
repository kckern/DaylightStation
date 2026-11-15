import { it,expect,vi } from 'vitest';
import { render,screen,fireEvent,waitFor,act } from '@testing-library/react';
import GratitudeProgram from './GratitudeProgram.jsx';
const api=vi.hoisted(()=>({open:vi.fn(),submit:vi.fn(),retry:vi.fn(),take:vi.fn(),draft:vi.fn()}));
let receiveTake;
vi.mock('../shared/useTakeRecorder.js',()=>({default:({onTake})=>{receiveTake=onTake;return {phase:'idle',unavailable:false,stream:null,start:vi.fn(),stop:vi.fn()};}}));
vi.mock('./gratitudeApi.js',()=>({createGratitudeApi:()=>api}));
vi.mock('./gratitudeLog.js',()=>({gratitudeLog:new Proxy({},{get:()=>()=>{}})}));
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
  fireEvent.click(screen.getByRole('button',{name:/Back to School/}));expect(exit).toHaveBeenCalled();
});
