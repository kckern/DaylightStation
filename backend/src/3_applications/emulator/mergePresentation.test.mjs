import { describe, it, expect } from 'vitest';
import { mergePresentation } from './mergePresentation.mjs';

const system = {
  screen: { x: 29, y: 10, width: 41, height: 66 },
  shader: 'dotmatrix',
  chrome: 'gb-bezel',
  hotspots: [
    { id: 'speaker', action: 'volume', region: { x: 79, y: 64, width: 12, height: 22 } },
    { id: 'logo', action: 'exit', region: { x: 20, y: 88, width: 32, height: 5 } },
  ],
  overlays: [{ id: 'hr', source: 'fitness.heart_rate', format: 'bpm', region: { x: 15, y: 43, width: 12, height: 16 } }],
};

describe('mergePresentation', () => {
  it('returns the system presentation untouched when the game has none', () => {
    expect(mergePresentation(system, undefined)).toEqual(system);
    expect(mergePresentation(system, {})).toEqual(system);
  });

  it('lets the game override scalar presentation fields', () => {
    const merged = mergePresentation(system, { shader: 'lcd', screen: { x: 30 } });
    expect(merged.shader).toBe('lcd');
    expect(merged.screen).toEqual({ x: 30 });
    expect(merged.chrome).toBe('gb-bezel'); // untouched
  });

  it('merges hotspots by id: overrides matches, appends new, keeps the rest', () => {
    const merged = mergePresentation(system, {
      hotspots: [
        { id: 'speaker', action: 'mute' }, // override action, keep region
        { id: 'custom', do: { toast: 'hi' }, region: { x: 1, y: 1, width: 2, height: 2 } },
      ],
    });
    const byId = Object.fromEntries(merged.hotspots.map((h) => [h.id, h]));
    expect(byId.speaker.action).toBe('mute');
    expect(byId.speaker.region).toEqual({ x: 79, y: 64, width: 12, height: 22 }); // preserved
    expect(byId.logo).toBeTruthy(); // untouched system hotspot kept
    expect(byId.custom.do).toEqual({ toast: 'hi' }); // new appended
    expect(merged.hotspots.length).toBe(3);
  });

  it('merges overlays by id the same way', () => {
    const merged = mergePresentation(system, {
      overlays: [{ id: 'badges', source: 'state.badges', format: 'badge_meter', region: { x: 71, y: 33, width: 12, height: 10 } }],
    });
    expect(merged.overlays.map((o) => o.id).sort()).toEqual(['badges', 'hr']);
  });

  it('deep-merges a region when the override supplies a partial one', () => {
    const merged = mergePresentation(system, { hotspots: [{ id: 'speaker', region: { y: 70 } }] });
    const speaker = merged.hotspots.find((h) => h.id === 'speaker');
    expect(speaker.region).toEqual({ x: 79, y: 70, width: 12, height: 22 });
  });

  it('handles an absent system presentation', () => {
    expect(mergePresentation(undefined, { shader: 'lcd' })).toEqual({ shader: 'lcd' });
    expect(mergePresentation(undefined, undefined)).toEqual({});
  });
});
