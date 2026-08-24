import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CardIdenticon } from './CardIdenticon.jsx';
import { cardIdenticonCells, cardIdenticonHue } from './cardIdenticonModel.js';

describe('CardIdenticon', () => {
  it('is deterministic, symmetric, and distinct across card definitions', () => {
    const steady = cardIdenticonCells('arena:alpha');
    expect(steady).toEqual(cardIdenticonCells('arena:alpha'));
    for (const row of steady) expect(row).toEqual([...row].reverse());
    expect(steady).not.toEqual(cardIdenticonCells('arena:beta'));
    expect(cardIdenticonHue('arena:alpha')).toBe(cardIdenticonHue('arena:alpha'));
  });

  it('renders a decorative SVG with a stable seed contract', () => {
    const { container } = render(<CardIdenticon seed="arena:alpha" />);
    const svg = container.querySelector('[data-card-identicon="arena:alpha"]');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(0);
  });
});
