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
  onToggle: vi.fn(), onSkip: vi.fn(), onRestart: vi.fn(), onCycleRate: vi.fn(),
  onMarkA: vi.fn(), onMarkB: vi.fn(), onClearLoop: vi.fn(), onSeek: vi.fn(), onBack: vi.fn(),
};

describe('PianoVideoChrome', () => {
  it('shows the pause control while playing and toggles', () => {
    const onToggle = vi.fn();
    render(<PianoVideoChrome {...baseProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(onToggle).toHaveBeenCalled();
  });
  it('no longer renders the play-along toggle (keyboard is always visible)', () => {
    render(<PianoVideoChrome {...baseProps} />);
    expect(screen.queryByLabelText('Hide play-along')).toBeNull();
    expect(screen.queryByLabelText('Show play-along')).toBeNull();
  });
  it('skips ±15s', () => {
    const onSkip = vi.fn();
    render(<PianoVideoChrome {...baseProps} onSkip={onSkip} />);
    fireEvent.click(screen.getByLabelText('Back 15 seconds'));
    fireEvent.click(screen.getByLabelText('Forward 15 seconds'));
    expect(onSkip).toHaveBeenCalledWith(-15);
    expect(onSkip).toHaveBeenCalledWith(15);
  });
  it('does not render ±30s skip buttons', () => {
    render(<PianoVideoChrome {...baseProps} onSkip={vi.fn()} />);
    expect(screen.queryByLabelText('Back 30 seconds')).toBeNull();
    expect(screen.queryByLabelText('Forward 30 seconds')).toBeNull();
  });
  it('calls onRestart when the restart button is clicked', () => {
    const onRestart = vi.fn();
    render(<PianoVideoChrome {...baseProps} onRestart={onRestart} />);
    fireEvent.click(screen.getByLabelText('Restart from beginning'));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
  it('renders the current rate and cycles it', () => {
    const onCycleRate = vi.fn();
    render(<PianoVideoChrome {...baseProps} rate={1.5} onCycleRate={onCycleRate} />);
    fireEvent.click(screen.getByLabelText('Playback speed'));
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

describe('PianoVideoChrome — mix flyout', () => {
  it('does not show mix controls until the mix button is tapped', () => {
    render(<PianoVideoChrome {...baseProps} />);
    expect(screen.queryByLabelText('Piano volume down')).toBeNull();
  });
  it('shows mix controls after tapping the mix toggle button', () => {
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Toggle mix controls'));
    expect(screen.getByLabelText('Piano volume down')).toBeInTheDocument();
  });
  it('hides mix controls after tapping the mix toggle button twice', () => {
    render(<PianoVideoChrome {...baseProps} />);
    fireEvent.click(screen.getByLabelText('Toggle mix controls'));
    fireEvent.click(screen.getByLabelText('Toggle mix controls'));
    expect(screen.queryByLabelText('Piano volume down')).toBeNull();
  });
});

describe('sequential mode restrictions', () => {
  const baseProps = {
    isPlaying: false, currentTime: 60, duration: 600, rate: 1, loop: {},
    playAlong: false,
    onToggle: vi.fn(), onSkip: vi.fn(), onCycleRate: vi.fn(),
    onMarkA: vi.fn(), onMarkB: vi.fn(), onToggleLoop: vi.fn(),
    onClearLoop: vi.fn(), onSeek: vi.fn(), onTogglePlayAlong: vi.fn(),
  };

  it('hides the rate button when isSequential', () => {
    render(<PianoVideoChrome {...baseProps} isSequential furthestWatched={60} />);
    expect(screen.queryByLabelText('Playback speed')).toBeNull();
  });

  it('shows the rate button when NOT sequential', () => {
    render(<PianoVideoChrome {...baseProps} isSequential={false} furthestWatched={60} />);
    expect(screen.getByLabelText('Playback speed')).toBeTruthy();
  });

  it('disables forward skips when currentTime is at furthestWatched', () => {
    render(<PianoVideoChrome {...baseProps} isSequential currentTime={60} furthestWatched={60} />);
    expect(screen.getByLabelText('Forward 15 seconds')).toBeDisabled();
  });

  it('enables forward skips when behind furthestWatched', () => {
    render(<PianoVideoChrome {...baseProps} isSequential currentTime={30} furthestWatched={60} />);
    expect(screen.getByLabelText('Forward 15 seconds')).not.toBeDisabled();
  });

  it('keeps backward skips enabled in sequential mode', () => {
    render(<PianoVideoChrome {...baseProps} isSequential currentTime={60} furthestWatched={60} />);
    expect(screen.getByLabelText('Back 15 seconds')).not.toBeDisabled();
  });

  it('does not disable forward skips when NOT sequential even past furthestWatched', () => {
    render(<PianoVideoChrome {...baseProps} isSequential={false} currentTime={600} furthestWatched={60} />);
    expect(screen.getByLabelText('Forward 15 seconds')).not.toBeDisabled();
  });
});

describe('PianoVideoChrome — mix balance', () => {
  const openMix = () => fireEvent.click(screen.getByLabelText('Toggle mix controls'));

  it('drives the piano level down/up from the mix context', () => {
    mix.setPianoLevel.mockReset();
    render(<PianoVideoChrome {...baseProps} />);
    openMix();
    fireEvent.click(screen.getByLabelText('Piano volume down'));
    fireEvent.click(screen.getByLabelText('Piano volume up'));
    expect(mix.setPianoLevel).toHaveBeenCalledTimes(2);
  });
  it('drives the media level down/up from the mix context', () => {
    mix.setMediaLevel.mockReset();
    render(<PianoVideoChrome {...baseProps} />);
    openMix();
    fireEvent.click(screen.getByLabelText('Media volume down'));
    fireEvent.click(screen.getByLabelText('Media volume up'));
    expect(mix.setMediaLevel).toHaveBeenCalledTimes(2);
  });
});
