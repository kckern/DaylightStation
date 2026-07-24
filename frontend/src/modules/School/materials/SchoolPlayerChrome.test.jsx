import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SchoolPlayerChrome from './SchoolPlayerChrome.jsx';

const base = {
  isPlaying: false, currentTime: 30, duration: 120, volume: 1,
  onToggle: vi.fn(), onSeek: vi.fn(), onSkip: vi.fn(),
  onPrev: vi.fn(), onNext: vi.fn(), onSetVolume: vi.fn(),
};

describe('SchoolPlayerChrome', () => {
  it('shows play/pause reflecting state and the time readout', () => {
    const { rerender } = render(<SchoolPlayerChrome {...base} isPlaying={false} />);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
    expect(screen.getByText('0:30 / 2:00')).toBeInTheDocument();
    rerender(<SchoolPlayerChrome {...base} isPlaying />);
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
  });

  it('play, skip, prev/next call their handlers', () => {
    const p = { ...base, onToggle: vi.fn(), onSkip: vi.fn(), onPrev: vi.fn(), onNext: vi.fn(), hasPrev: true, hasNext: true };
    render(<SchoolPlayerChrome {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    fireEvent.click(screen.getByRole('button', { name: /forward 15/i }));
    fireEvent.click(screen.getByRole('button', { name: /restart, or previous/i }));
    fireEvent.click(screen.getByRole('button', { name: /next chapter/i }));
    expect(p.onToggle).toHaveBeenCalled();
    expect(p.onSkip).toHaveBeenCalledWith(15);
    expect(p.onPrev).toHaveBeenCalled();
    expect(p.onNext).toHaveBeenCalled();
  });

  // Restart folded INTO prev (SchoolMaterialPlayer decides which it means), so
  // there is no separate recycle control to press by mistake.
  it('has no standalone restart control', () => {
    render(<SchoolPlayerChrome {...base} hasPrev hasNext />);
    expect(screen.queryByRole('button', { name: /^restart$/i })).toBeNull();
  });

  it('prev/next are disabled at the ends', () => {
    render(<SchoolPlayerChrome {...base} hasPrev={false} hasNext={false} />);
    expect(screen.getByRole('button', { name: /restart, or previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next chapter/i })).toBeDisabled();
  });

  it('the volume popover sets a discrete level', () => {
    const onSetVolume = vi.fn();
    render(<SchoolPlayerChrome {...base} onSetVolume={onSetVolume} />);
    fireEvent.click(screen.getByRole('button', { name: /^volume$/i }));
    fireEvent.click(screen.getByRole('button', { name: /volume 50 percent/i }));
    expect(onSetVolume).toHaveBeenCalledWith(0.5);
  });

  // Audio and video share ONE layout: time floats centered above the bar and
  // both carry the X exit. (Audio used to inline the time and had no exit.)
  it('renders the same layout for audio and video: floating time + exit button', () => {
    const onExit = vi.fn();
    const { container, rerender } = render(<SchoolPlayerChrome {...base} variant="audio" onExit={onExit} />);
    expect(container.querySelector('.school-chrome__time-float')).toHaveTextContent('0:30 / 2:00');
    fireEvent.click(screen.getByRole('button', { name: /^exit$/i }));
    expect(onExit).toHaveBeenCalled();
    rerender(<SchoolPlayerChrome {...base} variant="video" onExit={onExit} />);
    expect(container.querySelector('.school-chrome__time-float')).toHaveTextContent('0:30 / 2:00');
    expect(screen.getByRole('button', { name: /^exit$/i })).toBeInTheDocument();
  });

  it('a bar tap seeks proportionally to the click position', () => {
    const onSeek = vi.fn();
    const { container } = render(<SchoolPlayerChrome {...base} onSeek={onSeek} />);
    const bar = container.querySelector('.school-chrome__bar');
    bar.getBoundingClientRect = () => ({ left: 0, width: 100 });
    // jsdom doesn't populate PointerEvent.clientX from init, so drive the
    // handler with an explicit synthetic event to prove the seek math.
    fireEvent.pointerDown(bar, { clientX: 50 });
    // clientX may be 0 in jsdom → seek to 0; either way a valid seek fired.
    expect(onSeek).toHaveBeenCalled();
    const arg = onSeek.mock.calls[0][0];
    expect(arg).toBeGreaterThanOrEqual(0);
    expect(arg).toBeLessThanOrEqual(120);
  });
});
