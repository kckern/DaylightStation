import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadScoreSettings, saveScoreSettings } from './scoreSettings.js';

beforeEach(() => { try { window.localStorage.clear(); } catch { /* no storage */ } });

describe('scoreSettings', () => {
  it('round-trips a settings patch per score id (merge-on-save)', () => {
    saveScoreSettings('files:a.musicxml', { mode: 'polish', tempoMult: 0.75 });
    saveScoreSettings('files:a.musicxml', { focus: { kind: 'custom', inMeasure: 2, outMeasure: 5 } });
    expect(loadScoreSettings('files:a.musicxml')).toMatchObject({
      mode: 'polish', tempoMult: 0.75, focus: { inMeasure: 2, outMeasure: 5 },
    });
  });

  it('is isolated per score id', () => {
    saveScoreSettings('files:a.musicxml', { mode: 'polish' });
    expect(loadScoreSettings('files:b.musicxml')).toEqual({});
  });

  it('tolerates corrupt JSON and missing/blank ids', () => {
    window.localStorage.setItem('daylight.piano.sm.files:c.musicxml', '{oops');
    expect(loadScoreSettings('files:c.musicxml')).toEqual({});
    expect(loadScoreSettings('')).toEqual({});
    expect(() => saveScoreSettings('', { mode: 'learn' })).not.toThrow();
  });
});
