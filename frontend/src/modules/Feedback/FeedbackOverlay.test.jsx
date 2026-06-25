import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../VoiceCapture/useMediaRecorderCapture.js', () => {
  const state = { isRecording: false };
  return {
    useMediaRecorderCapture: () => ({
      isRecording: state.isRecording,
      durationMs: 1200,
      levelRef: { current: 0 },
      error: null,
      start: vi.fn(async () => { state.isRecording = true; }),
      stop: vi.fn(async () => { state.isRecording = false; return { blob: new Blob(['x']), durationMs: 1200, mimeType: 'audio/webm' }; }),
    }),
  };
});
vi.mock('./feedbackApi.js', () => ({
  submitFeedback: vi.fn(async () => ({ id: 'f1', transcriptStatus: 'pending' })),
  pollFeedbackTranscript: vi.fn(async () => ({ id: 'f1', transcriptStatus: 'done', transcript: 'It stutters.' })),
  deleteFeedback: vi.fn(async () => ({ ok: true })),
}));

import { submitFeedback, pollFeedbackTranscript, deleteFeedback } from './feedbackApi.js';
import FeedbackOverlay from './FeedbackOverlay.jsx';

beforeEach(() => { submitFeedback.mockClear(); pollFeedbackTranscript.mockClear(); deleteFeedback.mockClear(); });

describe('FeedbackOverlay', () => {
  it('records, submits, polls, and shows the transcript; pauses/resumes music', async () => {
    const onPauseMusic = vi.fn(); const onResumeMusic = vi.fn(); const onClose = vi.fn();
    render(<FeedbackOverlay open app="piano" onClose={onClose} onPauseMusic={onPauseMusic} onResumeMusic={onResumeMusic} />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /record/i })); });
    expect(onPauseMusic).toHaveBeenCalledTimes(1);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /stop/i })); });
    await waitFor(() => expect(screen.getByText('It stutters.')).toBeInTheDocument());
    expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ app: 'piano' }));
    expect(pollFeedbackTranscript).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /keep/i }));
    expect(onResumeMusic).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('Redo deletes the saved item and returns to recording', async () => {
    render(<FeedbackOverlay open app="piano" onClose={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /record/i })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /stop/i })); });
    await waitFor(() => expect(screen.getByText('It stutters.')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /redo/i })); });
    expect(deleteFeedback).toHaveBeenCalledWith({ app: 'piano', id: 'f1' });
  });
});
