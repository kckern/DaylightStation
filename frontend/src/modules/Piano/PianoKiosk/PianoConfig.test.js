import { describe, it, expect } from 'vitest';
import { derivePianos, resolvePianoConfig, resolveScreensaver, PIANO_CONFIG_DEFAULTS } from './PianoConfig.jsx';

describe('derivePianos', () => {
  it('lists the configured pianos', () => {
    const raw = { pianos: { 'yellow-room': { label: 'Yellow Room' }, studio: {} } };
    expect(derivePianos(raw)).toEqual([
      { id: 'yellow-room', label: 'Yellow Room' },
      { id: 'studio', label: 'studio' },
    ]);
  });
  it('synthesizes a single default piano when none configured', () => {
    expect(derivePianos({})).toEqual([{ id: 'default', label: 'Piano' }]);
    expect(derivePianos(null)).toEqual([{ id: 'default', label: 'Piano' }]);
  });
});

describe('resolvePianoConfig', () => {
  it('overlays per-piano values over shared defaults', () => {
    const raw = {
      voices: [{ label: 'Grand', program: 0 }],
      videos: { plexCollection: '111' },
      inactivityMinutes: 5,
      pianos: {
        'yellow-room': { label: 'Yellow Room', midi: { preferredInputName: 'Roland' }, videos: { plexCollection: '222' } },
      },
    };
    const cfg = resolvePianoConfig(raw, 'yellow-room');
    expect(cfg.label).toBe('Yellow Room');
    expect(cfg.midi.preferredInputName).toBe('Roland');
    expect(cfg.videos.plexCollection).toBe('222'); // per-piano overrides shared
    expect(cfg.inactivityMinutes).toBe(5);          // inherited from shared
    expect(cfg.voices).toEqual([{ label: 'Grand', program: 0 }]);
  });
  it('the synthesized default piano inherits straight from shared top-level', () => {
    const raw = { videos: { plexCollection: '999' } };
    const cfg = resolvePianoConfig(raw, 'default');
    expect(cfg.videos.plexCollection).toBe('999');
    expect(cfg.inactivityMinutes).toBe(PIANO_CONFIG_DEFAULTS.inactivityMinutes);
  });
  it('falls back to defaults for an unknown piano', () => {
    const cfg = resolvePianoConfig({}, 'ghost');
    expect(cfg.voices).toEqual(PIANO_CONFIG_DEFAULTS.voices);
    expect(cfg.videos.plexCollection).toBeNull();
  });
  it('passes the whole videos block through (collections + thresholds, not just plexCollection)', () => {
    const raw = {
      videos: {
        collections: [
          { label: 'Music Lessons', plex: ['plex:675686', 'plex:676074'] },
          { label: 'Music Appreciation', plex: ['plex:675687'] },
        ],
        sequential_labels: ['sequential'],
        engagement_timeout_seconds: 90,
      },
    };
    const cfg = resolvePianoConfig(raw, 'default');
    expect(cfg.videos.collections).toHaveLength(2);
    expect(cfg.videos.collections[1].label).toBe('Music Appreciation');
    expect(cfg.videos.sequential_labels).toEqual(['sequential']);
    expect(cfg.videos.engagement_timeout_seconds).toBe(90);
  });

  it('resolves separate playalong and singalong collections', () => {
    const raw = {
      playalong: { plexCollection: ['plex:676474'] },
      singalong: { plexCollection: ['plex:676475'] },
    };
    const cfg = resolvePianoConfig(raw, 'default');
    expect(cfg.playalong.plexCollection).toEqual(['plex:676474']);
    expect(cfg.singalong.plexCollection).toEqual(['plex:676475']);
  });
  it('defaults singalong to an empty collection when unconfigured', () => {
    const cfg = resolvePianoConfig({}, 'default');
    expect(cfg.singalong.plexCollection).toBeNull();
  });

  it('resolves karaoke plexShow (shared default, per-piano override)', () => {
    const raw = {
      karaoke: { plexShow: 683640 },
      pianos: { upstairs: { karaoke: { plexShow: 999999 } } },
    };
    expect(resolvePianoConfig(raw, 'default').karaoke.plexShow).toBe(683640);
    expect(resolvePianoConfig(raw, 'upstairs').karaoke.plexShow).toBe(999999);
  });
  it('defaults karaoke to an empty show when unconfigured', () => {
    expect(resolvePianoConfig({}, 'default').karaoke.plexShow).toBeNull();
  });

  it('resolves shortlist voices (shared default, per-piano override)', () => {
    const raw = {
      shortlist: { voices: [{ pc: 0, bank: 0 }] },
      pianos: { upstairs: { shortlist: { voices: [{ pc: 4, bank: 0 }] } } },
    };
    expect(resolvePianoConfig(raw, 'default').shortlist.voices).toEqual([{ pc: 0, bank: 0 }]);
    expect(resolvePianoConfig(raw, 'upstairs').shortlist.voices).toEqual([{ pc: 4, bank: 0 }]);
  });
  it('defaults shortlist to an empty voice list when unconfigured', () => {
    expect(resolvePianoConfig({}, 'default').shortlist.voices).toEqual([]);
  });

  it('resolves screensaver config (per-piano deviceId over shared defaults)', () => {
    const raw = {
      screensaver: { timeoutMinutes: 30, quietHours: { start: '22:00', end: '06:00' } },
      pianos: { 'yellow-room': { screensaver: { deviceId: 'yellow-room-tablet' } } },
    };
    const cfg = resolvePianoConfig(raw, 'yellow-room');
    expect(cfg.screensaver).toEqual({
      deviceId: 'yellow-room-tablet',           // per-piano
      timeoutMinutes: 30,                        // shared
      quietHours: { start: '22:00', end: '06:00' },
      offCooldownMinutes: PIANO_CONFIG_DEFAULTS.screensaver.offCooldownMinutes,
    });
  });
});

