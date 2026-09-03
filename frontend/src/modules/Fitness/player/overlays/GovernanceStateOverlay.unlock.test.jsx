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

describe('GovernanceStateOverlay — activity-rate requirement', () => {
  it('shows current and target SPM in the standard lock surface', () => {
    render(<GovernanceStateOverlay display={{
      show: true,
      status: 'locked',
      videoLocked: true,
      rows: [],
      activeUserCount: 0,
      requirements: [],
      activityRequirements: [{
        type: 'activity_rate', currentRate: 12, targetRate: 30, satisfied: false,
      }],
    }} />);
    expect(screen.getByText('Keep stepping: 12 / 30 SPM')).toBeTruthy();
    expect(screen.getByText('Stay on the step mat')).toBeTruthy();
  });
});

describe('GovernanceStateOverlay — failed step challenge', () => {
  it('shows the remaining physical target instead of participant vitals', () => {
    render(<GovernanceStateOverlay display={{
      show: true,
      status: 'locked',
      videoLocked: true,
      rows: [],
      activeUserCount: 2,
      challenge: {
        id: 'step-1', type: 'step', status: 'failed', metric: 'steps', target: 40, actualCount: 27,
      },
    }} />);
    expect(screen.getByText('Keep going: 27 / 40 steps')).toBeTruthy();
    expect(screen.getByText('Catch up to resume playback.')).toBeTruthy();
    expect(screen.queryByText('Collecting participant vitals...')).toBeNull();
  });
});
