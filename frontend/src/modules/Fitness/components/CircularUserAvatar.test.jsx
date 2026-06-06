import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CircularUserAvatar from './CircularUserAvatar.jsx';

describe('CircularUserAvatar boostBadge', () => {
  it('renders a boost badge when boostBadge is provided', () => {
    const { container } = render(<CircularUserAvatar name="Felix" boostBadge="×1.5" />);
    const badge = container.querySelector('.vital-boost-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('×1.5');
  });

  it('renders no badge when boostBadge is absent', () => {
    const { container } = render(<CircularUserAvatar name="Felix" />);
    expect(container.querySelector('.vital-boost-badge')).toBeNull();
  });
});

describe('CircularUserAvatar no-HR state', () => {
  it('hides the zone gauge and adds .no-hr when there is no active HR', () => {
    const { container } = render(
      <CircularUserAvatar name="KC" zoneColor="#22d3ee" heartRate={0} showGauge={true} />
    );
    expect(container.querySelector('.zone-progress-gauge')).toBeNull();
    expect(container.querySelector('.circular-user-avatar.no-hr')).not.toBeNull();
  });

  it('shows the zone gauge when there is active HR', () => {
    const { container } = render(
      <CircularUserAvatar name="KC" zoneColor="#e67e22" heartRate={150} zoneId="hot" showGauge={true} />
    );
    expect(container.querySelector('.zone-progress-gauge')).not.toBeNull();
    expect(container.querySelector('.circular-user-avatar.no-hr')).toBeNull();
  });
});
