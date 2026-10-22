import { describe, expect, it } from 'vitest';
import { DENSITIES, densityClassName, pickDensity } from './riderListDensity.js';

// jsdom has no layout: content height follows the grid's card-size class.
function list({ room, heights }) {
  const container = document.createElement('div');
  const content = document.createElement('div');
  const grid = document.createElement('div');
  grid.className = 'device-grid layout-horiz';
  const card = document.createElement('div');
  card.className = 'fitness-device card-horizontal';
  grid.appendChild(card);
  content.appendChild(grid);
  container.appendChild(content);
  Object.defineProperty(container, 'clientHeight', { get: () => room });
  Object.defineProperty(content, 'scrollHeight', {
    get: () => heights[DENSITIES.find((d) => densityClassName(d) && grid.classList.contains(densityClassName(d))) || 'regular'],
  });
  return { container, content, grid, card };
}

const heights = { roomy: 680, comfortable: 580, regular: 530, compact: 359 };

describe('rider list density', () => {
  it('picks the largest card size that fits the room', () => {
    expect(pickDensity(...Object.values(list({ room: 700, heights })).slice(0, 2))).toBe('roomy');
    expect(pickDensity(...Object.values(list({ room: 600, heights })).slice(0, 2))).toBe('comfortable');
    expect(pickDensity(...Object.values(list({ room: 530, heights })).slice(0, 2))).toBe('regular');
    expect(pickDensity(...Object.values(list({ room: 400, heights })).slice(0, 2))).toBe('compact');
  });

  it('falls back to compact when nothing fits; the list then scrolls', () => {
    expect(pickDensity(...Object.values(list({ room: 200, heights })).slice(0, 2))).toBe('compact');
  });

  it('leaves the DOM as it found it', () => {
    const l = list({ room: 400, heights });
    l.grid.classList.add('horiz-scale-130');
    pickDensity(l.container, l.content);
    expect(l.grid.className).toBe('device-grid layout-horiz horiz-scale-130');
    expect(l.card.classList.contains('card-compact')).toBe(false);
  });

  it('maps each density to the card-size class the sidebar styles', () => {
    expect(densityClassName('roomy')).toBe('horiz-scale-150');
    expect(densityClassName('comfortable')).toBe('horiz-scale-130');
    expect(densityClassName('regular')).toBe('');
    expect(densityClassName('compact')).toBe('density-compact');
  });
});
