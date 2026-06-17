import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Stub the audio player — jsdom lacks HTMLMediaElement playback and it's
// irrelevant to the Skip/Unlock button under test.
vi.mock('./GovernanceAudioPlayer.jsx', () => ({ default: () => null }));

import GovernanceStateOverlay from './GovernanceStateOverlay.jsx';

// Minimal locked-panel display payload (new-path) that renders GovernancePanelOverlay.
const lockedDisplay = {
  show: true,
  status: 'locked',
  videoLocked: true,
  rows: [],
  activeUserCount: 2,
};

describe('GovernanceStateOverlay — Skip / Unlock button', () => {
  it('does not render the button when onUnlock is not provided (backward compatible)', () => {
    render(<GovernanceStateOverlay display={lockedDisplay} />);
    expect(screen.queryByRole('button', { name: /skip or unlock/i })).toBeNull();
  });

  it('renders the button when onUnlock is provided', () => {
    render(<GovernanceStateOverlay display={lockedDisplay} onUnlock={() => {}} />);
    expect(screen.getByRole('button', { name: /skip or unlock/i })).toBeTruthy();
  });

  it('fires onUnlock on pointer-down tap', () => {
    const onUnlock = vi.fn();
    render(<GovernanceStateOverlay display={lockedDisplay} onUnlock={onUnlock} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /skip or unlock/i }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('does not render the button on the warning state', () => {
    const warningDisplay = { show: true, status: 'warning', rows: [], deadline: Date.now() + 30000, gracePeriodTotal: 30 };
    render(<GovernanceStateOverlay display={warningDisplay} onUnlock={() => {}} />);
    expect(screen.queryByRole('button', { name: /skip or unlock/i })).toBeNull();
  });
});
