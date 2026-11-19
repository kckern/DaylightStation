import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));

let triage;
vi.mock("../../../hooks/useTriage.js", () => ({ useTriage: () => triage, default: () => triage }));
vi.mock("../../../../../../../frontend/src/modules/Auth/LoginScreen.jsx", () => ({
  default: ({ onLogin }) => <button type="button" data-testid="login-screen" onClick={onLogin}>Sign In</button>,
}));
const recorder = { isRecording: false, durationMs: 0, levelRef: { current: 0 }, error: null, start: vi.fn(), stop: vi.fn() };
vi.mock("../../../../../../../frontend/src/modules/VoiceCapture/useMediaRecorderCapture.js", () => ({
  useMediaRecorderCapture: () => recorder, default: () => recorder,
}));
const api = vi.fn();
vi.mock("../../../../../../../frontend/src/lib/api.mjs", () => ({ DaylightAPI: (...a) => api(...a) }));

import { TriageSessionView } from "./TriageSessionView.jsx";

const unsure = (id, title) => ({
  cardId: id, kind: 'email', step: 'unsure', status: 'open', suggested: 'reply', why: 'It asks a question.',
  display: { title, from: { name: 'Dana', address: 'dana@example.com' }, snippet: 'Can you take a slot?', at: null, source: 'Mailbox A', url: null },
  choices: [{ key: 'archive', label: 'Archive' }, { key: 'reply', label: 'Reply (draft)' }, { key: 'task', label: 'Make a todo' }, { key: 'keep', label: 'Keep in inbox' }],
});
const reply = {
  cardId: 'r1', kind: 'email', step: 'reply', status: 'open', suggested: 'send', why: 'He asked two questions.',
  draftBody: 'Hi Mark, the 30th works.',
  display: { title: 'Re: Deck quote', from: { name: 'Mark', address: 'm@example.com' }, snippet: 'Can he start the 30th?', at: null, source: 'Mailbox A', url: null },
  choices: [{ key: 'send', label: 'Send' }, { key: 'archive', label: 'Archive' }, { key: 'task', label: 'Make a todo' }, { key: 'keep', label: 'Keep in inbox' }],
};

function makeTriage(over = {}) {
  return {
    summary: { enrolled: true, mode: 'live' },
    session: { steps: [{ id: 'unsure', count: 2 }], cards: [unsure('c1', 'Volunteer slots'), unsure('c2', 'Bake sale')], total: 2, done: 0 },
    loading: false, error: null, needsLogin: false,
    refetch: vi.fn(), answer: vi.fn(), skip: vi.fn(), resolve: vi.fn(), undo: vi.fn(), run: vi.fn(),
    ...over,
  };
}
const wrap = () => render(<MantineProvider><MemoryRouter><TriageSessionView /></MemoryRouter></MantineProvider>);

beforeEach(() => { navigate.mockReset(); api.mockReset(); triage = makeTriage(); });

