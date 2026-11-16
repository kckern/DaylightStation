import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageReelsProgram from './LanguageReelsProgram.jsx';
import { languageReelsApi } from './languageReelsApi.js';
vi.mock('./languageReelsApi.js', () => ({ languageReelsApi: { open: vi.fn(), attempt: vi.fn(), stage: vi.fn() } }));
const stages = { flashcards: true, listen: true, cloze: false, watch: false, comprehension: false, speaking: true };
const activity = () => ({ session: { stages: { ...stages }, attempts: [] }, mediaUrl: '/reel.mp4', reel: { title: 'Conversation', transcript: [], authoring: { cloze: [{ id: 'fill', prompt: 'Say ___', answer: 'hello', decoys: ['bye', 'yes', 'no'] }] } } });
const acknowledged = (answer = 'hello') => ({ ok: true, status: 200, data: { stages: { ...stages }, attempts: [{ type: 'cloze', itemId: 'fill', answer, correct: answer === 'hello' }] } });
const mount = () => render(<LanguageReelsProgram userId="learner" reelId="123" reelGrant="grant" onExit={vi.fn()} />);
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); languageReelsApi.open.mockResolvedValue({ ok: true, status: 200, data: activity() }); languageReelsApi.stage.mockResolvedValue({ ok: true, status: 200, data: { stages: { ...stages, cloze: true } } }); });
describe('Language Reels durable progression', () => {
  it('keeps the answer pending until the attempt is durably acknowledged', async () => {
    let resolve; languageReelsApi.attempt.mockReturnValue(new Promise((r) => { resolve = r; })); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'hello' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 500)); });
    expect(languageReelsApi.stage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'hello' }).disabled).toBe(true);
    await act(async () => { resolve(acknowledged()); });
    await waitFor(() => expect(languageReelsApi.stage).toHaveBeenCalledWith('learner', '123', 'cloze', 'grant'));
  });
  it('retains an unrecorded answer and retries it without advancing', async () => {
    languageReelsApi.attempt.mockResolvedValueOnce({ ok: false, status: 0, data: null }).mockResolvedValueOnce(acknowledged()); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'hello' }));
    expect(await screen.findByText(/answer.*not.*sav|answer.*did not save/i)).toBeTruthy();
    expect(languageReelsApi.stage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /exit reel/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry answer/i }));
    await waitFor(() => expect(languageReelsApi.stage).toHaveBeenCalled());
    expect(languageReelsApi.attempt.mock.calls.map((c) => c[3])).toEqual([{ type: 'cloze', itemId: 'fill', answer: 'hello' }, { type: 'cloze', itemId: 'fill', answer: 'hello' }]);
  });
  it('offers an exit when a grant is no longer valid', async () => {
    languageReelsApi.open.mockResolvedValue({ ok: false, status: 403, data: null }); mount();
    expect(await screen.findByRole('button', { name: /exit reel/i })).toBeTruthy();
  });
});

it('does not treat a malformed success response as a recorded answer', async () => {
  languageReelsApi.attempt.mockResolvedValue({ ok: true, status: 200, data: null }); mount();
  fireEvent.click(await screen.findByRole('button', { name: 'hello' }));
  expect(await screen.findByRole('button', { name: 'Retry answer' })).toBeTruthy();
  expect(languageReelsApi.stage).not.toHaveBeenCalled();
});
it('uses the server grade and leaves an incorrect answer on the current item', async () => {
  const response = acknowledged(); response.data.attempts[0].correct = false;
  languageReelsApi.attempt.mockResolvedValue(response); mount();
  fireEvent.click(await screen.findByRole('button', { name: 'hello' }));
  expect(await screen.findByText(/Not quite/)).toBeTruthy();
  expect(languageReelsApi.stage).not.toHaveBeenCalled();
});
it('retries a failed stage save without discarding or submitting the accepted answer again', async () => {
  languageReelsApi.attempt.mockResolvedValue(acknowledged());
  languageReelsApi.stage.mockResolvedValueOnce({ ok: false, status: 503, data: null }).mockResolvedValueOnce({ ok: true, status: 200, data: { stages: { ...stages, cloze: true } } }); mount();
  fireEvent.click(await screen.findByRole('button', { name: 'hello' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry step' }));
  expect(await screen.findByText('Now watch the full scene.')).toBeTruthy();
  expect(languageReelsApi.attempt).toHaveBeenCalledTimes(1);
});
it('releases pending state when the launched learner changes', async () => {
  languageReelsApi.attempt.mockResolvedValue(acknowledged());
  let finishOldStage;
  languageReelsApi.stage.mockReturnValue(new Promise((resolve) => { finishOldStage = resolve; }));
  const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'hello' }));
  await waitFor(() => expect(languageReelsApi.stage).toHaveBeenCalled());
  view.rerender(<LanguageReelsProgram userId="other" reelId="123" reelGrant="other-grant" onExit={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'hello' }).disabled).toBe(false));
  await act(async () => { finishOldStage({ ok: true, status: 200, data: { stages: { ...stages, cloze: true } } }); });
  expect(screen.queryByText('Now watch the full scene.')).toBeNull();
});


it('releases microphone permission that arrives after the speaking stage exits', async () => {
  const spoken = activity(); spoken.session.stages = { ...stages, cloze: true, watch: true, comprehension: true, speaking: false };
  spoken.reel.transcript = [{ id: 'line', startMs: 0, endMs: 1000, text: 'Hello' }];
  spoken.reel.authoring.speaking = { enabled: true, segments: [{ lineId: 'line' }] };
  languageReelsApi.open.mockResolvedValue({ ok: true, status: 200, data: spoken });
  let grantMic; const stop = vi.fn();
  const oldMedia = navigator.mediaDevices; const oldRecorder = globalThis.MediaRecorder;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => new Promise(resolve => { grantMic = resolve; })) } });
  globalThis.MediaRecorder = class { start() {} };
  try {
    const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Record my line' })); view.unmount();
    await act(async () => { grantMic({ getTracks: () => [{ stop }] }); });
    expect(stop).toHaveBeenCalledTimes(1);
  } finally {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: oldMedia }); globalThis.MediaRecorder = oldRecorder;
  }
});
