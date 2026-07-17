import { describe, it, expect } from 'vitest';
import { makeEmptyScore } from '#frontend/modules/Piano/PianoKiosk/modes/Composer/model/score.js';
import { serializeMusicXml } from './serializeMusicXml.js';
import { parseMusicXml } from './parseMusicXml.js';

describe('serializeMusicXml — scaffold', () => {
  const xml = serializeMusicXml(makeEmptyScore());
  it('emits a score-partwise document with a part and one measure', () => {
    expect(xml).toContain('<score-partwise');
    expect(xml).toContain('<part id="P1">');
    expect(xml).toContain('<measure number="1">');
  });
  it('is parseable by DOMParser (no parsererror)', () => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });
  it('round-trips the header through parseMusicXml (4/4, C, tempo 100)', () => {
    const back = parseMusicXml(xml);
    expect(back.timeSig).toEqual({ beats: 4, beatType: 4 });
    expect(back.key.fifths).toBe(0);
    expect(back.tempo).toBe(100);
  });
});
