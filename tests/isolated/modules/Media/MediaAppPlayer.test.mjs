import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';

vi.mock('#frontend/modules/Player/Player.jsx', () => ({
  default: vi.fn(({ play }) => play ? React.createElement('div', { 'data-testid': 'player' }, play.contentId) : null),
}));

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

describe('MediaAppPlayer', () => {
  it('applies fullscreen class when isFullscreen=true', async () => {
    const { render } = await import('@testing-library/react');
    const { default: MediaAppPlayer } = await import('#frontend/modules/Media/MediaAppPlayer.jsx');
    const { container } = render(
      React.createElement(MediaAppPlayer, { contentId: 'plex:1', isFullscreen: true, onExitFullscreen: () => {} })
    );
    expect(container.querySelector('.media-player-wrapper.fullscreen')).toBeTruthy();
  });

  it('does not apply fullscreen class when isFullscreen=false', async () => {
    const { render } = await import('@testing-library/react');
    const { default: MediaAppPlayer } = await import('#frontend/modules/Media/MediaAppPlayer.jsx');
    const { container } = render(
      React.createElement(MediaAppPlayer, { contentId: 'plex:1', isFullscreen: false, onExitFullscreen: () => {} })
    );
    expect(container.querySelector('.media-player-wrapper.fullscreen')).toBeNull();
  });

  it('calls onExitFullscreen when exit button clicked', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/react');
    const { default: MediaAppPlayer } = await import('#frontend/modules/Media/MediaAppPlayer.jsx');
    const onExit = vi.fn();
    render(
      React.createElement(MediaAppPlayer, { contentId: 'plex:1', isFullscreen: true, onExitFullscreen: onExit })
    );
    fireEvent.click(screen.getByLabelText('Exit fullscreen'));
    expect(onExit).toHaveBeenCalled();
  });

  it('renders renderOverlay content inside fullscreen wrapper', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { default: MediaAppPlayer } = await import('#frontend/modules/Media/MediaAppPlayer.jsx');
    render(
      React.createElement(MediaAppPlayer, {
        contentId: 'plex:1',
        isFullscreen: true,
        onExitFullscreen: () => {},
        renderOverlay: () => React.createElement('div', { 'data-testid': 'overlay-content' }, 'Overlay'),
      })
    );
    expect(screen.getByTestId('overlay-content')).toBeTruthy();
  });

  it('does not render renderOverlay when not fullscreen', async () => {
    const { render, screen } = await import('@testing-library/react');
    const { default: MediaAppPlayer } = await import('#frontend/modules/Media/MediaAppPlayer.jsx');
    render(
      React.createElement(MediaAppPlayer, {
        contentId: 'plex:1',
        isFullscreen: false,
        onExitFullscreen: () => {},
        renderOverlay: () => React.createElement('div', { 'data-testid': 'overlay-content' }, 'Overlay'),
      })
    );
    expect(screen.queryByTestId('overlay-content')).toBeNull();
  });
});
