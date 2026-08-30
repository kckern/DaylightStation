import { describe, it, expect } from 'vitest';
import { TEAM_COLORS, onColor } from './teamColors.js';

describe('teamColors', () => {
  it('palette has six colors and reserves gold for the UI accent', () => {
    expect(TEAM_COLORS).toHaveLength(6);
    expect(TEAM_COLORS).not.toContain('#e6b325'); // Brass is reserved for the shared accent.
  });

  it('dark team colors get paper text', () => {
    expect(onColor('#3273dc')).toBe('#fff8ea');
    expect(onColor('#9b5de5')).toBe('#fff8ea');
    expect(onColor('#c2559f')).toBe('#fff8ea');
  });

  it('light team colors get dark ink', () => {
    expect(onColor('#2fbf71')).toBe('#191b2e');
    expect(onColor('#f28c28')).toBe('#191b2e');
    expect(onColor('#e6b325')).toBe('#191b2e'); // mounted preset gold
  });

  it('garbage input falls back to paper', () => {
    expect(onColor(undefined)).toBe('#fff8ea');
    expect(onColor('blue')).toBe('#fff8ea');
  });
});
