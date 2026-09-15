import { describe, expect, it } from 'vitest';
import { SECRET_TEXT_MOTION_X, SECRET_TEXT_MOTION_Y, generateSecretTextMotion } from './segmentedSecretMotion.js';

describe('generateSecretTextMotion', () => {
  it('jumps to the opposite horizontal edge on every frame', () => {
    const frames = generateSecretTextMotion('MOON WALK');
    expect(frames).toHaveLength(8);
    frames.forEach((frame, index) => {
      expect(Math.abs(frame.x)).toBe(SECRET_TEXT_MOTION_X);
      const next = frames[(index + 1) % frames.length];
      expect(Math.sign(next.x)).toBe(-Math.sign(frame.x));
    });
  });

  it('keeps every vertical offset inside the card margin', () => {
    for (const frame of generateSecretTextMotion('BUILDING A SAND CASTLE', 32)) {
      expect(Math.abs(frame.y)).toBeLessThanOrEqual(SECRET_TEXT_MOTION_Y);
    }
  });

  it('moves the same clue the same way, and a different clue a different way', () => {
    expect(generateSecretTextMotion('CAT')).toEqual(generateSecretTextMotion('CAT'));
    expect(generateSecretTextMotion('CAT').map(frame => frame.y))
      .not.toEqual(generateSecretTextMotion('BOX').map(frame => frame.y));
  });

  it('always has at least two frames to alternate between', () => {
    expect(generateSecretTextMotion('A', 1)).toHaveLength(2);
  });
});
