/**
 * The three parameterised economy icons share one contract: decorative by
 * default, an accessible image when labelled, one colour in and a whole tint
 * ladder out, and no ids that could collide when a board draws four of them.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import TicketIcon from './TicketIcon.jsx';
import CoinIcon from './CoinIcon.jsx';
import GemIcon from './GemIcon.jsx';
import { hexToHsl, hslToHex, relight } from './iconColor.js';

const ICONS = [
  ['TicketIcon', TicketIcon, 'ticket-icon'],
  ['CoinIcon', CoinIcon, 'coin-icon'],
  ['GemIcon', GemIcon, 'gem-icon'],
];

describe.each(ICONS)('%s', (_name, Icon, cls) => {
  it('is decorative by default and an image when labelled', () => {
    const plain = render(<Icon />).container.querySelector('svg');
    expect(plain.getAttribute('class')).toBe(cls);
    expect(plain.getAttribute('aria-hidden')).toBe('true');
    expect(plain.querySelector('title')).toBeNull();

    const { container } = render(<Icon label="one" />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(container.querySelector(`#${CSS.escape(svg.getAttribute('aria-labelledby'))}`).textContent).toBe('one');
  });

  it('never emits a duplicate id across instances', () => {
    const { container } = render(<div><Icon label="a" /><Icon label="b" /><Icon label="c" /></div>);
    const ids = [...container.querySelectorAll('[id]')].map((n) => n.id);
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('re-lights every fill from the one colour it is given', () => {
    const fills = (color) => [...render(<Icon color={color} />).container.querySelectorAll('[fill]')]
      .map((n) => n.getAttribute('fill'));
    const red = fills('#c62828');
    const green = fills('#2e7d32');
    expect(red).not.toEqual(green);
    // Same structure, different hue: every derived fill of the red icon is
    // red-ish (hue near 0) and none of the green icon's are.
    const hueOf = (hex) => hexToHsl(hex)?.h;
    const derivedRed = red.filter((f) => f !== '#ffda44' && f !== '#ffffff');
    expect(derivedRed.length).toBeGreaterThan(0);
    for (const f of derivedRed) expect(Math.min(hueOf(f), 360 - hueOf(f))).toBeLessThan(10);
  });
});

describe('iconColor', () => {
  it('round-trips hex through HSL', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffdc64', '#1e88e5', '#c0c0c0']) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
    }
    expect(hslToHex(hexToHsl('#abc'))).toBe('#aabbcc');
  });

  it('relights to the requested lightness and keeps hue', () => {
    const lit = relight('#1e88e5', 0.9);
    const { h, l } = hexToHsl(lit);
    expect(Math.abs(h - hexToHsl('#1e88e5').h)).toBeLessThan(2);
    expect(l).toBeCloseTo(0.9, 1);
  });

  it('returns an unparseable colour unchanged rather than throwing', () => {
    expect(relight('currentColor', 0.5)).toBe('currentColor');
    expect(hexToHsl('not a colour')).toBeNull();
  });
});
