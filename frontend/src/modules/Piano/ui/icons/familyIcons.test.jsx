import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Icon from './Icon.jsx';

const NAMES = ['family-keys', 'family-guitar', 'family-strings', 'family-winds', 'family-synths', 'family-world', 'family-fun', 'star'];

describe('family icons', () => {
  it.each(NAMES)('%s resolves to an inline SVG sized 1em in currentColor', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('.piano-icon svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.getAttribute('height')).toBe('1em');
    expect(container.innerHTML).toMatch(/currentColor/);
  });
});
