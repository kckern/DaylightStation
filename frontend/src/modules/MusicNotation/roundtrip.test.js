import { describe, it, expect } from 'vitest';
import { serializeMusicXml } from './serializeMusicXml.js';
import { parseMusicXml } from './parseMusicXml.js';
import { makeEmptyScore } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/score.js';
import { makeNote, makeRest } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/note.js';

// A model exercising every v1 element together.
function everythingScore() {
  const s = makeEmptyScore();
  const a = makeNote({ step: 'E', octave: 4 }, { type: 'quarter', tie: 'start' });
  const b = makeNote({ step: 'E', octave: 4 }, { type: 'quarter', tie: 'stop' });
  const c = makeNote({ step: 'F', octave: 4, alter: 1 }, { type: 'eighth', triplet: true });
  c.dynamics = 'f'; c.articulations = ['staccato']; c.lyric = 'la';
  const r = makeRest({ type: 'eighth' });
  s.parts[0].measures[0].notes = [a, b, c, r];
  return s;
}

describe('round-trip — model → xml → model preserves every element', () => {
  const s = everythingScore();
  const back = parseMusicXml(serializeMusicXml(s));
  const notes = back.parts[0].measures[0].notes;
  it('preserves pitch/midi (and rest)', () => {
    expect(notes.map((n) => n.midi ?? 'rest')).toEqual([64, 64, 66, 'rest']);
  });
  it('preserves ties', () => {
    expect([notes[0].tie, notes[1].tie]).toEqual(['start', 'stop']);
  });
  it('preserves the triplet', () => {
    expect(notes[2].triplet).toBe(true);
  });
  it('preserves dynamics/articulation/lyric', () => {
    expect(notes[2].dynamics).toBe('f');
    expect(notes[2].articulations).toEqual(['staccato']);
    expect(notes[2].lyric).toBe('la');
  });
});
