import React from 'react';
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
