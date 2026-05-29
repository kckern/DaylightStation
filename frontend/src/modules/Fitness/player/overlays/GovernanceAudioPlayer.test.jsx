import React from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import GovernanceAudioPlayer from './GovernanceAudioPlayer.jsx';

let playSpy, pauseSpy;
beforeAll(() => {
  // jsdom doesn't implement these — mock so the component can call them.
  playSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  pauseSpy = vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { playSpy.mockClear(); pauseSpy.mockClear(); });

describe('GovernanceAudioPlayer — paused prop', () => {
  it('pauses the audio when paused becomes true, and resumes when false', () => {
    const { rerender } = render(<GovernanceAudioPlayer trackKey="locked" paused={false} />);
    // Initial play attempt happened (track loaded, not paused).
    expect(playSpy).toHaveBeenCalled();

    pauseSpy.mockClear();
    rerender(<GovernanceAudioPlayer trackKey="locked" paused={true} />);
    expect(pauseSpy).toHaveBeenCalled();

    playSpy.mockClear();
    rerender(<GovernanceAudioPlayer trackKey="locked" paused={false} />);
    expect(playSpy).toHaveBeenCalled();
  });

  it('does not auto-play a freshly-loaded track while paused', () => {
    playSpy.mockClear();
    render(<GovernanceAudioPlayer trackKey="locked" paused={true} />);
    expect(playSpy).not.toHaveBeenCalled();
  });
});
