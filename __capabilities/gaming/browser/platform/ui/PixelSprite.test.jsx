import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PixelSprite, { pixelRects } from './PixelSprite.jsx';

const grid = [[0, 1, 1], [1, 0, 2]];

describe('pixelRects', () => {
  it('lists one unit cell per filled cell, row by row', () => {
    expect(pixelRects(grid)).toEqual([
      { x: 1, y: 0, value: 1 }, { x: 2, y: 0, value: 1 },
      { x: 0, y: 1, value: 1 }, { x: 2, y: 1, value: 2 },
    ]);
  });

  it('accepts string rows, where "." and " " are empty', () => {
    expect(pixelRects(['.#', '# '])).toEqual([{ x: 1, y: 0, value: '#' }, { x: 0, y: 1, value: '#' }]);
  });

  it('treats a missing grid and missing cells as empty', () => {
    expect(pixelRects()).toEqual([]);
    expect(pixelRects(null)).toEqual([]);
    expect(pixelRects([[null, undefined, 1]])).toEqual([{ x: 2, y: 0, value: 1 }]);
  });
});

describe('PixelSprite', () => {
  it('renders a standalone svg sized by the grid', () => {
    const { container } = render(<PixelSprite grid={grid} className="x" />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 3 2');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toBe('x');
    expect(svg.querySelectorAll('rect')).toHaveLength(4);
  });

  it('draws each cell as a 1x1 rect that inherits the svg fill', () => {
    const { container } = render(<PixelSprite grid={[[0, 1]]} />);
    const rect = container.querySelector('rect');
    expect(['x', 'y', 'width', 'height'].map((name) => rect.getAttribute(name))).toEqual(['1', '0', '1', '1']);
    expect(rect.getAttribute('fill')).toBeNull();
  });

  it('sizes the viewBox by the longest row of a ragged grid', () => {
    const { container } = render(<PixelSprite grid={['#', '###', '##']} />);
    expect(container.querySelector('svg').getAttribute('viewBox')).toBe('0 0 3 3');
  });

  it('can be placed inside a parent svg, and can colour cells by value', () => {
    const { container } = render(<svg><PixelSprite grid={grid} x={10} y={20} width={30} height={20} palette={{ 2: '#f00' }} /></svg>);
    const inner = container.querySelector('svg svg');
    expect(['x', 'y', 'width', 'height'].map((name) => inner.getAttribute(name))).toEqual(['10', '20', '30', '20']);
    expect(inner.querySelectorAll('rect[fill="#f00"]')).toHaveLength(1);
    expect(inner.querySelectorAll('rect:not([fill])')).toHaveLength(3);
  });

  it('passes other props through to the svg', () => {
    const { container } = render(<PixelSprite grid={grid} data-threat="drone" />);
    expect(container.querySelector('svg').getAttribute('data-threat')).toBe('drone');
  });

  it('leaves the class attribute off when no className is given', () => {
    const { container } = render(<PixelSprite grid={grid} />);
    expect(container.querySelector('svg').hasAttribute('class')).toBe(false);
  });

  it('renders nothing for an empty or missing grid', () => {
    expect(render(<PixelSprite grid={[]} />).container.firstChild).toBeNull();
    expect(render(<PixelSprite />).container.firstChild).toBeNull();
    expect(render(<PixelSprite grid={['', '']} />).container.firstChild).toBeNull();
  });
});
