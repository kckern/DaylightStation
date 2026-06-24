// PianoVideoChrome.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PianoVideoChrome from './PianoVideoChrome.jsx';

const mix = vi.hoisted(() => ({
  pianoLevel: 0.8, mediaLevel: 0.5, setPianoLevel: vi.fn(), setMediaLevel: vi.fn(),
}));
vi.mock('../../PianoMixContext.jsx', () => ({ usePianoMix: () => mix }));

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

describe('PianoVideoChrome — mix balance', () => {
  it('drives the piano level down/up from the mix context', () => {
    mix.setPianoLevel.mockReset();
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Piano volume down'));
    fireEvent.click(screen.getByLabelText('Piano volume up'));
    expect(mix.setPianoLevel).toHaveBeenCalledTimes(2);
  });
  it('drives the media level down/up from the mix context', () => {
    mix.setMediaLevel.mockReset();
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Media volume down'));
    fireEvent.click(screen.getByLabelText('Media volume up'));
    expect(mix.setMediaLevel).toHaveBeenCalledTimes(2);
  });
});
