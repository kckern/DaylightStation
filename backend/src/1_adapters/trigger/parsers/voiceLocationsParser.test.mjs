import { describe, it, expect, vi } from 'vitest';
import { parseVoiceLocations } from './voiceLocationsParser.mjs';
import { parseSources } from './sourcesParser.mjs';
import { buildTriggerRegistry } from './buildTriggerRegistry.mjs';

const kitchen = {
  target: 'kitchen-display',
  commands: {
    'Play Jazz': { description: 'Play jazz music', action: 'play', content: 'plex:1' },
    lights_off: { action: 'scene', scene: 'scene.kitchen_off' },
  },
};

describe('parseVoiceLocations', () => {
  it('returns {} for missing input', () => {
    expect(parseVoiceLocations(null)).toEqual({});
  });

  it('normalizes command ids to keywords and defaults routing to confirm', () => {
    const out = parseVoiceLocations({ kitchen });
    expect(out.kitchen).toEqual({
      target: 'kitchen-display',
      auth_token: null,
      routing: { mode: 'confirm', confidenceFloor: null },
      commands: {
        play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1' },
        lights_off: { action: 'scene', scene: 'scene.kitchen_off' },
      },
    });
  });

  it('carries routing mode, floor and auth token', () => {
    const out = parseVoiceLocations({ kitchen: { ...kitchen, auth_token: 's', routing: { mode: 'route', confidence_floor: 0.7 } } });
    expect(out.kitchen.auth_token).toBe('s');
    expect(out.kitchen.routing).toEqual({ mode: 'route', confidenceFloor: 0.7 });
  });

  it.each([
    ['no target', { commands: kitchen.commands }, 'MISSING_TARGET'],
    ['no commands', { target: 't' }, 'MISSING_COMMANDS'],
    ['empty commands', { target: 't', commands: {} }, 'MISSING_COMMANDS'],
    ['command without action', { target: 't', commands: { a: { description: 'x' } } }, 'COMMAND_MISSING_ACTION'],
    ['reserved none id', { target: 't', commands: { None: { action: 'clear' } } }, 'INVALID_COMMAND_ID'],
    ['ids that collide after normalizing', { target: 't', commands: { 'a b': { action: 'clear' }, a_b: { action: 'clear' } } }, 'DUPLICATE_COMMAND'],
    ['bad mode', { ...kitchen, routing: { mode: 'yolo' } }, 'INVALID_ROUTING_MODE'],
    ['floor out of range', { ...kitchen, routing: { confidence_floor: 1.5 } }, 'INVALID_CONFIDENCE_FLOOR'],
  ])('rejects %s', (_label, entry, code) => {
    expect(() => parseVoiceLocations({ kitchen: entry })).toThrow(expect.objectContaining({ code }));
  });
});

describe('voice sources in sources.yml', () => {
  it('parseSources partitions a voice source by its location and lifts the auth secret', () => {
    const out = parseSources({
      'kitchen-voice': { modality: 'voice', location: 'kitchen', guards: { authenticate: { secret: 's' } }, ...kitchen },
    });
    expect(out.voice.locations.kitchen.auth_token).toBe('s');
    expect(Object.keys(out.voice.locations.kitchen.commands)).toEqual(['play_jazz', 'lights_off']);
  });

  it('parseSources returns an empty voice slice when there is no sources file', () => {
    expect(parseSources(null).voice).toEqual({ locations: {} });
  });

  it('buildTriggerRegistry exposes registry.voice', () => {
    const reg = buildTriggerRegistry({ sources: { kitchen: { modality: 'voice', ...kitchen } } });
    expect(reg.voice.locations.kitchen.target).toBe('kitchen-display');
  });
});

describe('voice sources under per-entry isolation (onSkip)', () => {
  it('a bad voice source is skipped alone; good voice and nfc sources still load', () => {
    const skipped = [];
    const out = parseSources({
      livingroom: { modality: 'nfc', target: 'livingroom-tv' },
      'kitchen-voice': { modality: 'voice', location: 'kitchen', ...kitchen },
      'garage-voice': { modality: 'voice', location: 'garage', target: 'garage-tv' },
    }, { onSkip: (s) => skipped.push(s) });
    expect(Object.keys(out.voice.locations)).toEqual(['kitchen']);
    expect(Object.keys(out.nfc.locations)).toEqual(['livingroom']);
    expect(skipped).toEqual([expect.objectContaining({ kind: 'source', id: 'garage-voice', code: 'MISSING_COMMANDS' })]);
  });

  it('without onSkip a bad voice source throws', () => {
    expect(() => parseSources({ g: { modality: 'voice', target: 't' } })).toThrow(expect.objectContaining({ code: 'MISSING_COMMANDS' }));
  });
});

describe('prototype-named command ids', () => {
  it('a command called constructor is rejected as a reserved key (not reported as a duplicate)', () => {
    expect(() => parseVoiceLocations({ k: { target: 't', commands: { constructor: { action: 'clear' } } } }))
      .toThrow(expect.objectContaining({ code: 'RESERVED_KEY' }));
  });

  it('a __proto__ key normalizes to "proto" and leaves the commands prototype alone', () => {
    const commands = JSON.parse('{"__proto__": {"action": "clear"}}');
    const out = parseVoiceLocations({ k: { target: 't', commands } });
    expect(Object.keys(out.k.commands)).toEqual(['proto']);
    expect(Object.getPrototypeOf(out.k.commands)).toBe(Object.prototype);
  });
});

describe('voice source warnings (onWarn)', () => {
  it('warns when transcript routing is on and no secret guards the source', () => {
    const warnings = [];
    parseSources({
      'kitchen-voice': { modality: 'voice', location: 'kitchen', ...kitchen },
      'garage-voice': { modality: 'voice', location: 'garage', ...kitchen, guards: { authenticate: { secret: 's' } } },
      'hall-voice': { modality: 'voice', location: 'hall', ...kitchen, routing: { mode: 'off' } },
    }, { onWarn: (w) => warnings.push(w) });
    expect(warnings).toEqual([
      { event: 'trigger.voice.unauthenticated', source: 'kitchen-voice', location: 'kitchen', mode: 'confirm' },
    ]);
  });

  it('warns when two sources of one modality share a location (the last one wins)', () => {
    const warnings = [];
    const out = parseSources({
      'kitchen-a': { modality: 'voice', location: 'kitchen', ...kitchen, guards: { authenticate: { secret: 's' } } },
      'kitchen-b': { modality: 'voice', location: 'kitchen', ...kitchen, target: 'other', guards: { authenticate: { secret: 's' } } },
    }, { onWarn: (w) => warnings.push(w) });
    expect(out.voice.locations.kitchen.target).toBe('other');
    expect(warnings).toEqual([
      { event: 'trigger.config.location.shadowed', modality: 'voice', location: 'kitchen', source: 'kitchen-b', shadowed: 'kitchen-a' },
    ]);
  });

  it('buildTriggerRegistry passes onWarn through', () => {
    const onWarn = vi.fn();
    buildTriggerRegistry({ sources: { kitchen: { modality: 'voice', ...kitchen } } }, { onWarn });
    expect(onWarn).toHaveBeenCalledWith(expect.objectContaining({ event: 'trigger.voice.unauthenticated' }));
  });
});
