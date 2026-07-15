import { describe, it, expect } from 'vitest';
import { TEAM_COLORS, onColor } from './teamColors.js';

describe('teamColors', () => {
  it('palette has six colors and reserves gold for the UI accent', () => {
    expect(TEAM_COLORS).toHaveLength(6);
    expect(TEAM_COLORS).not.toContain('#e6b325'); // old team-1 gold collided with the brass accent
  });

  it('dark team colors get paper text', () => {
    expect(onColor('#3273dc')).toBe('#f3efe2');
    expect(onColor('#9b5de5')).toBe('#f3efe2');
    expect(onColor('#c2559f')).toBe('#f3efe2');
  });

  it('light team colors get dark ink', () => {
    expect(onColor('#2fbf71')).toBe('#10131f');
    expect(onColor('#f28c28')).toBe('#10131f');
    expect(onColor('#e6b325')).toBe('#10131f'); // legacy preset gold still in data-volume presets
  });

  it('garbage input falls back to paper', () => {
    expect(onColor(undefined)).toBe('#f3efe2');
    expect(onColor('blue')).toBe('#f3efe2');
  });
});
