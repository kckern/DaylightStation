import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DanceNowPlayingBar from './DanceNowPlayingBar.jsx';

describe('DanceNowPlayingBar', () => {
  const track = { title: 'Get Lucky', artist: 'Daft Punk', coverUrl: '/cover.jpg' };

  it('shows the current track title and artist', () => {
    render(<DanceNowPlayingBar track={track} isPlaying onPlayPause={()=>{}} onNext={()=>{}} onExit={()=>{}} />);
    expect(screen.getByText('Get Lucky')).toBeInTheDocument();
    expect(screen.getByText('Daft Punk')).toBeInTheDocument();
  });

  it('fires onNext and onExit', () => {
    const onNext = vi.fn(); const onExit = vi.fn();
    render(<DanceNowPlayingBar track={track} isPlaying onPlayPause={()=>{}} onNext={onNext} onExit={onExit} />);
    fireEvent.click(screen.getByLabelText('Next'));
    fireEvent.click(screen.getByLabelText('Exit dance party'));
    expect(onNext).toHaveBeenCalled();
    expect(onExit).toHaveBeenCalled();
  });

  it('renders a strobe toggle when a handler is given, and fires it', () => {
    const onToggleStrobe = vi.fn();
    render(<DanceNowPlayingBar track={track} isPlaying onPlayPause={()=>{}} onNext={()=>{}} onExit={()=>{}}
      strobeOn={false} onToggleStrobe={onToggleStrobe} />);
    const btn = screen.getByLabelText('Turn strobe on');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn);
    expect(onToggleStrobe).toHaveBeenCalled();
  });

  it('strobe toggle reflects the on state; hidden without a handler', () => {
    const { rerender } = render(<DanceNowPlayingBar track={track} isPlaying onPlayPause={()=>{}} onNext={()=>{}} onExit={()=>{}}
      strobeOn onToggleStrobe={()=>{}} />);
    expect(screen.getByLabelText('Turn strobe off')).toHaveAttribute('aria-pressed', 'true');
    rerender(<DanceNowPlayingBar track={track} isPlaying onPlayPause={()=>{}} onNext={()=>{}} onExit={()=>{}} />);
    expect(screen.queryByLabelText(/strobe/i)).toBeNull();
  });

  it('renders a placeholder when there is no track', () => {
    render(<DanceNowPlayingBar track={null} isPlaying={false} onPlayPause={()=>{}} onNext={()=>{}} onExit={()=>{}} />);
    expect(screen.getByText(/no track|—/i)).toBeInTheDocument();
  });
});
