import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InvaderSprite } from './InvaderSprite.jsx';

// Pins the piano invaders' markup. The grids are the piano's own; the drawing
// goes through the gaming capability's PixelSprite. These numbers were taken
// from the component before it switched renderers.
const cellMap = (variant, frame) => {
  const { container } = render(<InvaderSprite variant={variant} frame={frame} />);
  const on = new Set([...container.querySelectorAll('rect')].map((r) => `${r.getAttribute('x')},${r.getAttribute('y')}`));
  return Array.from({ length: 8 }, (_, y) => Array.from({ length: 11 }, (_, x) => (on.has(`${x},${y}`) ? '#' : '.')).join('')).join('/');
};

describe('InvaderSprite', () => {
  it('draws an 11x8 grid as unit rects tinted by currentColor', () => {
    const { container } = render(<InvaderSprite variant={0} frame={0} className="note" />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 11 8');
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toBe('invader-sprite note');
    expect(svg.querySelectorAll('rect')).toHaveLength(46);
    const rect = svg.querySelector('rect');
    expect([rect.getAttribute('width'), rect.getAttribute('height')]).toEqual(['1', '1']);
    expect(rect.getAttribute('fill')).toBeNull();
  });

  it('has no trailing space in the class when no className is given', () => {
    const { container } = render(<InvaderSprite />);
    expect(container.querySelector('svg').getAttribute('class')).toBe('invader-sprite');
  });

  it('wraps variant and frame', () => {
    expect(cellMap(3, 2)).toBe(cellMap(0, 0));
    expect(cellMap(1, 0)).not.toBe(cellMap(0, 0));
  });

  it('keeps every cell of all six frames where it was', () => {
    const all = [0, 1, 2].flatMap((variant) => [0, 1].map((frame) => cellMap(variant, frame)));
    expect(all).toMatchInlineSnapshot(`
      [
        "..#.....#../...#...#.../..#######../.##.###.##./###########/#.#######.#/#.#.....#.#/...##.##...",
        "..#.....#../#..#...#..#/#.#######.#/###.###.###/###########/.#########./..#.....#../.#.......#.",
        "....#....../...###...../..#####..../.##.#.##.../.#######.../...#.#...../..#...#..../.#.....#...",
        "....#....../...###...../..#####..../.##.#.##.../.#######.../..#...#..../...#.#...../...........",
        "...#####.../.#########./###########/###..#..###/###########/..##...##../.##.....##./##.......##",
        "...#####.../.#########./###########/###..#..###/###########/...##.##.../..##...##../.##.....##.",
      ]
    `);
  });
});
