import React from 'react';
import { render } from '@testing-library/react';
import { PlayerOverlayPaused } from './PlayerOverlayPaused.jsx';

describe('PlayerOverlayPaused — renders during stall', () => {
  it('renders the pause icon when the user has paused AND playback is stalled', () => {
    const { container } = render(
      <PlayerOverlayPaused
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={true}
        seconds={120}
        waitingToPlay={false}
      />
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('still suppresses during initial playback (seconds=0, not stalled)', () => {
    const { container } = render(
      <PlayerOverlayPaused
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={false}
        seconds={0}
        waitingToPlay={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('still suppresses during waitingToPlay', () => {
    const { container } = render(
      <PlayerOverlayPaused
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={false}
        seconds={120}
        waitingToPlay={true}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
