import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CardIdenticon } from './CardIdenticon.jsx';
import { cardIdenticonCells, cardIdenticonHue } from './cardIdenticonModel.js';

describe('CardIdenticon', () => {
  it('is deterministic, symmetric, and distinct across card definitions', () => {
    const steady = cardIdenticonCells('card-game:g-major');
    expect(steady).toEqual(cardIdenticonCells('card-game:g-major'));
    for (const row of steady) expect(row).toEqual([...row].reverse());
    expect(steady).not.toEqual(cardIdenticonCells('card-game:f-major'));
    expect(cardIdenticonHue('card-game:g-major')).toBe(cardIdenticonHue('card-game:g-major'));
  });

  it('renders a decorative SVG with a stable seed contract', () => {
    const { container } = render(<CardIdenticon seed="card-game:g-major" />);
    const svg = container.querySelector('[data-card-identicon="card-game:g-major"]');
    expect(svg).toBeTruthy();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(0);
  });
});
