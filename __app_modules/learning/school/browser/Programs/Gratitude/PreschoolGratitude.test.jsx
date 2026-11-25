import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import GratitudeProgram from './GratitudeProgram.jsx';
import { preschoolScreen } from './PreschoolGratitude.jsx';
import { steerLine, unusedHints } from './preschoolHints.js';

const api = vi.hoisted(() => ({ open: vi.fn(), submit: vi.fn(), retry: vi.fn(), take: vi.fn(), draft: vi.fn(), day: vi.fn() }));
const recorder = vi.hoisted(() => ({ phase: 'idle', unavailable: false, stream: null, verdict: null, start: vi.fn(), stop: vi.fn(), onLevel: vi.fn() }));
let receiveTake;
vi.mock('../shared/useTakeRecorder.js', () => ({ default: ({ onTake }) => { receiveTake = onTake; return recorder; } }));
vi.mock('../SentenceLadder/rungs/VoiceBand.jsx', () => ({ default: () => null }));
vi.mock('./gratitudeApi.js', () => ({ createGratitudeApi: () => api }));
const log = vi.hoisted(() => ({}));
vi.mock('./gratitudeLog.js', () => ({ gratitudeLog: new Proxy(log, { get: (target, name) => (target[name] ??= vi.fn()) }) }));
const spoken = [];
beforeEach(() => {
  spoken.length = 0;
  Object.values(api).forEach(fn => fn.mockReset());
  Object.values(log).forEach(fn => fn.mockClear());
  recorder.phase = 'idle'; recorder.verdict = null; recorder.unavailable = false; recorder.start.mockClear();
  window.speechSynthesis = { cancel: vi.fn(() => spoken.push('<cancel>')), speak: u => spoken.push(u.text) };
  recorder.start.mockImplementation(() => { spoken.push('<record>'); });
  globalThis.SpeechSynthesisUtterance = function Utterance(text) { this.text = text; };
});

const base = { learnerId: 'kid', studyDay: '2026-11-19', today: '2026-11-19', serverNow: '2026-11-19T18:00:00Z', mode: 'preschool', phase: 'draft', draft: null, prompt: { id: 'gratitude', text: 'What are you grateful for today?', required: true }, retryAt: null, attemptId: null, steer: null, flagged: false, cooldownMs: null };
const mount = () => render(<GratitudeProgram learnerId="kid" learnerName="Kid" gratitudeGrant="grant" today="2026-11-19" onExit={() => {}} />);
const screenOf = () => document.querySelector('.preschool-gratitude')?.dataset.screen;

it('asks with pictures and one mic, no text box, and says the question aloud', async () => {
  api.open.mockResolvedValue({ ok: true, data: base });
  mount();
  expect(await screen.findByText('What made you happy today?')).toBeVisible();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByRole('button', { name: 'Tell me' })).toBeVisible();
  for (const name of ['Family', 'Food', 'Toys', 'Outside']) expect(screen.getByRole('button', { name })).toBeVisible();
  await waitFor(() => expect(spoken).toContain('What made you happy today?'));
  fireEvent.click(screen.getByRole('button', { name: 'Family' }));
  expect(spoken.at(-1)).toBe('What about Mom?');
  expect(screen.getByRole('banner')).toHaveTextContent('Kid');
  expect(log.screen).toHaveBeenCalledWith({ screen: 'ask' });
});

