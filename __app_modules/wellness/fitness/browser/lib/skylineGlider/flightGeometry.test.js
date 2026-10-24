import { describe, expect, it } from 'vitest';
import { blastTouches, entityAtPoint, terrainAtPoint } from "./flightGeometry.js";

const course = {
  segments: [
    { id: 'hill', type: 'lower-terrain', start_s: 2, end_s: 4, top: 0.6 },
    { id: 'roof', type: 'upper-terrain', start_s: 6, end_s: 8, bottom: 0.3 },
    { id: 'cp', type: 'checkpoint', start_s: 5 },
  ],
};
const tree = { id: 'tree', class: 'breakable', at_s: 10, altitude: 0.78, width_s: 0.5, height: 0.2 };

describe('point geometry', () => {
  it('finds the terrain segment that covers a point', () => {
    expect(terrainAtPoint(course, 3, 0.65)?.id).toBe('hill');
    expect(terrainAtPoint(course, 3, 0.55)).toBeNull();
    expect(terrainAtPoint(course, 7, 0.2)?.id).toBe('roof');
    expect(terrainAtPoint(course, 5, 0.99)).toBeNull();
  });

  it('finds an entity whose box holds a point', () => {
    expect(entityAtPoint([tree], 10.2, 0.7)).toBe(tree);
    expect(entityAtPoint([tree], 10.2, 0.5)).toBeNull();
    expect(entityAtPoint([tree], 11, 0.7)).toBeNull();
  });

  it('tests an entity against a blast box centred on the detonation', () => {
    const rules = { blast_width_s: 1.2, blast_height: 0.16 };
    expect(blastTouches(tree, { at_s: 10.7, altitude: 0.78 }, rules)).toBe(true);
    expect(blastTouches(tree, { at_s: 11.5, altitude: 0.78 }, rules)).toBe(false);
    expect(blastTouches(tree, { at_s: 10, altitude: 0.4 }, rules)).toBe(false);
  });
});
