import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadScoreSettings, saveScoreSettings } from './scoreSettings.js';

beforeEach(() => { try { window.localStorage.clear(); } catch { /* no storage */ } });

describe('scoreSettings', () => {
  // `focus` is the one field a patch can carry that never comes back out (audit M1).
  it('round-trips a settings patch per score id (merge-on-save), minus the retired focus', () => {
    saveScoreSettings('files:a.musicxml', { mode: 'polish', tempoMult: 0.75 });
    saveScoreSettings('files:a.musicxml', { clickOn: false, focus: { kind: 'custom', inMeasure: 2, outMeasure: 5 } });
    expect(loadScoreSettings('files:a.musicxml')).toEqual({
      mode: 'polish', tempoMult: 0.75, clickOn: false,
    });
  });

  it('is isolated per score id', () => {
    saveScoreSettings('files:a.musicxml', { mode: 'polish' });
    expect(loadScoreSettings('files:b.musicxml')).toEqual({});
  });

  it('never returns a persisted focus, even if an old build stored one', () => {
    window.localStorage.setItem('daylight.piano.sm.s1', JSON.stringify({
      v: 1, mode: 'polish', tempoMult: 1.25, focus: { kind: 'custom', inMeasure: 10, outMeasure: 68 },
    }));
    const s = loadScoreSettings('s1');
    expect(s.focus).toBeUndefined();
    expect(s.mode).toBe('polish');       // the useful settings still restore
    expect(s.tempoMult).toBe(1.25);
  });

  it('strips the retired myStaves field on read and never rewrites it', () => {
    window.localStorage.setItem('daylight.piano.sm.x', JSON.stringify({ v: 1, myStaves: [0], mode: 'listen' }));
    expect(loadScoreSettings('x')).toEqual({ mode: 'listen' });
    saveScoreSettings('x', { tempoMult: 1 });
    expect(JSON.parse(window.localStorage.getItem('daylight.piano.sm.x')).myStaves).toBeUndefined();
  });

  it('tolerates corrupt JSON and missing/blank ids', () => {
    window.localStorage.setItem('daylight.piano.sm.files:c.musicxml', '{oops');
    expect(loadScoreSettings('files:c.musicxml')).toEqual({});
    expect(loadScoreSettings('')).toEqual({});
    expect(() => saveScoreSettings('', { mode: 'learn' })).not.toThrow();
  });
});
