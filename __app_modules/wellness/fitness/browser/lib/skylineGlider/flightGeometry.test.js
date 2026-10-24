import { describe, expect, it } from 'vitest';
import { blastTouches, entityAtPoint, firstHitAlong, terrainAtPoint } from "./flightGeometry.js";

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

  it('finds the nearest entity or terrain along a sweep', () => {
    expect(firstHitAlong([tree], course, 9, 10, 0.7)).toMatchObject({ entity: tree, at: 9.75 });
    expect(firstHitAlong([tree], course, 9, 9.7, 0.7)).toBeNull();
    expect(firstHitAlong([tree], course, 1, 12, 0.65)).toMatchObject({ segment: { id: 'hill' }, at: 2 });
    expect(firstHitAlong([], { segments: [{ id: 'wall', type: 'lower-terrain', start_s: 5, top: 0.5 }] }, 4.9, 5.1, 0.6)?.segment.id).toBe('wall');
  });

  it('tests an entity against a blast box centred on the detonation', () => {
    const rules = { blast_width_s: 1.2, blast_height: 0.16 };
    expect(blastTouches(tree, { at_s: 10.7, altitude: 0.78 }, rules)).toBe(true);
    expect(blastTouches(tree, { at_s: 11.5, altitude: 0.78 }, rules)).toBe(false);
    expect(blastTouches(tree, { at_s: 10, altitude: 0.4 }, rules)).toBe(false);
  });
});
