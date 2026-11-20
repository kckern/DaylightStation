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
  it('focuses the answer box on open by default and not when asked', () => {
    const { unmount } = render(<ReflectionResponse prompt={prompt} onTake={vi.fn()} onSubmit={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    unmount();
    render(<ReflectionResponse prompt={prompt} focusOnOpen={false} onTake={vi.fn()} onSubmit={vi.fn()} />);
    expect(document.activeElement).not.toBe(screen.getByRole('textbox'));
  });

  it('says what is happening while a recording is written down, then gives the next step without focusing', async () => {
    let finish;
    const onTake = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const transcribing = vi.fn();
    render(<ReflectionResponse prompt={prompt} focusOnOpen={false} focusAfterTake={false}
      transcribingLabel="Writing down what you said…" afterTakeHint="Check your words, then tap Submit."
      events={{ transcribing }} onTake={onTake} onSubmit={vi.fn()} />);
    let upload;
    act(() => { upload = receive({ blob: new Blob(['voice']) }); });
    expect(screen.getByText('Writing down what you said…')).toBeVisible();
    expect(transcribing).toHaveBeenCalledWith({ promptId: 'gratitude' });
    await act(async () => { finish({ audioRef: 'child/a.webm', text: 'I am grateful for eating cookies.' }); await upload; });
    expect(screen.queryByText('Writing down what you said…')).toBeNull();
    expect(screen.getByText('Check your words, then tap Submit.')).toBeVisible();
    expect(screen.getByRole('textbox')).toHaveValue('I am grateful for eating cookies.');
    expect(document.activeElement).not.toBe(screen.getByRole('textbox'));
  });

  it('shows the label while the recorder is still saving its take', () => {
    recorder.phase = 'saving';
    render(<ReflectionResponse prompt={prompt} transcribingLabel="Writing down what you said…" onTake={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Writing down what you said…')).toBeVisible();
  });

  it('keeps today\'s behavior when no label or hint is given', async () => {
    render(<ReflectionResponse prompt={prompt} onTake={async () => ({ audioRef: 'a', text: 'My toys' })} onSubmit={vi.fn()} />);
    await act(async () => { await receive({ blob: new Blob(['v']) }); });
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('with no focus on open, physical Enter still submits and Space still records an empty answer', () => {
    const submit = vi.fn();
    const { unmount } = render(<ReflectionResponse prompt={prompt} focusOnOpen={false} onTake={vi.fn()} onSubmit={submit} />);
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    expect(recorder.start).toHaveBeenCalledTimes(1);
    unmount();
    render(<ReflectionResponse prompt={prompt} focusOnOpen={false} initial="My toys" onTake={vi.fn()} onSubmit={submit} />);
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ text: 'My toys' }));
  });

  it('a saved recording with no text keeps the type-it-instead notice and no next-step line', async () => {
    render(<ReflectionResponse prompt={prompt} afterTakeHint="Check your words, then tap Submit." onTake={async () => ({ audioRef: 'learner/take.webm', text: '' })} onSubmit={vi.fn()} />);
    await act(async () => { await receive({ blob: new Blob(['audio']) }); });
    expect(screen.getByRole('status')).toHaveTextContent(/Your recording is saved\. Please type/);
    expect(screen.queryByText(/Check your words/)).toBeNull();
  });
  it('with no focus on open, a printable key from outside the box focuses it and lands in it', () => {
    const submit = vi.fn();
    render(<ReflectionResponse prompt={prompt} focusOnOpen={false} onTake={vi.fn()} onSubmit={submit} />);
    const box = screen.getByRole('textbox');
    expect(document.activeElement).toBe(document.body);
    expect(fireEvent.keyDown(document.body, { key: 'M', code: 'KeyM' })).toBe(false);
    expect(box).toHaveFocus();
    expect(box).toHaveValue('M');
    expect(box.selectionStart).toBe(1);
    fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' });
    expect(submit).toHaveBeenCalledWith({ text: 'M', via: 'typed', audioRef: null, edited: false });
  });
  it('with no focus on open, Space on an empty box records instead of typing', () => {
    render(<ReflectionResponse prompt={prompt} focusOnOpen={false} onTake={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
  it('type-to-focus leaves modified keys and the default focus behavior alone', () => {
    render(<ReflectionResponse prompt={prompt} focusOnOpen={false} onTake={vi.fn()} onSubmit={vi.fn()} />);
    fireEvent.keyDown(document.body, { key: 'c', code: 'KeyC', ctrlKey: true });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('textbox')).not.toHaveFocus();
  });
  it('the next-step hint stays mounted while the words change and goes once the box is emptied', async () => {
    render(<ReflectionResponse prompt={prompt} afterTakeHint="Check your words, then tap Submit." focusAfterTake={false} onTake={async () => ({ audioRef: 'a', text: 'My toys' })} onSubmit={vi.fn()} />);
    await act(async () => { await receive({ blob: new Blob(['v']) }); });
    const hint = screen.getByText('Check your words, then tap Submit.');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My toy' } });
    expect(screen.getByText('Check your words, then tap Submit.')).toBe(hint);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(screen.queryByText(/Check your words/)).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My toys' } });
    expect(screen.queryByText(/Check your words/)).toBeNull();
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
it('adds aria-describedby only when a description id is given',()=>{
  const {unmount}=render(<ReflectionResponse prompt={{id:'p',text:'Q?'}} onSubmit={()=>{}} onTake={async()=>({})}/>);
  expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-describedby');unmount();
  render(<ReflectionResponse prompt={{id:'p',text:'Q?'}} describedBy="said" onSubmit={()=>{}} onTake={async()=>({})}/>);
  expect(screen.getByRole('textbox')).toHaveAttribute('aria-describedby','said');
});
describe('take replacement (Gratitude)',()=>{
  it('with replaceOnTake a new take replaces the words in the box',async()=>{
    const takes=[{audioRef:'kid/a.webm',text:'Blah blah'},{audioRef:'kid/b.webm',text:'Making cookies'}];
    render(<ReflectionResponse prompt={prompt} replaceOnTake onTake={async()=>takes.shift()} onSubmit={vi.fn()}/>);
    await act(async()=>{await receive({blob:new Blob(['a'])});});
    await act(async()=>{await receive({blob:new Blob(['b'])});});
    expect(screen.getByRole('textbox')).toHaveValue('Making cookies');
  });
  it('without it a take still appends (Debrief)',async()=>{
    render(<ReflectionResponse prompt={prompt} initial="My dog" onTake={async()=>({audioRef:'kid/a.webm',text:'and cat'})} onSubmit={vi.fn()}/>);
    await act(async()=>{await receive({blob:new Blob(['a'])});});
    expect(screen.getByRole('textbox')).toHaveValue('My dog and cat');
  });
  it('an unheard take says so and leaves the box alone',async()=>{
    const submit=vi.fn();
    render(<ReflectionResponse prompt={prompt} replaceOnTake initial="My dog" onTake={async()=>({audioRef:'kid/a.webm',text:null,unheard:true})} onSubmit={submit}/>);
    await act(async()=>{await receive({blob:new Blob(['a'])});});
    expect(screen.getByRole('textbox')).toHaveValue('My dog');
    expect(screen.getByText("I didn't hear you. Try again.")).toBeVisible();
    fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'});
    expect(submit).toHaveBeenCalledWith({text:'My dog',via:'typed',audioRef:null,edited:false});
  });
});
