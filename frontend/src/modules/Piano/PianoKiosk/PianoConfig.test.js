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

describe('resolveScreensaver', () => {
  it('disables screen control by default (no deviceId)', () => {
    expect(resolveScreensaver({}, {})).toEqual({
      deviceId: null,
      timeoutMinutes: PIANO_CONFIG_DEFAULTS.screensaver.timeoutMinutes,
      quietHours: null,
    });
  });
  it('lets a per-piano value override a shared value', () => {
    const shared = { screensaver: { deviceId: 'shared-tablet', timeoutMinutes: 20 } };
    const p = { screensaver: { timeoutMinutes: 5 } };
    expect(resolveScreensaver(shared, p)).toEqual({
      deviceId: 'shared-tablet',
      timeoutMinutes: 5,
      quietHours: null,
    });
  });
});
