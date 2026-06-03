import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RiderReadyStrip from './RiderReadyStrip.jsx';

const riders = [
  { id: 'milo', name: 'Milo', avatarSrc: '/api/v1/static/img/users/milo', rpm: 0, compliant: true },
  { id: 'felix', name: 'Felix', avatarSrc: '/api/v1/static/img/users/felix', rpm: 14, compliant: false }
];

describe('RiderReadyStrip', () => {
  it('renders a chip per on-board rider with name + RPM', () => {
    const { getByTestId } = render(<RiderReadyStrip riders={riders} />);
    const milo = getByTestId('ready-rider-milo');
    const felix = getByTestId('ready-rider-felix');
    expect(milo.textContent).toContain('Milo');
    expect(milo.textContent).toContain('0');
    expect(felix.textContent).toContain('14');
  });

  it('shows READY for a compliant (not pedaling) rider', () => {
    const { getByTestId } = render(<RiderReadyStrip riders={riders} />);
    const milo = getByTestId('ready-rider-milo');
    expect(milo.textContent).toContain('READY');
    expect(milo.className).toContain('is-compliant');
  });

  it('shows WAIT for a non-compliant (pedaling) rider', () => {
    const { getByTestId } = render(<RiderReadyStrip riders={riders} />);
    const felix = getByTestId('ready-rider-felix');
    expect(felix.textContent).toContain('WAIT');
    expect(felix.className).toContain('is-violating');
  });

  it('renders nothing when there are no riders', () => {
    const { container } = render(<RiderReadyStrip riders={[]} />);
    expect(container.querySelector('.cg-ready-strip')).toBeNull();
  });
});
