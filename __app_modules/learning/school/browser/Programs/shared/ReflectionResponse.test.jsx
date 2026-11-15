import { fireEvent, render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReflectionResponse from './ReflectionResponse.jsx';

const recorder = vi.hoisted(() => ({ phase: 'idle', unavailable: false, start: vi.fn(), stop: vi.fn(), stream: null, verdict: null }));
let receive;
vi.mock('./useTakeRecorder.js', () => ({ default: ({ onTake }) => { receive = onTake; return recorder; } }));
vi.mock('../SentenceLadder/rungs/VoiceBand.jsx', () => ({ default: () => null }));
const prompt = { id: 'gratitude', text: 'What are you grateful for?', required: true };

describe('shared reflection response', () => {
  it('saves an unsent typed draft on blur using the same input metadata', () => {
    const draft=vi.fn();
    render(<ReflectionResponse prompt={prompt} onSubmit={vi.fn()} onDraft={draft}/>);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'My family'}});
    fireEvent.blur(screen.getByRole('textbox'));
    expect(draft).toHaveBeenCalledWith({text:'My family',via:'typed',audioRef:null,edited:false});
  });
  beforeEach(() => { recorder.phase = 'idle'; recorder.unavailable = false; vi.clearAllMocks(); });
  it('typing spaces and composing Enter are ordinary text input', () => {
    const submit = vi.fn();
    render(<ReflectionResponse prompt={prompt} onTake={vi.fn()} onSubmit={submit} />);
    const field = screen.getByRole('textbox');
    expect(fireEvent.keyDown(field, { key: ' ', code: 'Space' })).toBe(true);
    fireEvent.change(field, { target: { value: 'My toys' } });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(submit).toHaveBeenCalledWith({ text: 'My toys', via: 'typed', audioRef: null, edited: false });
  });
  it('saving recorder blocks submission before the final take callback', () => {
    recorder.phase = 'saving';
    const submit = vi.fn();
    render(<ReflectionResponse prompt={prompt} initial="Old draft" onTake={vi.fn()} onSubmit={submit} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
  });
  it('failed upload preserves the draft and offers retry without a stuck busy state', async () => {
    render(<ReflectionResponse prompt={prompt} initial="My dog" onTake={async () => { throw new Error('offline'); }} onSubmit={vi.fn()} />);
    await act(async () => { await receive({ blob: new Blob(['audio']) }); });
    expect(screen.getByRole('textbox')).toHaveValue('My dog');
    expect(screen.getByRole('status')).toHaveTextContent(/try again/i);
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
  });
  it('retries a failed upload with the original blob and appends its transcript once',async()=>{
    let succeeds=false;
    const blob=new Blob(['saved voice']);
    const upload=vi.fn(async received=>{expect(received).toBe(blob);if(!succeeds)throw new Error('response lost');return {audioRef:'child/take.webm',text:'My toys'};});
    render(<ReflectionResponse prompt={prompt} onTake={upload} onSubmit={vi.fn()}/>);
    await act(async()=>{await receive({blob});});
    succeeds=true;
    fireEvent.click(screen.getByRole('button',{name:'Retry recording upload'}));
    await screen.findByDisplayValue('My toys');
    expect(upload).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button',{name:'Retry recording upload'})).toBeNull();
  });
  it('a corrected transcript retains its audio and records that it was edited', async () => {
    const submit = vi.fn();
    render(<ReflectionResponse prompt={prompt} onTake={async () => ({ audioRef: 'learner/take.webm', text: 'My dog' })} onSubmit={submit} />);
    await act(async () => { await receive({ blob: new Blob(['audio']) }); });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My dog helping me' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(submit).toHaveBeenCalledWith({ text: 'My dog helping me', via: 'voice', audioRef: 'learner/take.webm', edited: true });
  });
  it('no microphone leaves typing available', () => {
    recorder.unavailable = true;
    const submit = vi.fn();
    render(<ReflectionResponse prompt={prompt} onSubmit={submit} />);
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Family' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ text: 'Family', via: 'typed' }));
  });
  it('a refused take releases the Stop guard so the typed draft remains submittable', () => {
    recorder.phase = 'recording';
    const props = { prompt, initial: 'My dog', onSubmit: vi.fn(), onTake: vi.fn() };
    const { rerender } = render(<ReflectionResponse {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    recorder.phase = 'idle'; recorder.verdict = 'too-short';
    rerender(<ReflectionResponse {...props} />);
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
    recorder.verdict = null;
  });
});
