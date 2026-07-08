import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RiderReadyStrip from './RiderReadyStrip.jsx';

const riders = [
  { id: 'user_3', name: 'User_3', avatarSrc: '/api/v1/static/img/users/user_3', rpm: 0, compliant: true },
  { id: 'user_2', name: 'User_2', avatarSrc: '/api/v1/static/img/users/user_2', rpm: 14, compliant: false }
];

describe('RiderReadyStrip', () => {
  it('renders a chip per on-board rider with name + RPM', () => {
    const { getByTestId } = render(<RiderReadyStrip riders={riders} />);
    const user_3 = getByTestId('ready-rider-user_3');
    const user_2 = getByTestId('ready-rider-user_2');
    expect(user_3.textContent).toContain('User_3');
    expect(user_3.textContent).toContain('0');
    expect(user_2.textContent).toContain('14');
  });

  it('shows READY for a compliant (not pedaling) rider', () => {
    const { getByTestId } = render(<RiderReadyStrip riders={riders} />);
    const user_3 = getByTestId('ready-rider-user_3');
    expect(user_3.textContent).toContain('READY');
    expect(user_3.className).toContain('is-compliant');
  });

  it('shows WAIT for a non-compliant (pedaling) rider', () => {
    const { getByTestId } = render(<RiderReadyStrip riders={riders} />);
    const user_2 = getByTestId('ready-rider-user_2');
    expect(user_2.textContent).toContain('WAIT');
    expect(user_2.className).toContain('is-violating');
  });

  it('renders nothing when there are no riders', () => {
    const { container } = render(<RiderReadyStrip riders={[]} />);
    expect(container.querySelector('.cg-ready-strip')).toBeNull();
  });

  // audit C6 / user feedback 2026-07-02: a selected ghost used to be
  // invisible until the race screen mounted — now it shows in the ready
  // strip alongside the real riders, with a fixed AUTO chip (no rpm/penalty
  // compliance applies to it).
  it('shows a ghost rider with an AUTO chip instead of rpm/READY-WAIT', () => {
    const ghostRiders = [...riders, {
      id: 'ghost:20260701120000:user_3', name: 'User_3 👻', avatarSrc: '/api/v1/static/img/users/user_3',
      rpm: 0, compliant: true, isGhost: true
    }];
    const { getByTestId } = render(<RiderReadyStrip riders={ghostRiders} />);
    const ghost = getByTestId('ready-rider-ghost:20260701120000:user_3');
    expect(ghost.className).toContain('is-ghost');
    expect(getByTestId('ready-rider-auto-ghost:20260701120000:user_3').textContent).toBe('AUTO');
    expect(ghost.textContent).not.toContain('READY');
    expect(ghost.textContent).not.toContain('WAIT');
    expect(ghost.textContent).not.toContain('rpm');
  });
});
