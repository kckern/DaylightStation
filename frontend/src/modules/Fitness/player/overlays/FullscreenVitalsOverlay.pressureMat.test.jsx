/**
 * The fullscreen overlay used to render heart-rate and RPM avatars only, so a
 * step mat simply vanished when the video went fullscreen. These cover the mat
 * group: that it appears, that a mat-only session still renders the overlay at
 * all, and that an untouched mat stays out of the way.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockContext = vi.fn();
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => mockContext(),
}));
vi.mock('@/lib/api.mjs', () => ({
  DaylightMediaPath: (path) => path,
}));

import FullscreenVitalsOverlay from './FullscreenVitalsOverlay.jsx';

const matSnapshot = (overrides = {}) => ({
  equipmentId: 'step_mat',
  matId: 'garage-step-mat',
  online: true,
  active: true,
  engaged: true,
  seenThisSession: true,
  sessionSteps: 123,
  sessionStomps: 12,
  stepsPerMinute: 48,
  users: {},
  ...overrides,
});

const contextWith = (snapshots, extra = {}) => ({
  heartRateDevices: [],
  rpmDevices: [],
  equipment: [{ id: 'step_mat', name: 'Step Mat', type: 'pressure_mat' }],
  pressureMatActivities: snapshots,
  fitnessSessionInstance: { getEquipmentUser: () => 'rider_a' },
  ...extra,
});

describe('FullscreenVitalsOverlay — pressure mat group', () => {
  beforeEach(() => mockContext.mockReset());

  it('renders a mat tile with rate and session totals', () => {
    mockContext.mockReturnValue(contextWith({ step_mat: matSnapshot() }));
    render(<FullscreenVitalsOverlay visible />);

    expect(screen.getByText('48')).toBeTruthy();
    expect(screen.getByText('123')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('SPM')).toBeTruthy();
  });

  it('renders the overlay for a mat-only session, with no HR or RPM present', () => {
    mockContext.mockReturnValue(contextWith({ step_mat: matSnapshot() }));
    const { container } = render(<FullscreenVitalsOverlay visible />);
    expect(container.querySelector('.fullscreen-vitals-overlay')).toBeTruthy();
    expect(container.querySelector('.mat-group')).toBeTruthy();
  });

  it('omits a mat that has not been stepped on this session', () => {
    mockContext.mockReturnValue(contextWith({
      step_mat: matSnapshot({ seenThisSession: false, sessionSteps: 0, stepsPerMinute: 0 }),
    }));
    const { container } = render(<FullscreenVitalsOverlay visible />);
    expect(container.querySelector('.fullscreen-vitals-overlay')).toBeNull();
  });

  it('uses the claimed rider avatar, falling back to the equipment image when unclaimed', () => {
    mockContext.mockReturnValue(contextWith({ step_mat: matSnapshot() }));
    const { container, rerender } = render(<FullscreenVitalsOverlay visible />);
    expect(container.querySelector('.step-mat-tile__avatar').getAttribute('src'))
      .toBe('/static/img/users/rider_a');

    mockContext.mockReturnValue(contextWith(
      { step_mat: matSnapshot() },
      { fitnessSessionInstance: { getEquipmentUser: () => null } }
    ));
    rerender(<FullscreenVitalsOverlay visible />);
    expect(container.querySelector('.step-mat-tile__avatar').getAttribute('src'))
      .toBe('/static/img/equipment/step_mat');
  });

  it('dims a mat whose sensor has gone offline', () => {
    mockContext.mockReturnValue(contextWith({
      step_mat: matSnapshot({ online: false, active: false, stepsPerMinute: 0 }),
    }));
    const { container } = render(<FullscreenVitalsOverlay visible />);
    expect(container.querySelector('.step-mat-tile').className).toContain('inactive');
  });
});
