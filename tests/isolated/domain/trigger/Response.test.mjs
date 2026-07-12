import { describe, it, expect } from 'vitest';
import { Response } from '#domains/trigger/Response.mjs';

describe('Response', () => {
  it('content defaults posture to authoritative', () => {
    const r = Response.content({ target: 'livingroom-tv', expression: { action: 'queue', contentId: 'plex:1', options: { shuffle: true } } });
    expect(r.kind).toBe('content');
    expect(r.target).toBe('livingroom-tv');
    expect(r.posture).toBe('authoritative');
    expect(r.expression).toEqual({ action: 'queue', contentId: 'plex:1', options: { shuffle: true } });
  });

  it('content preserves explicit posture + end behavior', () => {
    const r = Response.content({ target: 't', expression: { action: 'play', contentId: 'plex:2', options: {} }, posture: 'optimistic', end: 'tv-off', endLocation: 'living_room' });
    expect(r.posture).toBe('optimistic');
    expect(r.end).toBe('tv-off');
    expect(r.endLocation).toBe('living_room');
  });

  it('device requires a valid op', () => {
    expect(Response.device({ target: 't', op: 'open', path: '/x' }).kind).toBe('device');
    expect(() => Response.device({ target: 't', op: 'frobnicate' })).toThrow();
  });

  it('ha carries op-specific fields and is frozen', () => {
    const r = Response.ha({ op: 'scene', scene: 'scene.movie' });
    expect(r).toEqual({ kind: 'ha', op: 'scene', scene: 'scene.movie', service: undefined, entity: undefined, data: undefined });
    expect(() => { r.op = 'service'; }).toThrow();
  });
});
