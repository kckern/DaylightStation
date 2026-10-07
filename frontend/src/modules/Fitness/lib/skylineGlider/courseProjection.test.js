import { describe, expect, it } from 'vitest';
import { projectCourseWindow } from './courseProjection.js';

const course = {
  duration_s: 300,
  segments: [
    { id: 'hill', type: 'lower-terrain', start_s: 10, end_s: 20, top: 0.6 },
    { id: 'cave', type: 'corridor', start_s: 24, end_s: 30, ceiling: 0.3, floor: 0.65 },
    { id: 'bells', type: 'collectible-path', start_s: 8, end_s: 26, collectibles: [
      { id: 'bell-a', at_s: 12, altitude: 0.5 },
      { id: 'bell-b', at_s: 25, altitude: 0.4 },
    ] },
    { id: 'finish', type: 'finish', start_s: 300 },
  ],
};

describe('course projection', () => {
  it('moves authored obstacles left by one viewport over fourteen seconds', () => {
    const atZero = projectCourseWindow(course, 0);
    const atFourteen = projectCourseWindow(course, 14);

    expect(atZero.segments.find((item) => item.id === 'hill')).toMatchObject({ x: 714.29, width: 714.29 });
    expect(atFourteen.segments.find((item) => item.id === 'hill')).toMatchObject({ x: -285.71, width: 714.29 });
  });

  it('projects collectibles at their authored time and altitude', () => {
    const projected = projectCourseWindow(course, 2);

    expect(projected.collectibles).toContainEqual({ id: 'bell-a', x: 714.29, y: 300, altitude: 0.5 });
    expect(projected.collectibles.some((item) => item.id === 'bell-b')).toBe(false);
  });

  it('clips geometry outside the small behind and preview margins', () => {
    const projected = projectCourseWindow(course, 40);

    expect(projected.segments).toEqual([]);
    expect(projected.collectibles).toEqual([]);
  });
});
