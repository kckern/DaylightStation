import { describe, it, expect } from 'vitest';
import { interpretCastCommand } from './useFitnessCastReceiver.js';

const cmd = (params, extra = {}) => ({ type: 'command', targetDevice: 'garage-tv', command: 'queue', commandId: 'c1', params, ...extra });

describe('interpretCastCommand', () => {
  it('plays a Plex play-now for this device', () => {
    expect(interpretCastCommand(cmd({ op: 'play-now', contentId: 'plex:774715' }), 'garage-tv')).toEqual({ play: '774715' });
  });

  it('ignores commands for other devices and non-commands', () => {
    expect(interpretCastCommand(cmd({ op: 'play-now', contentId: 'plex:1' }, { targetDevice: 'office-tv' }), 'garage-tv')).toBeNull();
    expect(interpretCastCommand({ topic: 'homeline:garage-tv', type: 'progress' }, 'garage-tv')).toBeNull();
    expect(interpretCastCommand(cmd({ op: 'play-now', contentId: 'plex:1' }), null)).toBeNull();
  });

  it('refuses adds and non-Plex sources with a reason', () => {
    expect(interpretCastCommand(cmd({ op: 'add', contentId: 'plex:1' }), 'garage-tv').reject.code).toBe('UNSUPPORTED');
    expect(interpretCastCommand(cmd({ op: 'play-now', contentId: 'youtube:abc' }), 'garage-tv').reject.code).toBe('UNSUPPORTED_SOURCE');
  });
});
