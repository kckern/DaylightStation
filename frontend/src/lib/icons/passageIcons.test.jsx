/** The tomato and the flower follow CoinIcon's conventions. */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import TomatoIcon from './TomatoIcon.jsx';
import FlowerIcon from './FlowerIcon.jsx';

const svgOf = (ui) => render(ui).container.querySelector('svg');

describe.each([
  ['TomatoIcon', TomatoIcon, '0 0 128 128', 'tomato-icon'],
  ['FlowerIcon', FlowerIcon, '0 0 511.844 511.844', 'flower-icon'],
])('%s', (_name, Icon, viewBox, className) => {
  it('is a decorative inline SVG at 1em by default', () => {
    const svg = svgOf(<Icon />);
    expect(svg.getAttribute('viewBox')).toBe(viewBox);
    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.classList.contains(className)).toBe(true);
    expect(svg.querySelectorAll('[id]')).toHaveLength(0);
    expect(svg.querySelectorAll('[style]')).toHaveLength(0);
  });
  it('takes a size and becomes a labelled image', () => {
    const svg = svgOf(<Icon size={48} label="Bars 1–5" className="extra" />);
    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('height')).toBe('48');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelector('title').textContent).toBe('Bars 1–5');
    expect(svg.getAttribute('aria-labelledby')).toBe(svg.querySelector('title').id);
    expect(svg.classList.contains('extra')).toBe(true);
  });
});

describe('FlowerIcon shading', () => {
  it('keeps the one built-in 10% shading path', () => {
    expect(svgOf(<FlowerIcon />).querySelectorAll('[opacity="0.1"]')).toHaveLength(1);
  });
});
