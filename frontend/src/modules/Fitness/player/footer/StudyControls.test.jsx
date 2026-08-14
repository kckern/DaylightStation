import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import StudyControls from './StudyControls.jsx';

const BASE = {
  isPaused: true,
  jogSteps: [5, 10],
  loopDurations: [10, 15, 20, 30],
  loop: null,
  onJog: vi.fn(),
  onArmLoop: vi.fn(),
  onReleaseLoop: vi.fn(),
  videoMirrored: false,
  onToggleMirror: vi.fn(),
};

describe('StudyControls', () => {
  it('renders a jog button per configured step, both directions', () => {
    const { getByLabelText } = render(<StudyControls {...BASE} />);
    expect(getByLabelText('Back 5 seconds')).toBeTruthy();
    expect(getByLabelText('Back 10 seconds')).toBeTruthy();
    expect(getByLabelText('Forward 5 seconds')).toBeTruthy();
    expect(getByLabelText('Forward 10 seconds')).toBeTruthy();
  });

  it('calls onJog with a signed delta', () => {
    const onJog = vi.fn();
    const { getByLabelText } = render(<StudyControls {...BASE} onJog={onJog} />);
    fireEvent.click(getByLabelText('Back 10 seconds'));
    expect(onJog).toHaveBeenCalledWith(-10);
    fireEvent.click(getByLabelText('Forward 5 seconds'));
    expect(onJog).toHaveBeenCalledWith(5);
  });

  it('shows NEW loop options only while paused', () => {
    const { queryByLabelText, rerender } = render(<StudyControls {...BASE} />);
    expect(queryByLabelText('Loop back 15 seconds')).toBeTruthy();
    rerender(<StudyControls {...BASE} isPaused={false} />);
    expect(queryByLabelText('Loop back 15 seconds')).toBeNull();
  });

  // A running loop starts playback (armLoop calls onPlay), so `isPaused` goes false the
  // moment the loop engages. Gating the armed chip on `isPaused` made the loop invisible
  // and impossible to release except by scrubbing out of its own window.
  it('keeps the ARMED chip visible while NOT paused, and offers no other options', () => {
    const { getByLabelText, queryByLabelText } = render(
      <StudyControls {...BASE} isPaused={false} loop={{ direction: 'back', seconds: 15 }} />
    );
    const chip = getByLabelText('Loop back 15 seconds');
    expect(chip).toBeTruthy();
    expect(chip.className).toMatch(/is-active/);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    // Unarmed durations are not offered while playing — the anchor position is moving.
    expect(queryByLabelText('Loop back 20 seconds')).toBeNull();
    expect(queryByLabelText('Loop forward 15 seconds')).toBeNull();
  });

  it('releases when the armed chip is tapped DURING playback', () => {
    const onReleaseLoop = vi.fn();
    const { getByLabelText } = render(
      <StudyControls
        {...BASE}
        isPaused={false}
        loop={{ direction: 'forward', seconds: 30 }}
        onReleaseLoop={onReleaseLoop}
      />
    );
    fireEvent.click(getByLabelText('Loop forward 30 seconds'));
    expect(onReleaseLoop).toHaveBeenCalled();
  });

  it('renders nothing loop-related while playing with no loop armed', () => {
    const { queryByLabelText } = render(<StudyControls {...BASE} isPaused={false} loop={null} />);
    expect(queryByLabelText('Loop back 15 seconds')).toBeNull();
    expect(queryByLabelText('Loop forward 30 seconds')).toBeNull();
  });

  it('arms a loop with direction and duration', () => {
    const onArmLoop = vi.fn();
    const { getByLabelText } = render(<StudyControls {...BASE} onArmLoop={onArmLoop} />);
    fireEvent.click(getByLabelText('Loop forward 20 seconds'));
    expect(onArmLoop).toHaveBeenCalledWith('forward', 20);
  });

  it('releases when the armed option is tapped again', () => {
    const onReleaseLoop = vi.fn();
    const { getByLabelText } = render(
      <StudyControls {...BASE} loop={{ direction: 'forward', seconds: 20 }} onReleaseLoop={onReleaseLoop} />
    );
    fireEvent.click(getByLabelText('Loop forward 20 seconds'));
    expect(onReleaseLoop).toHaveBeenCalled();
  });

  it('marks the armed option active', () => {
    const { getByLabelText } = render(
      <StudyControls {...BASE} loop={{ direction: 'back', seconds: 15 }} />
    );
    expect(getByLabelText('Loop back 15 seconds').className).toMatch(/is-active/);
  });

  it('exposes a mirror toggle reflecting current state', () => {
    const onToggleMirror = vi.fn();
    const { getByLabelText } = render(<StudyControls {...BASE} onToggleMirror={onToggleMirror} />);
    const btn = getByLabelText('Mirror video');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(btn);
    expect(onToggleMirror).toHaveBeenCalled();
  });
});
