import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THEME,
  frameToPosition,
  resolveTheme,
  getSpriteFrame,
} from './sideScrollerTheme.js';

// ─── frameToPosition ────────────────────────────────────────────

describe('frameToPosition', () => {
  const grid = { cols: 5, rows: 6 };

  it('maps top-left cell to 0% 0%', () => {
    expect(frameToPosition([0, 0], grid)).toBe('0% 0%');
  });

  it('maps last column to 100% horizontally', () => {
    expect(frameToPosition([4, 0], grid)).toBe('100% 0%');
  });

  it('computes interior cell as col/(cols-1) and row/(rows-1)', () => {
    // col 2 of 5 → 50%, row 3 of 6 → 60%
    expect(frameToPosition([2, 3], grid)).toBe('50% 60%');
  });

  it('guards single-cell grids against divide-by-zero', () => {
    expect(frameToPosition([0, 0], { cols: 1, rows: 1 })).toBe('0% 0%');
  });
});

// ─── resolveTheme ───────────────────────────────────────────────

describe('resolveTheme', () => {
  it('returns the default theme when no config given', () => {
    expect(resolveTheme(undefined)).toEqual(DEFAULT_THEME);
    expect(resolveTheme({})).toEqual(DEFAULT_THEME);
  });

  it('default sounds are all null', () => {
    const sounds = resolveTheme().sounds;
    expect(Object.values(sounds).every((v) => v === null)).toBe(true);
  });

  it('overrides only the provided player sub-keys, keeping defaults', () => {
    const t = resolveTheme({ theme: { player: { src: '/sonic.png' } } });
    expect(t.player.src).toBe('/sonic.png');
    // grid + frames fall back to defaults
    expect(t.player.grid).toEqual(DEFAULT_THEME.player.grid);
    expect(t.player.frames).toEqual(DEFAULT_THEME.player.frames);
    // other pieces untouched
    expect(t.obstacles).toEqual(DEFAULT_THEME.obstacles);
  });

  it('merges configured sound paths over null defaults', () => {
    const t = resolveTheme({ theme: { sounds: { jump: '/jump.wav' } } });
    expect(t.sounds.jump).toBe('/jump.wav');
    expect(t.sounds.hit).toBe(null);
  });
});

// ─── getSpriteFrame ─────────────────────────────────────────────

describe('getSpriteFrame', () => {
  const theme = DEFAULT_THEME;
  const pos = (cell) => frameToPosition(cell, theme.player.grid);

  it('returns the stand pose when idle', () => {
    expect(getSpriteFrame('running', 0, { idle: true }, theme)).toBe(pos(theme.player.frames.stand));
  });

  it('returns the hit pose when invincible', () => {
    expect(getSpriteFrame('running', 0, { invincible: true }, theme)).toBe(pos(theme.player.frames.hit));
  });

  it('returns the jump pose while jumping', () => {
    expect(getSpriteFrame('jumping', 0, {}, theme)).toBe(pos(theme.player.frames.jump));
  });

  it('returns the duck pose while ducking', () => {
    expect(getSpriteFrame('ducking', 0, {}, theme)).toBe(pos(theme.player.frames.duck));
  });

  it('cycles run frames by world position using the run-cycle length', () => {
    const run = theme.player.frames.run;
    expect(getSpriteFrame('running', 0, {}, theme)).toBe(pos(run[0]));
    // worldPos 2/32 → floor(2 % run.length) → index 2
    expect(getSpriteFrame('running', 2 / 32, {}, theme)).toBe(pos(run[2]));
  });
});
