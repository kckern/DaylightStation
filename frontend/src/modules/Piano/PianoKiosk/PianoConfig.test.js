import { describe, it, expect } from 'vitest';
import { derivePianos, resolvePianoConfig, PIANO_CONFIG_DEFAULTS } from './PianoConfig.jsx';

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
});
