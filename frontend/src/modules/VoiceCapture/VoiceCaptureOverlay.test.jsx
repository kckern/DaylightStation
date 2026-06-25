import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoiceCaptureOverlay } from './VoiceCaptureOverlay.jsx';

const baseProps = {
  open: true, title: 'Feedback', prompt: 'Tell us what is up.',
  phase: 'idle', durationMs: 0, levelRef: { current: 0 },
  transcript: '', transcriptStatus: null, error: null,
  onRecordToggle: vi.fn(), onKeep: vi.fn(), onRedo: vi.fn(), onClose: vi.fn(),
};

describe('VoiceCaptureOverlay', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<VoiceCaptureOverlay {...baseProps} open={false} />);
    expect(container.querySelector('.voice-capture-overlay')).toBeNull();
  });

  it('idle phase shows a Record control that calls onRecordToggle', () => {
    const onRecordToggle = vi.fn();
    render(<VoiceCaptureOverlay {...baseProps} onRecordToggle={onRecordToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /record/i }));
    expect(onRecordToggle).toHaveBeenCalled();
  });

  it('review phase shows the transcript and Keep/Redo', () => {
    const onKeep = vi.fn(); const onRedo = vi.fn();
    render(<VoiceCaptureOverlay {...baseProps} phase="review" transcript="It froze on lap 2." onKeep={onKeep} onRedo={onRedo} />);
    expect(screen.getByText('It froze on lap 2.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /keep/i }));
    fireEvent.click(screen.getByRole('button', { name: /redo/i }));
    expect(onKeep).toHaveBeenCalled();
    expect(onRedo).toHaveBeenCalled();
  });

  it('Escape calls onClose', () => {
    const onClose = vi.fn();
    render(<VoiceCaptureOverlay {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
