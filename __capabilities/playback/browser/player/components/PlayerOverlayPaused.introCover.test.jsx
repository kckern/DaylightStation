import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { setIntroCovering } from '../../player-support/introCover.js';

vi.mock('../lib/playbackLogger.js', () => ({ playbackLog: vi.fn() }));
vi.mock('../../../../../frontend/src/assets/icons/pause.svg', () => ({ default: 'pause.svg' }));

const { PlayerOverlayPaused } = await import('./PlayerOverlayPaused.jsx');

const BASE = {
  shouldRender: true, isVisible: true, pauseOverlayActive: true,
  seconds: 0.08, stalled: false, waitingToPlay: false, togglePauseOverlay: () => {},
};

// The intro gate holds the first frame paused under the scene. On the video path
// that pause reads as the viewer's (no pause intent is reported), so the pause
// scrim would otherwise be drawn over the scene.
describe('PlayerOverlayPaused — covering intro', () => {
  afterEach(() => setIntroCovering(false));

  it('draws no pause scrim while an intro covers (the hold is the intro\'s pause)', () => {
    setIntroCovering(true);
    const { container } = render(<PlayerOverlayPaused {...BASE} />);
    expect(container.querySelector('.loading-overlay.paused')).toBeNull();
  });

  it('draws the scrim again once the intro steps aside', () => {
    setIntroCovering(true);
    const { container, rerender } = render(<PlayerOverlayPaused {...BASE} />);
    setIntroCovering(false);
    rerender(<PlayerOverlayPaused {...BASE} seconds={42} />);
    expect(container.querySelector('.loading-overlay.paused')).not.toBeNull();
  });
});
