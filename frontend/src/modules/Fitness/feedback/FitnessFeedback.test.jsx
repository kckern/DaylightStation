import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- Mocks ---------------------------------------------------------------
// The recorder hook is the side-effecting boundary (getUserMedia / MediaRecorder).
// Mock it so the overlay's state machine is testable in jsdom without real media.
let mockRecorderState;
const startMock = vi.fn(async () => { mockRecorderState.isRecording = true; });
const stopMock = vi.fn(async () => ({ blob: new Blob(['x'], { type: 'audio/webm' }), durationMs: 4200, mimeType: 'audio/webm' }));

vi.mock('@/modules/VoiceCapture/useMediaRecorderCapture.js', () => ({
  useMediaRecorderCapture: () => mockRecorderState,
  default: () => mockRecorderState,
}));

const submitMock = vi.fn(async () => ({ ok: true }));
vi.mock('@/modules/Feedback/feedbackApi.js', () => ({
  submitFeedback: (...args) => submitMock(...args),
  default: (...args) => submitMock(...args),
}));

import FitnessFeedback from './FitnessFeedback.jsx';

beforeEach(() => {
  vi.clearAllMocks();
  mockRecorderState = {
    isRecording: false,
    durationMs: 0,
    levelRef: { current: 0 },
    error: null,
    start: startMock,
    stop: stopMock,
  };
});

describe('FitnessFeedback overlay', () => {
  it('opens in idle phase with a record control', () => {
    render(<FitnessFeedback onClose={() => {}} />);
    expect(screen.getByTestId('fitness-feedback')).toBeInTheDocument();
    expect(screen.getByTestId('fitness-feedback-record')).toBeInTheDocument();
  });

  it('starts recording when the record button is tapped', async () => {
    render(<FitnessFeedback onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId('fitness-feedback-record'));
    await waitFor(() => expect(startMock).toHaveBeenCalledTimes(1));
  });

  it('captures a take and moves to review when stopped', async () => {
    mockRecorderState.isRecording = true;
    render(<FitnessFeedback onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId('fitness-feedback-record'));
    await waitFor(() => expect(stopMock).toHaveBeenCalledTimes(1));
    await screen.findByTestId('fitness-feedback-save');
    expect(screen.getByTestId('fitness-feedback-rerecord')).toBeInTheDocument();
  });

  it('submits feedback with app=fitness and surface=home context on save', async () => {
    mockRecorderState.isRecording = true;
    render(<FitnessFeedback onClose={() => {}} view="menu" userId="user_1" />);
    fireEvent.pointerDown(screen.getByTestId('fitness-feedback-record'));
    const save = await screen.findByTestId('fitness-feedback-save');
    fireEvent.pointerDown(save);
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const arg = submitMock.mock.calls[0][0];
    expect(arg.app).toBe('fitness');
    expect(arg.durationMs).toBe(4200);
    expect(arg.blob).toBeInstanceOf(Blob);
    expect(arg.context).toMatchObject({ surface: 'home', view: 'menu', userId: 'user_1' });
  });

  it('shows a thank-you state after a successful save', async () => {
    mockRecorderState.isRecording = true;
    render(<FitnessFeedback onClose={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId('fitness-feedback-record'));
    const save = await screen.findByTestId('fitness-feedback-save');
    fireEvent.pointerDown(save);
    await screen.findByTestId('fitness-feedback-saved');
  });

  it('invokes onClose when the close control is tapped', () => {
    const onClose = vi.fn();
    render(<FitnessFeedback onClose={onClose} />);
    fireEvent.pointerDown(screen.getByTestId('fitness-feedback-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
