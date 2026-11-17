import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GratitudeProgram from './GratitudeProgram.jsx';

const api = vi.hoisted(() => ({ open: vi.fn(), submit: vi.fn(), retry: vi.fn(), take: vi.fn(), draft: vi.fn(), day: vi.fn() }));
let latest;
vi.mock('../shared/ReflectionResponse.jsx', () => ({
  default: props => { latest = props; return <button type="button" onClick={() => props.onSubmit({ text: 'My dog', via: 'typed', audioRef: null, edited: false })}>Submit</button>; },
}));
vi.mock('./gratitudeApi.js', () => ({ createGratitudeApi: () => api }));
vi.mock('./gratitudeLog.js', () => ({ gratitudeLog: new Proxy({}, { get: () => () => {} }) }));

const initial = { learnerId: 'child', studyDay: '2026-11-16', today: '2026-11-16', serverNow: '2026-11-16T18:00:00Z', phase: 'draft', draft: null, prompt: { id: 'gratitude', text: 'What are you grateful for today?', required: true }, retryAt: null, attemptId: null };

it('saves a draft while answering', async () => {
  api.open.mockResolvedValue({ ok: true, data: initial }); api.draft.mockReset();
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={() => {}} />);
  await screen.findByRole('button', { name: 'Submit' });
  await act(async () => { await latest.onDraft({ text: 'My d', via: 'typed', audioRef: null, edited: false }); });
  expect(api.draft).toHaveBeenCalledTimes(1);
});

it('saves no draft from a blur that arrives after the answer is complete', async () => {
  api.open.mockResolvedValue({ ok: true, data: initial }); api.draft.mockReset();
  api.submit.mockResolvedValue({ ok: true, data: { ...initial, phase: 'completed', subject: 'My dog' } });
  render(<GratitudeProgram learnerId="child" gratitudeGrant="grant" today="2026-11-16" onExit={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
  const lastAnswerRender = latest;
  await screen.findByText('My dog');
  await act(async () => { await lastAnswerRender.onDraft({ text: 'My dog', via: 'typed', audioRef: null, edited: false }); });
  expect(api.draft).not.toHaveBeenCalled();
});
