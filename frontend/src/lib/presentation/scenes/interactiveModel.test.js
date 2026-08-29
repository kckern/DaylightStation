import { describe, expect, it } from 'vitest';
import { actorPlaybackInfo, clipDurationMs, clipFrameAtTime, findWalkableSpawn, moveActor, nearestInteractive } from './interactiveModel.js';

describe('interactive presentation model', () => {
  it('advances loop, one-shot, and ping-pong clips deterministically', () => {
    expect(clipFrameAtTime({ frames: ['a', 'b'], fps: 2, loop: 'loop' }, 500)).toBe('b');
    expect(clipFrameAtTime({ frames: ['a', 'b'], fps: 2, loop: 'once' }, 5000)).toBe('b');
    expect(clipFrameAtTime({ frames: ['a', 'b', 'c'], fps: 1, loop: 'ping-pong' }, 3000)).toBe('b');
    expect(clipFrameAtTime({ frames: ['a', 'b'], fps: 8, loop: 'loop' }, 500, { reducedMotion: true })).toBe('a');
  });

  it('honors authored per-frame timing and reports one-shot duration', () => {
    const clip = { frames: [{ frame: 'a', duration_ms: 80 }, { frame: 'b', duration_ms: 220 }], loop: 'once' };
    expect(clipFrameAtTime(clip, 79)).toBe('a');
    expect(clipFrameAtTime(clip, 80)).toBe('b');
    expect(clipFrameAtTime(clip, 999)).toBe('b');
    expect(clipDurationMs(clip)).toBe(300);
  });

  it('exposes metadata-driven completion for actor one-shots', () => {
    const catalog = { assets: { hero: {
      frames: { idle: {}, windup: {}, strike: {} },
      clips: { idle: { frames: ['idle'], fps: 1, loop: 'loop' }, attack: { frames: ['windup', 'strike'], fps: 8, loop: 'once' } },
      animation: { mode: 'state-machine', default_state: 'idle', states: { idle: { motion: 'stationary', clip: 'idle' }, attack: { motion: 'in-place', clip: 'attack', return_to: 'idle' } } },
    } } };
    expect(actorPlaybackInfo(catalog, { kind: 'asset', asset: 'hero' }, { state: 'attack' })).toEqual(expect.objectContaining({ once: true, durationMs: 250, returnTo: 'idle', terminal: false }));
  });

  it('spawns and moves only through the compiler-owned navigation grid', () => {
    const plan = { logical_size: [48, 32], grid: { cell: [16, 16], columns: 3, rows: 2 }, navigation_grid: [[false, false, false], [true, true, false]] };
    expect(findWalkableSpawn(plan)).toEqual([24, 32]);
    expect(moveActor(plan, [24, 32], [20, 0])).toEqual([24, 32]);
    expect(moveActor(plan, [24, 32], [-8, 0])).toEqual([16, 32]);
  });

  it('selects the nearest in-range semantic interaction target', () => {
    const items = [{ key: 'far', command: { at: [50, 50] } }, { key: 'near', command: { at: [12, 10] } }];
    expect(nearestInteractive(items, [10, 10], 20).key).toBe('near');
    expect(nearestInteractive(items, [0, 0], 5)).toBeNull();
  });
});
