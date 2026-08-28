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
      effects: { dialect: 'gs', resend: 5 },
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
    expect(cfg.effects).toEqual({ dialect: 'gs', route: 'pianobridge', transport: 'sysex', resend: 5 });
  });
  it('the synthesized default piano inherits straight from shared top-level', () => {
    const raw = { videos: { plexCollection: '999' } };
    const cfg = resolvePianoConfig(raw, 'default');
    expect(cfg.videos.plexCollection).toBe('999');
    expect(cfg.inactivityMinutes).toBe(PIANO_CONFIG_DEFAULTS.inactivityMinutes);
  });
  it('falls back to defaults for an unknown piano', () => {
    const cfg = resolvePianoConfig({}, 'ghost');
    expect(cfg.effects).toEqual(PIANO_CONFIG_DEFAULTS.effects);
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

  it('passes sheetmusic grouped collections through (score tabs)', () => {
    const raw = {
      sheetmusic: {
        collections: [
          { label: 'Video Games', ref: 'files:docs/sheet-music/video-games' },
          { label: 'TV Shows', ref: 'files:docs/sheet-music/tv-shows' },
        ],
      },
    };
    const cfg = resolvePianoConfig(raw, 'default');
    expect(cfg.sheetmusic.collections).toHaveLength(2);
    expect(cfg.sheetmusic.collections[0].label).toBe('Video Games');
  });

  it('keeps the legacy single sheetmusic collection working', () => {
    const cfg = resolvePianoConfig({ sheetmusic: { collection: 'files:docs/sheet-music' } }, 'default');
    expect(cfg.sheetmusic.collection).toBe('files:docs/sheet-music');
  });

  // Wave-3 E — the resolver gotcha: sheetmusic is a whole-node passthrough (like
  // videos/karaoke above), so a new nested field is not silently dropped only
  // BECAUSE nothing field-wise unpacks it today. This pins that passthrough for
  // `learn.defaultHands` specifically, so a future field-wise rewrite of the
  // sheetmusic block can't drop it without a failing test.
  it('passes sheetmusic.learn.defaultHands through (the resolver gotcha)', () => {
    const cfg = resolvePianoConfig({ sheetmusic: { learn: { defaultHands: 'rh' } } }, 'default');
    expect(cfg.sheetmusic.learn.defaultHands).toBe('rh');
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

describe('effects config', () => {
  it('resolves every field per-piano over shared over defaults', () => {
    const raw = {
      effects: { dialect: 'gs', route: 'pianobridge', transport: 'cc', resend: 2 },
      pianos: { upstairs: { effects: { transport: 'sysex', resend: 4 } } },
    };
    expect(resolvePianoConfig(raw, 'upstairs').effects).toEqual({ dialect: 'gs', route: 'pianobridge', transport: 'sysex', resend: 4 });
    expect(resolvePianoConfig({}, 'default').effects).toEqual({ dialect: 'gm2', route: 'pianobridge', transport: 'sysex', resend: 3 });
  });

  it('does not expose retired rendered voice catalogs', () => {
    const config = resolvePianoConfig({ voices: [{ program: 1 }], instruments: [{ id: 'old' }] }, 'default');
    expect(config).not.toHaveProperty('voices');
    expect(config).not.toHaveProperty('instruments');
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

describe('autoStudio config', () => {
  it('defaults enabled with 8 notes / 3s span / 10s window', () => {
    const cfg = resolvePianoConfig({}, null);
    expect(cfg.autoStudio).toEqual({ enabled: true, minNotes: 8, minSpanSeconds: 3, windowSeconds: 10 });
  });

  it('per-piano overrides merge over defaults', () => {
    const raw = { pianos: { p1: { autoStudio: { minNotes: 12 } } } };
    const cfg = resolvePianoConfig(raw, 'p1');
    expect(cfg.autoStudio.minNotes).toBe(12);
    expect(cfg.autoStudio.enabled).toBe(true);
    expect(cfg.autoStudio.windowSeconds).toBe(10);
  });
});

// gameLimit is off by default like curfew, and — like effects/videos/producer
// — a whole-node passthrough: the server owns dailyMinutes/warnAtMinutes/etc,
// the client only branches on `enabled`, but every field still has to survive
// the resolver or a future consumer finds it silently dropped (the resolver's
// own named failure mode — see the module-header comment on gameLimit).
describe('gameLimit config', () => {
  it('defaults to disabled (off by default, like curfew)', () => {
    expect(resolvePianoConfig({}, 'default').gameLimit).toEqual({ enabled: false });
  });

  it('passes the whole gameLimit block through (dailyMinutes, warnAtMinutes, users, etc.)', () => {
    const raw = {
      gameLimit: {
        enabled: true, source: 'fixed', dailyMinutes: 45, deviceDailyMinutes: 120,
        warnAtMinutes: 5, idleAfterSeconds: 90, users: { user_1: { dailyMinutes: 30 } },
      },
    };
    const cfg = resolvePianoConfig(raw, 'default');
    expect(cfg.gameLimit).toEqual(raw.gameLimit);
  });

  it('lets a per-piano gameLimit override the shared one', () => {
    const raw = {
      gameLimit: { enabled: true, dailyMinutes: 45 },
      pianos: { upstairs: { gameLimit: { enabled: false } } },
    };
    expect(resolvePianoConfig(raw, 'upstairs').gameLimit.enabled).toBe(false);
    expect(resolvePianoConfig(raw, 'default').gameLimit.enabled).toBe(true);
  });
});

// Curfew is config-driven: the code ships it off, and the household's cut-off
// comes from data/household/piano/config.yml — shared for every piano, or
// per-piano when one kiosk keeps different hours.
describe('curfew config', () => {
  it('is off by default, so an unconfigured piano never greys out', () => {
    const cfg = resolvePianoConfig({}, null);
    expect(cfg.curfew).toEqual({ enabled: false, start: '19:00', end: '06:00' });
  });

  it('takes the household-wide window from shared config', () => {
    const raw = { curfew: { enabled: true, start: '19:00', end: '06:00' } };
    const cfg = resolvePianoConfig(raw, 'default');
    expect(cfg.curfew).toEqual({ enabled: true, start: '19:00', end: '06:00' });
  });

  it('lets one piano override the shared window field-wise', () => {
    const raw = {
      curfew: { enabled: true, start: '19:00', end: '06:00' },
      pianos: { p1: { curfew: { start: '20:30' } }, p2: { curfew: { enabled: false } } },
    };
    expect(resolvePianoConfig(raw, 'p1').curfew).toEqual({ enabled: true, start: '20:30', end: '06:00' });
    expect(resolvePianoConfig(raw, 'p2').curfew.enabled).toBe(false);
  });
});
