import React from 'react';
import { render } from '@testing-library/react';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';

describe('PlayerOverlayLoading — renders during stalled-pause', () => {
  it('renders the spinner when stalled && pauseOverlayActive (so user sees recovery state)', () => {
    const { container } = render(
      <PlayerOverlayLoading
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={true}
        seconds={100}
        status="recovering"
      />
    );
    // Look for the .loading-overlay element (current implementation)
    expect(container.querySelector('.loading-overlay')).not.toBeNull();
  });

  it('still hides during healthy pause (not stalled)', () => {
    const { container } = render(
      <PlayerOverlayLoading
        shouldRender={true}
        isVisible={true}
        pauseOverlayActive={true}
        stalled={false}
        seconds={100}
        status="playing"
      />
    );
    expect(container.querySelector('.loading-overlay')).toBeNull();
  });
});
