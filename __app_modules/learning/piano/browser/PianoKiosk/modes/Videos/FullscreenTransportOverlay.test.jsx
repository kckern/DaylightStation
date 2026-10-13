import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FullscreenTransportOverlay from './FullscreenTransportOverlay.jsx';

const noopHandlers = () => ({
  onSkip: vi.fn(), onToggle: vi.fn(), onExitFullscreen: vi.fn(), onDismiss: vi.fn(),
});

describe('FullscreenTransportOverlay', () => {
  it('fires skips without dismissing or toggling', () => {
    const h = noopHandlers();
    render(<FullscreenTransportOverlay isPlaying {...h} />);
    fireEvent.click(screen.getByLabelText('Back 30 seconds'));
    fireEvent.click(screen.getByLabelText('Back 15 seconds'));
    fireEvent.click(screen.getByLabelText('Forward 15 seconds'));
    fireEvent.click(screen.getByLabelText('Forward 30 seconds'));
    expect(h.onSkip.mock.calls.map((c) => c[0])).toEqual([-30, -15, 15, 30]);
    expect(h.onToggle).not.toHaveBeenCalled();
    expect(h.onDismiss).not.toHaveBeenCalled();
  });

  it('shows Pause while playing and Play while paused, and toggles', () => {
    const h = noopHandlers();
    const { rerender } = render(<FullscreenTransportOverlay isPlaying {...h} />);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(h.onToggle).toHaveBeenCalledTimes(1);
    rerender(<FullscreenTransportOverlay isPlaying={false} {...h} />);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(h.onToggle).toHaveBeenCalledTimes(2);
    expect(h.onDismiss).not.toHaveBeenCalled();
  });

  it('exits fullscreen from the exit button without dismiss-toggling', () => {
    const h = noopHandlers();
    render(<FullscreenTransportOverlay isPlaying {...h} />);
    fireEvent.click(screen.getByLabelText('Exit fullscreen'));
    expect(h.onExitFullscreen).toHaveBeenCalledTimes(1);
    expect(h.onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on a backdrop tap without bubbling to a parent onClick', () => {
    const h = noopHandlers();
    const parentClick = vi.fn();
    const { container } = render(
      <div onClick={parentClick}>
        <FullscreenTransportOverlay isPlaying {...h} />
      </div>,
    );
    fireEvent.click(container.querySelector('.piano-fs-overlay'));
    expect(h.onDismiss).toHaveBeenCalledTimes(1);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('disables forward skips when forwardDisabled', () => {
    const h = noopHandlers();
    render(<FullscreenTransportOverlay isPlaying forwardDisabled {...h} />);
    expect(screen.getByLabelText('Forward 15 seconds').disabled).toBe(true);
    expect(screen.getByLabelText('Forward 30 seconds').disabled).toBe(true);
  });
});