it('asks "Did you say…?", submits on Yes, and a new take replaces a discarded one', async () => {
  api.open.mockResolvedValue({ ok: true, data: base });
  api.take.mockResolvedValueOnce({ ok: true, data: { takeId: 't1', audioRef: 'kid/t1.webm', text: 'Blah blah' } })
    .mockResolvedValueOnce({ ok: true, data: { takeId: 't2', audioRef: 'kid/t2.webm', text: 'Making cookies' } });
  api.submit.mockResolvedValue({ ok: true, data: { ...base, phase: 'completed', subject: 'Making cookies', attemptId: 'a1' } });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Tell me' }));
  expect(recorder.start).toHaveBeenCalledTimes(1);
  await act(async () => { await receiveTake({ blob: new Blob(['a']) }); });
  expect(screen.getByText('“Blah blah”')).toBeVisible();
  expect(spoken.at(-1)).toBe('Did you say: Blah blah?');
  fireEvent.click(screen.getByRole('button', { name: /Say it again/ }));
  expect(recorder.start).toHaveBeenCalledTimes(2);
  expect(api.submit).not.toHaveBeenCalled();
  await act(async () => { await receiveTake({ blob: new Blob(['b']) }); });
  expect(screen.queryByText('“Blah blah”')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
  await waitFor(() => expect(screenOf()).toBe('green'));
  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(api.submit.mock.calls[0][1]).toMatchObject({ text: 'Making cookies', via: 'voice', audioRef: 'kid/t2.webm' });
  expect(screen.getByText('Making cookies')).toBeVisible();
  expect(spoken.at(-1)).toBe("Thank you! I'll remember: making cookies.");
});

it('says it did not hear and stays on the ask screen for an unheard take', async () => {
  api.open.mockResolvedValue({ ok: true, data: base });
  api.take.mockResolvedValue({ ok: true, data: { takeId: 't1', audioRef: 'kid/t1.webm', text: null, unheard: true } });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Tell me' }));
  await act(async () => { await receiveTake({ blob: new Blob(['a']) }); });
  expect(screenOf()).toBe('ask');
  expect(screen.getByText("I didn't hear you. Try again.")).toBeVisible();
  expect(spoken.at(-1)).toBe("I didn't hear you. Try again.");
});

it('locks everything while checking', async () => {
  api.open.mockResolvedValue({ ok: true, data: base });
  api.take.mockResolvedValue({ ok: true, data: { takeId: 't1', audioRef: 'kid/t1.webm', text: 'cookies' } });
  let finish; api.submit.mockReturnValue(new Promise(r => { finish = r; }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Tell me' }));
  await act(async () => { await receiveTake({ blob: new Blob(['a']) }); });
  fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
  await waitFor(() => expect(screenOf()).toBe('checking'));
  expect(screen.queryByRole('button', { name: /Yes|Tell me/ })).toBeNull();
  expect(log.screen).toHaveBeenCalledWith({ screen: 'checking' });
  await act(async () => { finish({ ok: true, data: { ...base, phase: 'warned', attemptId: 'a1', reason: 'nonsense' } }); });
  expect(screenOf()).toBe('yellow');
  expect(screen.getByText('That was silly')).toBeVisible();
  expect(spoken.at(-1)).toBe('That sounded silly. Tell me one real thing you liked today.');
});

it('steers in blue with the used subject greyed and hints that skip it', async () => {
  api.open.mockResolvedValue({ ok: true, data: { ...base, phase: 'steered', attemptId: 'a1', reason: 'repetition', steer: { reason: 'repetition', used: { subject: 'Eating cookies', studyDay: '2026-11-17' }, recent: ['Eating cookies'] } } });
  mount();
  expect(await screen.findByText('Try something new')).toBeVisible();
  expect(screen.getByText('Eating cookies')).toBeVisible();
  expect(screen.getByText('already used')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Food' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Family' })).toBeVisible();
  expect(spoken.at(-1)).toBe("You said eating cookies on Tuesday. What's something different? What about Mom?");
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});

it('shows the break ring with the time left on re-entry', async () => {
  api.open.mockResolvedValue({ ok: true, data: { ...base, phase: 'cooldown', reason: 'rude', retryAt: '2026-11-19T18:02:00Z', cooldownMs: 300000 } });
  mount();
  expect(await screen.findByText("Let's take a break")).toBeVisible();
  const ring = screen.getByRole('img', { name: /left/ });
  expect(ring).toHaveAccessibleName(/^\d minutes? left$/);
  const left = Number(ring.querySelector('.preschool-gratitude__ring-left').dataset.left);
  expect(left).toBeGreaterThan(0); expect(left).toBeLessThanOrEqual(0.41);
  expect(screen.queryByRole('button', { name: /Tell me|Try again/ })).toBeNull();
  expect(spoken.at(-1)).toBe("Let's take a break and try again soon.");
});

it('shows green again on re-entry after a completed day', async () => {
  api.open.mockResolvedValue({ ok: true, data: { ...base, phase: 'completed', subject: 'Mom', flagged: true, attemptId: 'a1' } });
  mount();
  await waitFor(() => expect(screenOf()).toBe('green'));
  expect(screen.getByText('Thank you!')).toBeVisible();
});

it('keeps the text-box screen for other learners', async () => {
  api.open.mockResolvedValue({ ok: true, data: { ...base, mode: 'standard' } });
  mount();
  expect(await screen.findByRole('textbox')).toBeVisible();
  expect(document.querySelector('.preschool-gratitude')).toBeNull();
});

it('maps each phase to one screen', () => {
  expect(preschoolScreen({ phase: 'draft' })).toBe('ask');
  expect(preschoolScreen({ phase: 'retry' })).toBe('ask');
  expect(preschoolScreen({ phase: 'steered' })).toBe('blue');
  expect(preschoolScreen({ phase: 'warned' })).toBe('yellow');
  expect(preschoolScreen({ phase: 'cooldown' })).toBe('red');
  expect(preschoolScreen({ phase: 'completed' })).toBe('green');
  expect(preschoolScreen({ phase: 'pending' })).toBe('checking');
  expect(preschoolScreen({ phase: 'draft', busy: true })).toBe('checking');
  expect(preschoolScreen({ phase: 'steered', listening: true })).toBe('listening');
  expect(preschoolScreen({ phase: 'steered', heard: { text: 'x' } })).toBe('confirm');
});

it('steers a bare category without a used subject', () => {
  expect(steerLine({ reason: 'general', used: null, recent: [] })).toBe('Tell me something new. What about Mom?');
  expect(unusedHints(['My mom', 'Playing in the park']).map(h => h.id)).toEqual(['food', 'toys']);
});

it('waits out the break on screen instead of closing for being idle', async () => {
  api.open.mockResolvedValue({ ok: true, data: { ...base, phase: 'cooldown', reason: 'nonsense', retryAt: '2099-01-01T00:00:00Z', cooldownMs: 300000 } });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const exit = vi.fn();
    render(<GratitudeProgram learnerId="kid" learnerName="Kid" gratitudeGrant="grant" today="2026-11-19" onExit={exit} />);
    await waitFor(() => expect(screenOf()).toBe('red'));
    await act(async () => { vi.advanceTimersByTime(6 * 60_000); });
    expect(exit).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('stops talking before it listens, so it never records its own voice', async () => {
  api.open.mockResolvedValue({ ok: true, data: base });
  const view = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Family' }));
  expect(spoken.slice(-2)).toEqual(['<cancel>', 'What about Mom?']);
  fireEvent.click(screen.getByRole('button', { name: 'Tell me' }));
  expect(spoken.slice(-2)).toEqual(['<cancel>', '<record>']);
  window.speechSynthesis.cancel.mockClear();
  view.unmount();
  expect(window.speechSynthesis.cancel).toHaveBeenCalled();
});

const answer = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Tell me' }));
  await act(async () => { await receiveTake({ blob: new Blob(['a']) }); });
  fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
};

it('shows a clear error screen instead of dropping back to Ask, and tapping tries again', async () => {
  api.open.mockResolvedValue({ ok: true, data: base });
  api.take.mockResolvedValue({ ok: true, data: { takeId: 't1', audioRef: 'kid/t1.webm', text: 'cookies' } });
  api.submit.mockResolvedValue({ ok: false, status: 500, data: { error: 'Your answer could not be processed. Please try again.' } });
  mount();
  await answer();
  await waitFor(() => expect(screenOf()).toBe('error'));
  expect(screen.getByText('Something went wrong')).toBeVisible();
  expect(log.screen).toHaveBeenCalledWith({ screen: 'error' });
  fireEvent.click(screen.getByRole('button', { name: /Tap to try again/ }));
  await waitFor(() => expect(screenOf()).toBe('ask'));
  expect(api.open).toHaveBeenCalledTimes(2);
});

it('ignores the keyboard and locks Close while checking', async () => {
  api.open.mockResolvedValue({ ok: true, data: base });
  api.take.mockResolvedValue({ ok: true, data: { takeId: 't1', audioRef: 'kid/t1.webm', text: 'cookies' } });
  let finish; api.submit.mockReturnValue(new Promise(r => { finish = r; }));
  const exit = vi.fn();
  render(<GratitudeProgram learnerId="kid" learnerName="Kid" gratitudeGrant="grant" today="2026-11-19" onExit={exit} />);
  await answer();
  await waitFor(() => expect(screenOf()).toBe('checking'));
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  await act(async () => { finish({ ok: true, data: { ...base, phase: 'completed', subject: 'Cookies', attemptId: 'a1' } }); });
  fireEvent.keyDown(window, { key: 'Enter' });
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  expect(exit).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
});

it('asks a follow-up left open before the switch to preschool, and answers it as one', async () => {
  api.open.mockResolvedValue({ ok: true, data: { ...base, phase: 'follow-up', attemptId: 'f1', followUp: { question: 'What about your mom are you grateful for today?', firstText: 'my mom' } } });
  api.take.mockResolvedValue({ ok: true, data: { takeId: 't1', audioRef: 'kid/t1.webm', text: 'She made pancakes' } });
  api.submit.mockResolvedValue({ ok: true, data: { ...base, phase: 'completed', subject: 'Mom making pancakes', attemptId: 'a2' } });
  mount();
  expect(await screen.findByText('What about your mom are you grateful for today?')).toBeVisible();
  expect(screenOf()).toBe('blue');
  expect(spoken).toContain('What about your mom are you grateful for today?');
  await answer();
  await waitFor(() => expect(api.submit).toHaveBeenCalled());
  expect(api.submit.mock.calls[0][1]).toMatchObject({ text: 'She made pancakes', followUpOf: 'f1' });
});

it('says the mic is not working on the blue and yellow screens too', async () => {
  recorder.unavailable = true;
  api.open.mockResolvedValue({ ok: true, data: { ...base, phase: 'warned', attemptId: 'a1' } });
  mount();
  expect(await screen.findByText('The microphone is not working. Ask a grown-up.')).toBeVisible();
});

it('the text-box screen treats a steered or warned day as a retry', async () => {
  for (const phase of ['steered', 'warned']) {
    api.open.mockResolvedValue({ ok: true, data: { ...base, mode: 'standard', phase, attemptId: 'a1' } });
    const view = mount();
    expect(await screen.findByRole('textbox')).toBeVisible();
    view.unmount();
  }
});

it('shows the server refusal for a rejected take instead of blaming the mic', async () => {
  api.open.mockResolvedValue({ ok: true, data: base });
  api.take.mockResolvedValue({ ok: false, status: 409, data: { error: 'Gratitude is not assigned today.' } });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Tell me' }));
  await act(async () => { await receiveTake({ blob: new Blob(['a']) }); });
  expect(screenOf()).toBe('error');
  expect(screen.getByText('Gratitude is not assigned today.')).toBeVisible();
  expect(spoken).not.toContain("I didn't hear you. Try again.");
});

it('a lost upload (no server answer) asks again rather than showing the error screen', async () => {
  api.open.mockResolvedValue({ ok: true, data: base });
  api.take.mockResolvedValue({ ok: false, status: 0, data: null });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Tell me' }));
  await act(async () => { await receiveTake({ blob: new Blob(['a']) }); });
  expect(screenOf()).not.toBe('error');
  expect(screen.getByText("I didn't hear you. Try again.")).toBeVisible();
});
