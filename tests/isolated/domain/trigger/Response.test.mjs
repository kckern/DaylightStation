import { describe, it, expect } from 'vitest';
import { Response } from '#domains/trigger/Response.mjs';
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

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

// A tap that named a PERSON rather than a piece of content. The op is the
// reader location's `learner_action` — this layer carries it, and deliberately
// does not enumerate the legal ops: which ones exist is the injected
// learner-action registry's business.
describe('Response.learner', () => {
  it('freezes a learner response carrying op, learner and location', () => {
    const r = Response.learner({ op: 'print-agenda', learnerId: 'learner-a', location: 'study', target: 'portal' });
    expect(r).toMatchObject({ kind: 'learner', op: 'print-agenda', learnerId: 'learner-a', location: 'study' });
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('refuses a learner response with no learnerId', () => {
    expect(() => Response.learner({ op: 'print-agenda' })).toThrow(ValidationError);
  });

  it('refuses a learner response with no op', () => {
    expect(() => Response.learner({ learnerId: 'learner-a' })).toThrow(ValidationError);
  });

  it('refuses a non-string op or learnerId rather than stringifying it', () => {
    // Both fields reach a log line and a registry lookup, and both originate in
    // a Dropbox-shared YAML tree. `[object Object]` as an op is a refusal that
    // names nothing; refuse at the boundary instead.
    expect(() => Response.learner({ op: { a: 1 }, learnerId: 'learner-a' })).toThrow(ValidationError);
    expect(() => Response.learner({ op: 'print-agenda', learnerId: ['learner-a', 'learner-b'] })).toThrow(ValidationError);
  });

  it('refuses a whitespace-only op', () => {
    expect(() => Response.learner({ op: '   ', learnerId: 'learner-a' })).toThrow(ValidationError);
  });
});
