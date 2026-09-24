import { describe, it, expect } from 'vitest';
import { VoiceResolver, voiceKeyword } from './VoiceResolver.mjs';
import { ResolverRegistry } from './ResolverRegistry.mjs';

const kitchen = {
  target: 'kitchen-display',
  auth_token: null,
  routing: { mode: 'confirm', confidenceFloor: null },
  commands: {
    play_jazz: { description: 'Play jazz music', action: 'play', content: 'plex:1', volume: 10 },
    lights_off: { description: 'Kitchen lights off', action: 'scene', scene: 'scene.kitchen_off', target: 'other' },
    stop: { action: 'clear' },
  },
};
const registry = { locations: { kitchen } };

describe('voiceKeyword', () => {
  it.each([
    ['Play Jazz!', 'play_jazz'],
    ['  play   jazz ', 'play_jazz'],
    ['play_jazz', 'play_jazz'],
    ['재즈 틀어', '재즈_틀어'],
    ['', ''],
    [null, ''],
  ])('%j → %j', (input, expected) => {
    expect(voiceKeyword(input)).toBe(expected);
  });
});

describe('VoiceResolver.resolve', () => {
  it('returns null for an unknown location or keyword', () => {
    expect(VoiceResolver.resolve({ location: 'attic', value: 'play_jazz', registry })).toBeNull();
    expect(VoiceResolver.resolve({ location: 'kitchen', value: 'make coffee', registry })).toBeNull();
  });

  it('resolves a transcript that normalizes to a command id, with params and content', () => {
    expect(VoiceResolver.resolve({ location: 'kitchen', value: 'Play jazz', registry })).toEqual({
      action: 'play', target: 'kitchen-display', content: 'plex:1', params: { volume: 10 },
    });
  });

  it('lets a command override the location target and keeps description out of params', () => {
    expect(VoiceResolver.resolve({ location: 'kitchen', value: 'lights_off', registry })).toEqual({
      action: 'scene', target: 'other', scene: 'scene.kitchen_off', params: {},
    });
  });
});

describe('VoiceResolver.commandOptions', () => {
  it('maps command ids to descriptions, null when absent', () => {
    expect(VoiceResolver.commandOptions(kitchen)).toEqual({
      play_jazz: 'Play jazz music', lights_off: 'Kitchen lights off', stop: null,
    });
  });

  it('returns {} for a missing location config', () => {
    expect(VoiceResolver.commandOptions(undefined)).toEqual({});
  });
});

describe('ResolverRegistry voice', () => {
  it('dispatches voice to VoiceResolver with the voice slice', () => {
    const intent = ResolverRegistry.resolve({ modality: 'voice', location: 'kitchen', value: 'stop', registry: { voice: registry } });
    expect(intent).toEqual({ action: 'clear', target: 'kitchen-display', params: {} });
  });
});
