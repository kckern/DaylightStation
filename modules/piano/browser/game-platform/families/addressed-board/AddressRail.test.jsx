import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import AddressRail from './AddressRail.jsx';

const addresses = [
  { midi: 60, label: 'C4', chord: 'C' },
  { midi: 62, label: 'D4', chord: 'D' },
  { midi: 64, label: 'E4', chord: 'E' },
];

describe('AddressRail', () => {
  it('renders one card per address, in the order given', () => {
    const { container } = render(<AddressRail addresses={addresses} />);
    expect(container.querySelectorAll('.address-rail__card')).toHaveLength(3);
  });

  it('defaults to staff notation — a drawn staff, never a typed note name', () => {
    // "Inline SVG never unicode glyphs": the default view must draw noteheads,
    // not print text, or the kiosk WebView renders the fallback as tofu.
    const { container } = render(<AddressRail addresses={addresses} />);
    expect(container.querySelectorAll('.address-rail__card svg').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/C4|D4|E4/);
  });

  it('prints chord spellings when notation is "chords"', () => {
    const { container } = render(<AddressRail addresses={addresses} notation="chords" />);
    expect(container.textContent).toContain('C');
    expect(container.textContent).toContain('D');
    expect(container.textContent).toContain('E');
    expect(container.querySelectorAll('.address-rail__card svg')).toHaveLength(0);
  });

  it('prints note names when notation is "names"', () => {
    const { container } = render(<AddressRail addresses={addresses} notation="names" />);
    expect(container.textContent).toContain('C4');
    expect(container.textContent).toContain('D4');
    expect(container.textContent).toContain('E4');
  });

  it('marks the active address, and only the active address', () => {
    const { container } = render(<AddressRail addresses={addresses} notation="names" active={1} />);
    const cards = container.querySelectorAll('.address-rail__card');
    expect(cards[0].className).not.toMatch(/--active/);
    expect(cards[1].className).toMatch(/--active/);
    expect(cards[2].className).not.toMatch(/--active/);
  });

  it('carries the orientation as a modifier class, horizontal by default', () => {
    const { container: horiz } = render(<AddressRail addresses={addresses} />);
    expect(horiz.querySelector('.address-rail--horizontal')).toBeTruthy();

    const { container: vert } = render(<AddressRail addresses={addresses} orientation="vertical" />);
    expect(vert.querySelector('.address-rail--vertical')).toBeTruthy();
    expect(vert.querySelector('.address-rail--horizontal')).toBeFalsy();
  });

  it('renders nothing but an empty rail when given no addresses, rather than throwing', () => {
    const { container } = render(<AddressRail addresses={[]} />);
    expect(container.querySelectorAll('.address-rail__card')).toHaveLength(0);
  });
});
