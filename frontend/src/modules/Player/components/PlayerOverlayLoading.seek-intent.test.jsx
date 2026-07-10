import React from 'react';
import { render } from '@testing-library/react';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';

const positionText = (container) => container.querySelector('.loading-position')?.textContent;

describe('PlayerOverlayLoading — seek intent wins while waiting', () => {
  it('shows the intent position during an active seek', () => {
    const { container } = render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="seeking"
        playerPositionDisplay="1:05"
        intentPositionDisplay="4:30"
      />
    );
    expect(positionText(container)).toBe('4:30');
  });

  it('shows the intent position while stalled, even when the intent is stale (>5s)', () => {
    // A seek-induced transcode stall can outlast the 5s freshness window; the
    // spinner must keep showing where we're GOING, not where playback pinned.
    const { container } = render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="recovering"
        stalled
        playerPositionDisplay="1:05"
        intentPositionDisplay="4:30"
        playerPositionUpdatedAt={Date.now()}
        intentPositionUpdatedAt={Date.now() - 60_000}
      />
    );
    expect(positionText(container)).toBe('4:30');
  });

  it('shows the intent position while waiting to play', () => {
    const { container } = render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="pending"
        waitingToPlay
        playerPositionDisplay="1:05"
        intentPositionDisplay="4:30"
      />
    );
    expect(positionText(container)).toBe('4:30');
  });

  it('falls back to the player position while waiting with no intent', () => {
    const { container } = render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="recovering"
        stalled
        playerPositionDisplay="1:05"
        intentPositionDisplay={null}
      />
    );
    expect(positionText(container)).toBe('1:05');
  });

  it('uses freshness (current playhead beats an old intent) outside seek/stall waits', () => {
    const { container } = render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="recovering"
        stalled={false}
        waitingToPlay={false}
        playerPositionDisplay="1:05"
        intentPositionDisplay="4:30"
        playerPositionUpdatedAt={Date.now()}
        intentPositionUpdatedAt={Date.now() - 60_000}
      />
    );
    expect(positionText(container)).toBe('1:05');
  });
});
