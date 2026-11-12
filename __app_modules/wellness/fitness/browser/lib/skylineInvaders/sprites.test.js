import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { INVADER_SPRITES, SPRITE_GRID, SPRITE_PIXEL } from './sprites.js';
import { THREATS } from './threats.js';
import { InvaderSprite } from '../../../../../learning/piano/browser/components/InvaderSprite.jsx';

const THREAT_TYPES = ['meteor', 'drone', 'pod', 'bomber'];
const PROPS = ['bomb', 'cannon', 'building', 'rubble'];

const cells = (grid) => grid.map((row) => Array.from(row).map((c) => (c === '.' || c === 0 ? 0 : 1)).join('')).join('/');
const mirror = (map) => map.split('/').map((row) => [...row].reverse().join('')).join('/');
const differingCells = (a, b) => [...a].filter((c, i) => c !== b[i]).length;
const filled = (map) => [...map].filter((c) => c === '1').length;

// The piano's grids are the classic arcade shapes. Read them through the
// component (they are not exported) so this test never copies them.
const classicFrames = () => [0, 1, 2].flatMap((variant) => [0, 1].map((frame) => {
  const { container } = render(React.createElement(InvaderSprite, { variant, frame }));
  const on = new Set([...container.querySelectorAll('rect')].map((r) => `${r.getAttribute('x')},${r.getAttribute('y')}`));
  return Array.from({ length: 8 }, (_, y) => Array.from({ length: 11 }, (_, x) => (on.has(`${x},${y}`) ? 1 : 0)).join('')).join('/');
}));

describe('Skyline Invaders sprites', () => {
  it('draws on an 11 x 8 grid at 4 scene units per art pixel', () => {
    expect(SPRITE_GRID).toEqual({ columns: 11, rows: 8 });
    expect(SPRITE_PIXEL).toBe(4);
  });

  // The scene stretches each sprite over its hitbox. A hitbox that is not a
  // whole number of art pixels would blur the grid and misplace the edges.
  it.each(THREAT_TYPES)('%s hitbox is a whole multiple of the 11 x 8 grid, with square pixels', (type) => {
    const { width, height } = THREATS[type];
    expect(width % SPRITE_GRID.columns).toBe(0);
    expect(height % SPRITE_GRID.rows).toBe(0);
    expect(width / SPRITE_GRID.columns).toBe(height / SPRITE_GRID.rows);
  });

  it('the bomb hitbox fits its own 4 x 5 grid at the shared art pixel', () => {
    const [frame] = INVADER_SPRITES.bomb.frames;
    expect(THREATS.bomb.width).toBe(frame[0].length * SPRITE_PIXEL);
    expect(THREATS.bomb.height).toBe(frame.length * SPRITE_PIXEL);
  });

  it.each(THREAT_TYPES)('%s has two 11x8 frames that differ', (type) => {
    const { frames } = INVADER_SPRITES[type];
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame).toHaveLength(SPRITE_GRID.rows);
      for (const row of frame) expect(row).toHaveLength(SPRITE_GRID.columns);
    }
    expect(cells(frames[0])).not.toBe(cells(frames[1]));
  });

  it.each(THREAT_TYPES)('%s keeps its outline between frames, so it animates rather than morphs', (type) => {
    const [a, b] = INVADER_SPRITES[type].frames.map(cells);
    const changed = differingCells(a, b);
    expect(changed).toBeGreaterThanOrEqual(2);
    expect(changed).toBeLessThanOrEqual(16);
  });

  it.each(THREAT_TYPES)('%s is solid enough to read from across the room', (type) => {
    for (const frame of INVADER_SPRITES[type].frames) expect(filled(cells(frame))).toBeGreaterThanOrEqual(28);
  });

  it('has art for the bomb, the cannon, a building and its rubble', () => {
    for (const key of PROPS) expect(INVADER_SPRITES[key].frames.length).toBeGreaterThanOrEqual(1);
    expect(INVADER_SPRITES.cannon.frames[0]).toHaveLength(8);
    expect(INVADER_SPRITES.cannon.frames[0][0]).toHaveLength(11);
  });

  it('draws the bomb 4 x 5, which is its 16 x 20 hitbox at SPRITE_PIXEL', () => {
    const [bomb] = INVADER_SPRITES.bomb.frames;
    expect([bomb[0].length * SPRITE_PIXEL, bomb.length * SPRITE_PIXEL]).toEqual([16, 20]);
  });

  it('draws rubble on the same 9 x 7 footprint as the building it replaces', () => {
    const size = (key) => [INVADER_SPRITES[key].frames[0][0].length, INVADER_SPRITES[key].frames[0].length];
    expect(size('building')).toEqual([9, 7]);
    expect(size('rubble')).toEqual([9, 7]);
  });

  it('stands buildings and rubble on the ground: the bottom row is full', () => {
    for (const key of ['building', 'rubble']) expect(INVADER_SPRITES[key].frames[0].at(-1)).toBe('#########');
  });

  it('uses only "#" and "." and rectangular frames', () => {
    for (const [key, { frames }] of Object.entries(INVADER_SPRITES)) {
      for (const frame of frames) {
        for (const row of frame) {
          expect(row, key).toMatch(/^[#.]+$/);
          expect(row.length, key).toBe(frame[0].length);
        }
      }
    }
  });

  it('is frozen all the way down', () => {
    expect(Object.isFrozen(INVADER_SPRITES)).toBe(true);
    for (const sprite of Object.values(INVADER_SPRITES)) {
      expect(Object.isFrozen(sprite)).toBe(true);
      expect(Object.isFrozen(sprite.frames)).toBe(true);
      for (const frame of sprite.frames) expect(Object.isFrozen(frame)).toBe(true);
    }
  });

  it('is original: no frame is a classic arcade grid, mirrored or not, nor a near copy of one', () => {
    const classic = classicFrames().flatMap((frame) => [frame, mirror(frame)]);
    expect(classic).toHaveLength(12);
    for (const key of [...THREAT_TYPES, 'cannon']) {
      for (const frame of INVADER_SPRITES[key].frames) {
        const map = cells(frame);
        for (const other of classic) expect(differingCells(map, other), key).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('gives each threat its own silhouette: any two differ in at least a quarter of the grid', () => {
    for (const a of THREAT_TYPES) {
      for (const b of THREAT_TYPES) {
        if (a >= b) continue;
        for (const fa of INVADER_SPRITES[a].frames) {
          for (const fb of INVADER_SPRITES[b].frames) expect(differingCells(cells(fa), cells(fb)), `${a} vs ${b}`).toBeGreaterThanOrEqual(22);
        }
      }
    }
  });
});
