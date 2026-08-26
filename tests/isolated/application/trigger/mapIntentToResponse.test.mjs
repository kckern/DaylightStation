import { describe, it, expect } from 'vitest';
import { mapIntentToResponse, UnknownActionError } from '#apps/trigger/mapIntentToResponse.mjs';
// Domain import in an APPLICATION test, in the legal direction: the pair below
// pins the resolver's real learner intent against this mapper, so the two
// cannot drift apart on the one field (`location`) neither test would miss.
import { NfcResolver } from '#domains/trigger/services/NfcResolver.mjs';

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

  // The interceptor seam scopes itself by reader. The location has to survive
  // the whole way from the resolver to the response or a book tap arrives with
  // no room attached and nothing can claim it.
  it('carries the reader location onto content', () => {
    const r = mapIntentToResponse({ action: 'play-next', target: 'livingroom-tv', location: 'livingroom', content: 'plex:1', params: {} });
    expect(r.location).toBe('livingroom');
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

  it('maps script action to a script Response', () => {
    expect(mapIntentToResponse({ action: 'script', endpoint: 'bedtime', params: { a: 1 } }))
      .toEqual({ kind: 'script', ref: 'bedtime', params: { a: 1 } });
  });
});

// Learner cards are discriminated by the PAYLOAD, not by an action allow-list.
// A new learner action must be a config key plus a registered handler; if it
// had to be enumerated here, the mapper would be the file every future reader
// behaviour has to pass through.
describe('mapIntentToResponse — learner cards', () => {
  it('maps any intent carrying a learnerId to a learner Response', () => {
    const r = mapIntentToResponse({ action: 'print-agenda', learnerId: 'learner-b', target: 'portal', location: 'study', params: {} });
    expect(r).toMatchObject({ kind: 'learner', op: 'print-agenda', learnerId: 'learner-b', location: 'study', target: 'portal' });
  });

  it('maps a reading-session intent the same way — the op is not enumerated here', () => {
    const r = mapIntentToResponse({ action: 'reading-session', learnerId: 'learner-c', target: 'livingroom-tv', location: 'livingroom', params: {} });
    expect(r).toMatchObject({ kind: 'learner', op: 'reading-session', learnerId: 'learner-c' });
  });

  it('maps an op nobody has ever registered, rather than throwing UNKNOWN_ACTION', () => {
    // The refusal for an unhandled op belongs to the handler, by name, at
    // dispatch — not here as an error that names the tap and nothing else.
    expect(mapIntentToResponse({ action: 'nothing-implements-this', learnerId: 'learner-d', params: {} }))
      .toMatchObject({ kind: 'learner', op: 'nothing-implements-this' });
  });

  it('still maps content actions unchanged', () => {
    const r = mapIntentToResponse({ action: 'play-next', target: 'livingroom-tv', content: 'plex:620681', params: {} });
    expect(r.kind).toBe('content');
  });

  it('an action with no learnerId is still an unknown action', () => {
    expect(() => mapIntentToResponse({ action: 'print-agenda', target: 'portal', params: {} })).toThrow(UnknownActionError);
  });

  // The pair, end to end: what NfcResolver actually emits for a learner card
  // must be mappable, and must carry the reader it was tapped at — the handler
  // logs it, and the reading-session action will need it to know which screen.
  it('maps the resolver\'s real learner intent, reader and all', () => {
    const registry = {
      locations: { study: { target: 'portal', action: 'play-next', learner_action: 'print-agenda', defaults: {} } },
      tags: { '048ba600cc2a81': { global: { note: 'Learner A personal card', school_learner: 'learner-a' }, overrides: {} } },
    };
    const intent = NfcResolver.resolve({
      location: 'study', value: '04:8B:A6:00:CC:2A:81', registry,
      contentIdResolver: { resolve: (c) => c.startsWith('plex:') ? c : null },
    });
    expect(mapIntentToResponse(intent)).toMatchObject({
      kind: 'learner', op: 'print-agenda', learnerId: 'learner-a', location: 'study', target: 'portal',
    });
  });
});

// Pin the RESOLVER's real content intent against this mapper. The learner pair
// below already does this for learner cards; content needed the same guard,
// because the resolver was not putting `location` on a content intent at all —
// the mapper could read it faithfully and still hand the interceptor undefined.
describe('mapIntentToResponse — content location, end to end from the resolver', () => {
  it('a book tap resolved at a reader maps to a content Response carrying that reader', () => {
    const registry = {
      locations: { livingroom: { target: 'livingroom-tv', action: 'play-next', defaults: {} } },
      tags: { '048ba600cc2a81': { global: { content: 'plex:620681' }, overrides: {} } },
    };
    const intent = NfcResolver.resolve({
      location: 'livingroom', value: '04:8B:A6:00:CC:2A:81', registry,
    });
    expect(mapIntentToResponse(intent)).toMatchObject({
      kind: 'content', target: 'livingroom-tv', location: 'livingroom',
    });
  });
});
