import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('../lib/playbackLogger.js', () => ({ playbackLog: vi.fn() }));
vi.mock('../../../assets/icons/pause.svg', () => ({ default: 'pause.svg' }));

const { PlayerOverlayPaused } = await import('./PlayerOverlayPaused.jsx');

const BASE = {
  shouldRender: true,
  isVisible: true,
  pauseOverlayActive: true,
  seconds: 42,
  stalled: false,
  waitingToPlay: false,
  togglePauseOverlay: () => {},
};

describe('PlayerOverlayPaused', () => {
  it('renders the pause scrim by default', () => {
    const { container } = render(<PlayerOverlayPaused {...BASE} />);
    expect(container.querySelector('.loading-overlay.paused')).not.toBeNull();
  });

  it('renders nothing when suppressPauseOverlay is set', () => {
    const { container } = render(<PlayerOverlayPaused {...BASE} suppressPauseOverlay />);
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();
  });

  it('still renders nothing when suppressed during a stall', () => {
    const { container } = render(<PlayerOverlayPaused {...BASE} stalled suppressPauseOverlay />);
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();
  });
});
