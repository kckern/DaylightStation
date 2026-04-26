import { describe, it, expect } from 'vitest';
import { resolveIntent } from '../../../../backend/src/2_domains/trigger/TriggerIntent.mjs';

function makeResolver(knownPrefixes) {
  return {
    resolve(compoundId) {
      const m = /^([a-z][a-z0-9-]*):/i.exec(compoundId);
      if (m && knownPrefixes.includes(m[1])) return { source: m[1] };
      return null;
    }
  };
}

describe('resolveIntent', () => {
  const locationConfig = { target: 'livingroom-tv', action: 'queue', location: 'livingroom' };
  const resolver = makeResolver(['plex', 'hymn']);

  it('expands single-content-prefix shorthand using location defaults', () => {
    const intent = resolveIntent(locationConfig, { plex: 620707 }, resolver);
    expect(intent).toEqual({
      action: 'queue',
      target: 'livingroom-tv',
      content: 'plex:620707',
      params: {},
    });
  });

  it('uses entry-level overrides for action and target', () => {
    const intent = resolveIntent(locationConfig, {
      action: 'play',
      target: 'kitchen-speaker',
      content: 'hymn:166',
      volume: 60,
    }, resolver);
    expect(intent).toEqual({
      action: 'play',
      target: 'kitchen-speaker',
      content: 'hymn:166',
      params: { volume: 60 },
    });
  });

  it('passes through home-automation action params', () => {
    const intent = resolveIntent(locationConfig, {
      action: 'scene',
      scene: 'scene.movie_night',
    }, resolver);
    expect(intent).toEqual({
      action: 'scene',
      target: 'livingroom-tv',
      scene: 'scene.movie_night',
      params: {},
    });
  });

  it('passes generic ha-service fields through', () => {
    const intent = resolveIntent(locationConfig, {
      action: 'ha-service',
      service: 'light.turn_off',
      entity: 'light.livingroom',
    }, resolver);
    expect(intent.action).toBe('ha-service');
    expect(intent.service).toBe('light.turn_off');
    expect(intent.entity).toBe('light.livingroom');
  });

  it('treats {plex: ...} as shorthand even when target/action also present (override semantics)', () => {
    const intent = resolveIntent(
      locationConfig,
      { plex: 620707, target: 'office-tv' },
      resolver
    );
    expect(intent.content).toBe('plex:620707');
    expect(intent.target).toBe('office-tv');
    expect(intent.action).toBe('queue');
  });

  it('does not expand non-content keys as shorthand', () => {
    const intent = resolveIntent(
      locationConfig,
      { action: 'open', path: '/menu' },
      resolver
    );
    expect(intent.action).toBe('open');
    expect(intent.params.path).toBe('/menu');
    expect(intent.content).toBeUndefined();
  });

  it('throws when locationConfig is missing', () => {
    expect(() => resolveIntent(null, { plex: 1 }, resolver))
      .toThrow(/locationConfig/i);
  });

  it('throws when valueEntry is missing', () => {
    expect(() => resolveIntent(locationConfig, null, resolver))
      .toThrow(/valueEntry/i);
  });

  it('coerces numeric content values to strings', () => {
    const intent = resolveIntent(locationConfig, { plex: 620707 }, resolver);
    expect(intent.content).toBe('plex:620707');
    expect(typeof intent.content).toBe('string');
  });

  it('does not expand shorthand with unknown content prefix', () => {
    const intent = resolveIntent(locationConfig, { vimeo: 12345 }, resolver);
    expect(intent.content).toBeUndefined();
    expect(intent.params.vimeo).toBe(12345);
  });

  it('does not expand shorthand when multiple candidate keys are present', () => {
    const intent = resolveIntent(locationConfig, { plex: 1, hymn: 2 }, resolver);
    expect(intent.content).toBeUndefined();
    expect(intent.params.plex).toBe(1);
    expect(intent.params.hymn).toBe(2);
  });
});
