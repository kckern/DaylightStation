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
});