describe('TriageSessionView', () => {
  it('renders the first card with the progress "1 / N"', () => {
    wrap();
    expect(screen.getByText('Volunteer slots')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.queryByText('Bake sale')).not.toBeInTheDocument();
  });

  it('marks the suggested choice', () => {
    wrap();
    const suggested = screen.getByRole('button', { name: /Reply \(draft\)/ });
    expect(suggested).toHaveTextContent('suggested');
    expect(screen.getByRole('button', { name: /Archive/ })).not.toHaveTextContent('suggested');
  });

  it('clicking a choice calls answer(cardId, { choice }) and advances', async () => {
    triage.answer.mockResolvedValue({ outcome: 'applied', card: null });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Archive/ }));
    await waitFor(() => expect(screen.getByText('Bake sale')).toBeInTheDocument());
    expect(triage.answer).toHaveBeenCalledWith('c1', { choice: 'archive' });
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('a conflict shows the skipped line and advances', async () => {
    triage.answer.mockResolvedValue({ outcome: 'conflict', card: null });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Keep in inbox/ }));
    await waitFor(() => expect(screen.getByText('Bake sale')).toBeInTheDocument());
    expect(screen.getByText(/This changed since — skipped/)).toBeInTheDocument();
  });

  it('needsLogin shows the login screen in place of the card, and answer is not called', () => {
    triage = makeTriage({ needsLogin: true, session: null });
    wrap();
    expect(screen.getByTestId('login-screen')).toBeInTheDocument();
    expect(screen.queryByText('Volunteer slots')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('login-screen'));
    expect(triage.refetch).toHaveBeenCalled();
    expect(triage.answer).not.toHaveBeenCalled();
  });

  it("the reply card's Send calls answer with the edited draft body", async () => {
    triage = makeTriage({ session: { steps: [{ id: 'reply', count: 1 }], cards: [reply], total: 1, done: 0 } });
    triage.answer.mockResolvedValue({ outcome: 'applied', card: null });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = screen.getByLabelText('Reply draft');
    fireEvent.change(box, { target: { value: 'Hi Mark, the 30th works. Cedar please.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(triage.answer).toHaveBeenCalled());
    expect(triage.answer).toHaveBeenCalledWith('r1', { choice: 'send', draft: { body: 'Hi Mark, the 30th works. Cedar please.' } });
  });

  it('typed text is sent as { text }; an interpreted send asks for a tap on Send', async () => {
    triage = makeTriage({ session: { steps: [{ id: 'reply', count: 1 }], cards: [reply], total: 1, done: 0 } });
    triage.answer.mockResolvedValue({ outcome: 'skipped', interpreted: 'send', card: reply });
    wrap();
    const input = screen.getByLabelText('Answer in your own words');
    fireEvent.change(input, { target: { value: 'send it' } });
    fireEvent.submit(input.closest('form'));
    await waitFor(() => expect(screen.getByText('Tap Send to send it.')).toBeInTheDocument());
    expect(triage.answer).toHaveBeenCalledWith('r1', { text: 'send it' });
    expect(screen.getByText('Re: Deck quote')).toBeInTheDocument();
  });

  it('a busy 409 keeps the typed text and offers a retry', async () => {
    triage.answer.mockRejectedValueOnce(Object.assign(new Error('pass_running'), { code: 'pass_running', status: 409 }));
    wrap();
    const input = screen.getByLabelText('Answer in your own words');
    fireEvent.change(input, { target: { value: 'archive it' } });
    fireEvent.submit(input.closest('form'));
    await waitFor(() => expect(screen.getByText('Triage is updating — try again in a moment.')).toBeInTheDocument());
    expect(screen.getByLabelText('Answer in your own words')).toHaveValue('archive it');
    triage.answer.mockResolvedValueOnce({ outcome: 'applied', card: null });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByText('Bake sale')).toBeInTheDocument());
    expect(triage.answer).toHaveBeenLastCalledWith('c1', { text: 'archive it' });
  });

  it('needsText on a shrink focuses the box with a prompt, and the next text is sent with the choice', async () => {
    const todo = {
      cardId: 't1', kind: 'todo', step: 'todo', status: 'open', suggested: 'drop', why: 'Pushed back 3 times.',
      display: { title: 'Research water softeners', snippet: '', source: 'Home projects', at: null, url: null },
      choices: [{ key: 'do_week', label: 'Do it this week' }, { key: 'drop', label: 'Drop it' }, { key: 'shrink', label: 'Turn into a smaller next step…' }],
    };
    triage = makeTriage({ session: { steps: [{ id: 'todo', count: 1 }], cards: [todo], total: 1, done: 0 } });
    triage.answer.mockResolvedValueOnce({ outcome: 'skipped', needsText: true, card: todo });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /smaller next step/ }));
    await waitFor(() => expect(screen.getByText("What's the smaller next step?")).toBeInTheDocument());
    const input = screen.getByLabelText('Answer in your own words');
    await waitFor(() => expect(input).toHaveFocus());
    triage.answer.mockResolvedValueOnce({ outcome: 'applied', card: null });
    fireEvent.change(input, { target: { value: 'Read one review' } });
    fireEvent.submit(input.closest('form'));
    await waitFor(() => expect(triage.answer).toHaveBeenLastCalledWith('t1', { choice: 'shrink', text: 'Read one review' }));
  });

  it('an applying card asks "Did this go through?" and resolves', async () => {
    triage = makeTriage({ session: { steps: [{ id: 'reply', count: 1 }], cards: [{ ...reply, status: 'applying', applying: true }], total: 1, done: 0 } });
    triage.resolve.mockResolvedValue({ outcome: 'applied' });
    wrap();
    expect(screen.getByText('Did this go through?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
    await waitFor(() => expect(triage.resolve).toHaveBeenCalledWith('r1', true));
    await waitFor(() => expect(screen.getByText(/All done/)).toBeInTheDocument());
  });

  it('the recap card opens the action log, undoes an entry, and notes a dry run', async () => {
    const recap = {
      cardId: 'recap', kind: 'recap', step: 'recap', status: 'open', choices: [{ key: 'ok', label: 'Got it' }], suggested: 'ok',
      why: 'Done for you since your last session', counts: { archived: 1, closed: 0 },
      entries: [{ entryId: 'log.1', at: 1, action: 'archive', kind: 'email', title: 'Receipt #42', uncertain: false, undoneAt: null, undoable: true }],
    };
    triage = makeTriage({ summary: { enrolled: true, mode: 'dryRun' }, session: { steps: [{ id: 'recap', count: 1 }], cards: [recap], total: 1, done: 0 } });
    triage.undo.mockResolvedValue({ outcome: 'undone' });
    wrap();
    expect(screen.getByText(/Dry run — nothing was done automatically; your taps are real\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Review what was done/ }));
    expect(screen.getByText('Receipt #42')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Undo/ })); });
    expect(triage.undo).toHaveBeenCalledWith('log.1');
    await waitFor(() => expect(screen.getByText('Undone')).toBeInTheDocument());
  });

  it('Stop for now returns to Now', () => {
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Stop for now/ }));
    expect(navigate).toHaveBeenCalledWith('/life/now');
  });

  it('voice: the transcript lands in the answer box without submitting', async () => {
    recorder.isRecording = true;
    recorder.stop.mockResolvedValue({ blob: new Blob(['x'], { type: 'audio/webm' }), durationMs: 900, mimeType: 'audio/webm' });
    api.mockResolvedValue({ text: 'make a todo' });
    wrap();
    fireEvent.click(screen.getByRole('button', { name: /Stop recording/ }));
    await waitFor(() => expect(screen.getByLabelText('Answer in your own words')).toHaveValue('make a todo'));
    expect(api).toHaveBeenCalledWith('api/v1/ai/transcribe', { audioBase64: expect.any(String) }, 'POST');
    expect(triage.answer).not.toHaveBeenCalled();
    recorder.isRecording = false;
  });
});