describe('instruments config', () => {
  it('defaults instruments to an empty list when unset', () => {
    const cfg = resolvePianoConfig({}, 'default');
    expect(cfg.instruments).toEqual([]);
  });

  it('passes through per-piano instruments over shared', () => {
    const raw = {
      instruments: [{ id: 'shared_grand', name: 'Shared', engine: 'sfizz', asset: 'a.sfz' }],
      pianos: {
        upstairs: {
          instruments: [{ id: 'dx7', name: 'DX7', engine: 'dexed', asset: 'b.syx', patch: 3 }],
        },
      },
    };
    expect(resolvePianoConfig(raw, 'upstairs').instruments[0].id).toBe('dx7');
    // 'default' inherits straight from shared top-level instruments.
    expect(resolvePianoConfig(raw, 'default').instruments).toEqual([
      { id: 'shared_grand', name: 'Shared', engine: 'sfizz', asset: 'a.sfz' },
    ]);
  });
});

describe('studio config', () => {
  it('defaults the top-pane layout to staff', () => {
    expect(resolvePianoConfig({}, 'default').studio.topPaneLayout).toBe('staff');
  });

  it('passes through a household studio.topPaneLayout default', () => {
    const raw = { studio: { topPaneLayout: 'triptych' } };
    expect(resolvePianoConfig(raw, 'default').studio.topPaneLayout).toBe('triptych');
  });

  it('lets a per-piano studio default override the shared one', () => {
    const raw = {
      studio: { topPaneLayout: 'staff' },
      pianos: { upstairs: { studio: { topPaneLayout: 'triptych' } } },
    };
    expect(resolvePianoConfig(raw, 'upstairs').studio.topPaneLayout).toBe('triptych');
  });
});

describe('producer config', () => {
  it('defaults producer to null (onboard GM unverified)', () => {
    expect(resolvePianoConfig({}, 'default').producer).toBeNull();
  });

  it('passes the producer block through (voiceTiers capability flags)', () => {
    const raw = { producer: { voiceTiers: { onboardGm: true } } };
    expect(resolvePianoConfig(raw, 'default').producer).toEqual({ voiceTiers: { onboardGm: true } });
  });

  it('lets a per-piano producer block override the shared one', () => {
    const raw = {
      producer: { voiceTiers: { onboardGm: false } },
      pianos: { upstairs: { producer: { voiceTiers: { onboardGm: true } } } },
    };
    expect(resolvePianoConfig(raw, 'upstairs').producer.voiceTiers.onboardGm).toBe(true);
  });
});

describe('resolvePianoConfig — whoIsPlayingMinutes + autoRecord', () => {
  it('resolves who-is-playing + auto-record defaults and per-piano overrides', () => {
    const base = resolvePianoConfig({}, 'default');
    expect(base.whoIsPlayingMinutes).toBe(2);
    expect(base.autoRecord).toEqual({ enabled: false, silenceSeconds: 25, minNotes: 5, minSeconds: 3, flushSeconds: 12 });

    const over = resolvePianoConfig(
      { whoIsPlayingMinutes: 5, autoRecord: { enabled: true, minNotes: 8 } },
      'default',
    );
    expect(over.whoIsPlayingMinutes).toBe(5);
    expect(over.autoRecord).toEqual({ enabled: true, silenceSeconds: 25, minNotes: 8, minSeconds: 3, flushSeconds: 12 });
  });
});

describe('resolveScreensaver', () => {
  it('disables screen control by default (no deviceId)', () => {
    expect(resolveScreensaver({}, {})).toEqual({
      deviceId: null,
      timeoutMinutes: PIANO_CONFIG_DEFAULTS.screensaver.timeoutMinutes,
      quietHours: null,
      offCooldownMinutes: PIANO_CONFIG_DEFAULTS.screensaver.offCooldownMinutes,
    });
  });
  it('lets a per-piano value override a shared value', () => {
    const shared = { screensaver: { deviceId: 'shared-tablet', timeoutMinutes: 20 } };
    const p = { screensaver: { timeoutMinutes: 5 } };
    expect(resolveScreensaver(shared, p)).toEqual({
      deviceId: 'shared-tablet',
      timeoutMinutes: 5,
      quietHours: null,
      offCooldownMinutes: PIANO_CONFIG_DEFAULTS.screensaver.offCooldownMinutes,
    });
  });
});
