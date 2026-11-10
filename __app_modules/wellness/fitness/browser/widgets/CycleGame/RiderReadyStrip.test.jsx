import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RiderReadyStrip from "./RiderReadyStrip.jsx";

const riders = [
  { id: 'user_3', name: 'User_3', avatarSrc: '/api/v1/static/img/users/user_3', rpm: 0, sensorLive: true },
  { id: 'user_2', name: 'User_2', avatarSrc: '/api/v1/static/img/users/user_2', rpm: 14, sensorLive: true }
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

  it('shows READY for a rider whose sensor is reporting', () => {
    const { getByTestId } = render(<RiderReadyStrip riders={riders} />);
    const user_3 = getByTestId('ready-rider-user_3');
    expect(user_3.textContent).toContain('READY');
    expect(user_3.className).toContain('is-ready');
  });

  // Rolling start: pedalling before green counts for nothing, but is allowed.
  it('never tells a pedalling rider to wait', () => {
    const { getByTestId, queryByText } = render(<RiderReadyStrip riders={riders} />);
    const user_2 = getByTestId('ready-rider-user_2');
    expect(user_2.textContent).toContain('READY');
    expect(user_2.textContent).not.toContain('WAIT');
    expect(user_2.className).not.toContain('is-violating');
    expect(queryByText('WAIT')).toBeNull();
  });

  it('flags a bike whose sensor is not reporting with NO SIGNAL (word, icon, amber class)', () => {
    const { getByTestId } = render(
      <RiderReadyStrip riders={[{ id: 'a', name: 'A', rpm: 0, sensorLive: false }]} />
    );
    const chip = getByTestId('ready-rider-a');
    expect(chip.textContent).toContain('NO SIGNAL');
    expect(chip.textContent).toContain('⚠');
    expect(chip.textContent).not.toContain('READY');
    expect(chip.className).toContain('is-no-signal');
  });

  it('renders nothing when there are no riders', () => {
    const { container } = render(<RiderReadyStrip riders={[]} />);
    expect(container.querySelector('.cg-ready-strip')).toBeNull();
  });

  // audit C6 / user feedback 2026-07-02: a selected ghost shows in the ready
  // strip alongside the real riders, with a fixed AUTO chip (it has no sensor).
  it('shows a ghost rider with an AUTO chip instead of rpm/READY', () => {
    const ghostRiders = [...riders, {
      id: 'ghost:20260701120000:user_3', name: 'User_3 👻', avatarSrc: '/api/v1/static/img/users/user_3',
      rpm: 0, isGhost: true
    }];
    const { getByTestId } = render(<RiderReadyStrip riders={ghostRiders} />);
    const ghost = getByTestId('ready-rider-ghost:20260701120000:user_3');
    expect(ghost.className).toContain('is-ghost');
    expect(getByTestId('ready-rider-auto-ghost:20260701120000:user_3').textContent).toBe('AUTO');
    expect(ghost.textContent).not.toContain('READY');
    expect(ghost.textContent).not.toContain('NO SIGNAL');
    expect(ghost.textContent).not.toContain('rpm');
  });

  // The strapless handicap is known before the race: a live rider with no
  // heart rate reads "No strap · ×0.8" under their name.
  it('shows the strapless handicap under a live rider with no heart rate', () => {
    const strapless = [
      { id: 'user_1', name: 'User_1', rpm: 0, sensorLive: true, heartRate: 140 },
      { id: 'user_2', name: 'User_2', rpm: 0, sensorLive: true, heartRate: null, noStrapMultiplier: 0.8 },
      { id: 'ghost:par:par', name: 'Par', rpm: 0, isGhost: true, noStrapMultiplier: 0.8 }
    ];
    const { getByTestId, queryByTestId } = render(<RiderReadyStrip riders={strapless} />);
    expect(getByTestId('ready-rider-strap-user_2').textContent).toBe('No strap · ×0.8');
    expect(queryByTestId('ready-rider-strap-user_1')).toBeNull();
    expect(queryByTestId('ready-rider-strap-ghost:par:par')).toBeNull();
  });
});
