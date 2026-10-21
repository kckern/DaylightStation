import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock("./GovernanceAudioPlayer.jsx", () => ({ default: () => null }));

import GovernanceStateOverlay from "./GovernanceStateOverlay.jsx";

const row = (overrides) => ({
  key: overrides.userId, avatarSrc: '', heartRate: 120, progress: 0.5,
  currentZone: { id: 'warm', name: 'Warm' }, targetZone: { id: 'hot', name: 'Hot' },
  status: 'missing', statusZoneLabel: null, ...overrides,
});

describe('GovernanceStateOverlay — unattended start and hold statuses on rows', () => {
  it('warning chips: overdue child shows "Reach Hot", a holding rider reads Holding', () => {
    const { container } = render(<GovernanceStateOverlay display={{
      show: true, status: 'warning', deadline: Date.now() + 30_000, gracePeriodTotal: 30,
      rows: [
        row({ userId: 'child-a', displayName: 'Child A', status: 'start-overdue', statusZoneLabel: 'hot' }),
        row({ userId: 'child-b', displayName: 'Child B', status: 'holding', statusZoneLabel: 'Warm' }),
        row({ userId: 'child-c', displayName: 'Child C' }),
      ],
    }} />);
    const chips = container.querySelectorAll('.governance-progress-overlay__chip');
    expect(chips).toHaveLength(3);
    expect(chips[0].querySelector('.governance-start-badge--overdue').textContent).toBe('Reach Hot');
    expect(chips[1].classList.contains('governance-progress-overlay__chip--holding')).toBe(true);
    expect(chips[1].textContent).toContain('Holding');
    expect(chips[2].querySelector('.governance-start-badge')).toBeNull();
    expect(chips[2].classList.contains('governance-progress-overlay__chip--holding')).toBe(false);
  });

  it('lock panel rows: overdue child shows the badge', () => {
    const { container } = render(<GovernanceStateOverlay display={{
      show: true, status: 'locked', videoLocked: true, activeUserCount: 2, requirements: [],
      rows: [row({ userId: 'child-a', displayName: 'Child A', status: 'start-overdue', statusZoneLabel: 'Hot' })],
    }} />);
    expect(container.querySelector('.governance-lock__row .governance-start-badge--overdue').textContent).toBe('Reach Hot');
  });
});
