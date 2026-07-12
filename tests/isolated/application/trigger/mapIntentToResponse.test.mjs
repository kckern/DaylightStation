import { describe, it, expect } from 'vitest';
import { mapIntentToResponse, UnknownActionError } from '#apps/trigger/mapIntentToResponse.mjs';

describe('mapIntentToResponse', () => {
  it('maps queue/play/play-next to content with expression', () => {
    const r = mapIntentToResponse({ action: 'queue', target: 'livingroom-tv', content: 'plex:456598', params: { shuffle: 1 } });
    expect(r).toMatchObject({ kind: 'content', target: 'livingroom-tv', posture: 'authoritative' });
    expect(r.expression).toEqual({ action: 'queue', contentId: 'plex:456598', options: { shuffle: 1 } });
  });

  it('carries end behavior onto content', () => {
    const r = mapIntentToResponse({ action: 'play-next', target: 't', content: 'plex:1', params: {}, end: 'tv-off', endLocation: 'living_room' });
    expect(r.end).toBe('tv-off');
    expect(r.endLocation).toBe('living_room');
  });

  it('maps open/clear to device', () => {
    expect(mapIntentToResponse({ action: 'open', target: 'office-tv', params: { path: '/videocall', room: 'x' } }))
      .toEqual({ kind: 'device', target: 'office-tv', op: 'open', path: '/videocall', params: { room: 'x' } });
    expect(mapIntentToResponse({ action: 'clear', target: 'office-tv', params: {} }))
      .toEqual({ kind: 'device', target: 'office-tv', op: 'clear', path: undefined, params: {} });
  });

  it('maps scene and ha-service to ha', () => {
    expect(mapIntentToResponse({ action: 'scene', scene: 'scene.movie' })).toEqual({ kind: 'ha', op: 'scene', scene: 'scene.movie', service: undefined, entity: undefined, data: undefined });
    expect(mapIntentToResponse({ action: 'ha-service', service: 'light.turn_on', entity: 'light.x', data: { brightness: 5 } }))
      .toEqual({ kind: 'ha', op: 'service', scene: undefined, service: 'light.turn_on', entity: 'light.x', data: { brightness: 5 } });
  });

  it('returns null for null intent and throws for unknown action', () => {
    expect(mapIntentToResponse(null)).toBeNull();
    expect(() => mapIntentToResponse({ action: 'nope', target: 't' })).toThrow(UnknownActionError);
  });
});
