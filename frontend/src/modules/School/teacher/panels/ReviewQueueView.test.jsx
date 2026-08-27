/**
 * The third verdict, as a parent meets it (teacher-coverage 1.1).
 *
 * The server refuses a `void` with nothing to tell the child, so a panel that
 * let one be sent would turn an honest admission into an error toast. These
 * pin the arm-then-explain shape: the button asks for the sentence first, and
 * cannot fire until there is one.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewQueueView from './ReviewQueueView.jsx';

vi.mock('../../schoolApi.js', () => ({ schoolApi: { resolveReview: vi.fn() } }));
vi.mock('../TeacherProfileContext.jsx', () => ({
  useTeacherProfile: () => ({
    currentTeacher: { id: 'kckern', name: 'KC' },
    pin: null,
    openPicker: vi.fn(),
    openPinPrompt: vi.fn(),
    requestAuthorization: vi.fn(async () => ({ ok: true, grantToken: null })),
    invalidateAuthorization: vi.fn(),
    pinPromptOpen: false,
    pickerOpen: false,
  }),
}));
import { schoolApi } from '../../schoolApi.js';

const KIDS = [{ id: 'kid1', name: 'Milo' }];
const ITEMS = [{
  sessionId: 'ses_1', itemId: 'q3', learnerId: 'kid1', questionNumber: 3,
  prompt: 'Write a sentence about the moon.', reason: 'free_response', enqueuedAt: null,
}];

const paint = () => render(<ReviewQueueView items={ITEMS} kids={KIDS} onResolved={vi.fn()} />);
const noteBox = () => screen.getByLabelText('Note for q3');

beforeEach(() => {
  vi.clearAllMocks();
  schoolApi.resolveReview.mockResolvedValue({ ok: true, status: 200, data: {} });
});

describe('ReviewQueueView — "Can\'t mark this"', () => {
  it('offers the third option in the family\'s words, not the schema\'s', () => {
    paint();
    expect(screen.getByRole('button', { name: /Can’t mark this/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Void$/ })).toBeNull();
  });

  it('asks for the reason before it will send anything', () => {
    paint();
    fireEvent.click(screen.getByRole('button', { name: /Can’t mark this/ }));
    // Armed: the confirm is present but refuses to fire on an empty note.
    const confirm = screen.getByRole('button', { name: /tell them/ });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(schoolApi.resolveReview).not.toHaveBeenCalled();
  });

  it('says whose eyes the note is for once it is armed', () => {
    paint();
    expect(noteBox().placeholder).toMatch(/optional/);
    fireEvent.click(screen.getByRole('button', { name: /Can’t mark this/ }));
    expect(noteBox().placeholder).toMatch(/Milo will read this/);
  });

  it('sends verdict void WITH the note once one is written', async () => {
    paint();
    fireEvent.click(screen.getByRole('button', { name: /Can’t mark this/ }));
    fireEvent.change(noteBox(), { target: { value: 'The scan tore across this one.' } });
    fireEvent.click(screen.getByRole('button', { name: /tell them/ }));
    await waitFor(() => expect(schoolApi.resolveReview).toHaveBeenCalledWith('ses_1', 'q3', expect.objectContaining({
      verdict: 'void', note: 'The scan tore across this one.', gradedBy: 'kckern',
    })));
  });

  it('refuses a note that is only whitespace, the way the server does', () => {
    paint();
    fireEvent.click(screen.getByRole('button', { name: /Can’t mark this/ }));
    fireEvent.change(noteBox(), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /tell them/ }).disabled).toBe(true);
  });

  it('Cancel puts the row back without marking anything', () => {
    paint();
    fireEvent.click(screen.getByRole('button', { name: /Can’t mark this/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Correct' })).toBeTruthy();
    expect(schoolApi.resolveReview).not.toHaveBeenCalled();
  });

  it('leaves Correct and Incorrect note-free, exactly as before', async () => {
    paint();
    fireEvent.click(screen.getByRole('button', { name: 'Correct' }));
    await waitFor(() => expect(schoolApi.resolveReview).toHaveBeenCalledWith('ses_1', 'q3', expect.objectContaining({
      verdict: 'correct', note: null,
    })));
  });
});
