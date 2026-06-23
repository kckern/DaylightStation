// PianoVideoChrome.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PianoVideoChrome from './PianoVideoChrome.jsx';

const baseProps = {
  isPlaying: true, currentTime: 30, duration: 120, rate: 1, loop: { a: null, b: null },
  playAlong: true,
  onToggle: vi.fn(), onSkip: vi.fn(), onCycleRate: vi.fn(),
  onMarkA: vi.fn(), onMarkB: vi.fn(), onClearLoop: vi.fn(), onSeek: vi.fn(), onBack: vi.fn(),
  onTogglePlayAlong: vi.fn(),
};

describe('PianoVideoChrome', () => {
  it('shows the pause control while playing and toggles', () => {
    const onToggle = vi.fn();
    render(<PianoVideoChrome {...baseProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(onToggle).toHaveBeenCalled();
  });
  it('toggles the play-along panel', () => {
    const onTogglePlayAlong = vi.fn();
    render(<PianoVideoChrome {...baseProps} onTogglePlayAlong={onTogglePlayAlong} />);
    fireEvent.click(screen.getByLabelText('Hide play-along'));
    expect(onTogglePlayAlong).toHaveBeenCalled();
  });
  it('skips by the labeled amounts', () => {
    const onSkip = vi.fn();
    render(<PianoVideoChrome {...baseProps} onSkip={onSkip} />);
    fireEvent.click(screen.getByLabelText('Back 30 seconds'));
    fireEvent.click(screen.getByLabelText('Forward 15 seconds'));
    expect(onSkip).toHaveBeenCalledWith(-30);
    expect(onSkip).toHaveBeenCalledWith(15);
  });
  it('renders the current rate and cycles it', () => {
    const onCycleRate = vi.fn();
    render(<PianoVideoChrome {...baseProps} rate={1.5} onCycleRate={onCycleRate} />);
    fireEvent.click(screen.getByText('1.5×'));
    expect(onCycleRate).toHaveBeenCalled();
  });
  it('marks A and B for the loop', () => {
    const onMarkA = vi.fn(); const onMarkB = vi.fn();
    render(<PianoVideoChrome {...baseProps} onMarkA={onMarkA} onMarkB={onMarkB} />);
    fireEvent.click(screen.getByLabelText('Mark loop start'));
    fireEvent.click(screen.getByLabelText('Mark loop end'));
    expect(onMarkA).toHaveBeenCalled();
    expect(onMarkB).toHaveBeenCalled();
  });
});
