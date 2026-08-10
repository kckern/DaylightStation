import { describe, it, expect } from 'vitest';
import {
  parseScoreTitle, rosette, starPolygon, starStep, petalPath, inkFor, gcd, plateFor,
} from './scorePlate.js';

describe('parseScoreTitle', () => {
  it('splits an importer-generated title into its plate fields', () => {
    expect(parseScoreTitle('Burgmüller Op. 100 No. 17 — La Babillarde')).toEqual({
      composer: 'Burgmüller', opus: 100, number: 17, name: 'La Babillarde', movement: null,
    });
  });

  it('lifts a roman-numeral movement out of the name', () => {
    expect(parseScoreTitle('Clementi Op. 36 No. 01 — Sonatina (I. Spiritoso)')).toEqual({
      composer: 'Clementi', opus: 36, number: 1, name: 'Sonatina', movement: 'I. Spiritoso',
    });
  });

  it('handles a bare movement numeral with no tempo word', () => {
    expect(parseScoreTitle('Clementi Op. 36 No. 01 — Sonatina (III)').movement).toBe('III');
  });

  it('still finds the composer when the piece is untitled (no em dash)', () => {
    // Schumann Op.68 No.26 is titled "* * *", so the importer emits set+number
    // only. Losing the composer here would break the opus's shared ink.
    expect(parseScoreTitle('Schumann Op. 68 No. 26')).toEqual({
      composer: 'Schumann', opus: 68, number: 26, name: '', movement: null,
    });
    expect(inkFor(parseScoreTitle('Schumann Op. 68 No. 26').composer).ink)
      .toBe(inkFor('Schumann').ink);
  });

  it('keeps a free-form title intact instead of inventing a composer', () => {
    expect(parseScoreTitle('Gymnopédie No. 1')).toMatchObject({
      composer: null, name: 'Gymnopédie No. 1',
    });
  });

  it('does not mistake an em-dash inside a plain title for a composer split', () => {
    // No Op./No. in the head ⇒ the whole string is the name.
    expect(parseScoreTitle('Air on the G String — Bach')).toMatchObject({
      composer: null, name: 'Air on the G String — Bach',
    });
  });

  it('survives a title with an opus but no number', () => {
    expect(parseScoreTitle('Chopin Op. 28 — Prelude')).toMatchObject({
      composer: 'Chopin', opus: 28, number: null, name: 'Prelude',
    });
  });

  it('returns empty-safe output for junk', () => {
    expect(parseScoreTitle('')).toMatchObject({ composer: null, name: '' });
    expect(parseScoreTitle(null)).toMatchObject({ composer: null, name: '' });
  });
});

describe('inkFor', () => {
  it('gives the library composers their period inks', () => {
    expect(inkFor('Burgmüller').ink).toBe('#6d4526');
    expect(inkFor('Clementi').ink).toBe('#2f4257');
    expect(inkFor('Schumann').ink).toBe('#6a2f36');
  });

  it('derives a stable ink for anyone else', () => {
    expect(inkFor('Kabalevsky').ink).toBe(inkFor('Kabalevsky').ink);
    expect(inkFor('Kabalevsky').ink).not.toBe(inkFor('Diabelli').ink);
  });
});

describe('gcd / starPolygon', () => {
  it('emits one closed cycle when n and k are coprime', () => {
    expect(gcd(7, 3)).toBe(1);
    expect(starPolygon({ n: 7, k: 3, r: 30 })).toHaveLength(1);
  });

  it('emits every cycle when they share a factor, so no vertex is dropped', () => {
    // {6/2} is two triangles (a hexagram), not one broken line.
    const paths = starPolygon({ n: 6, k: 2, r: 30 });
    expect(paths).toHaveLength(2);
    paths.forEach((d) => expect(d.split('L')).toHaveLength(3));
  });

  it('closes every path', () => {
    starPolygon({ n: 9, k: 4, r: 30 }).forEach((d) => expect(d.endsWith('Z')).toBe(true));
  });

  it('visits all n vertices across its cycles', () => {
    const coords = starPolygon({ n: 8, k: 2, r: 30 }).join(' ')
      .replace(/[MLZ]/g, ' ').trim().split(/\s+/);
    expect(new Set(coords).size).toBe(8);
  });
});

describe('starStep', () => {
  it('rejects a step that would draw digons (straight lines, not a star)', () => {
    // {8/4} is four diameters through the centre — the figure that made
    // "Gymnopédie No. 1" render as a broken asterisk.
    expect(starStep(8, 4)).toBe(3);
    expect(8 / gcd(8, starStep(8, 4))).toBeGreaterThanOrEqual(3);
  });

  it('leaves a good step alone', () => {
    expect(starStep(7, 3)).toBe(3);
    expect(starStep(13, 4)).toBe(4);
  });

  it('never returns a degenerate step for any n in range', () => {
    for (let n = 7; n <= 13; n += 1) {
      for (let wanted = 2; wanted <= 4; wanted += 1) {
        const k = starStep(n, wanted);
        expect(k).toBeGreaterThanOrEqual(2);
        expect(n / gcd(n, k)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('petalPath', () => {
  it('starts and ends at the inner radius so the leaf closes on itself', () => {
    const d = petalPath({ inner: 8, outer: 40, width: 0.2, angle: 0 });
    expect(d.startsWith('M58,50')).toBe(true);
    expect(d.endsWith('58,50Z')).toBe(true);
  });
});

describe('rosette', () => {
  it('is deterministic — the same score always draws the same figure', () => {
    expect(rosette('plate:a')).toEqual(rosette('plate:a'));
  });

  it('gives different scores different figures', () => {
    const a = rosette('plate:burgmüller op. 100 no. 01 — la candeur');
    const b = rosette('plate:burgmüller op. 100 no. 02 — l\'arabesque');
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('stays inside the legible range for a thumbnail', () => {
    // Wide sweep on purpose: FNV hashes above 2^31 once went negative through a
    // signed shift and produced k = 1 (no star at all), which a handful of
    // hand-picked seeds missed.
    const seeds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'zzz', 'Ω'];
    for (let i = 0; i < 400; i += 1) seeds.push(`plate:score-${i}`);
    for (const seed of seeds) {
      const r = rosette(seed);
      expect(r.n).toBeGreaterThanOrEqual(7);
      expect(r.n).toBeLessThanOrEqual(13);
      expect(r.k).toBeGreaterThanOrEqual(2);
      expect(r.k).toBeLessThanOrEqual(4);
      expect(r.folds).toBeGreaterThanOrEqual(5);
      expect(r.folds).toBeLessThanOrEqual(8);
      expect(r.petals).toHaveLength(r.folds);
      expect(r.star.length).toBeGreaterThan(0);
      // Every cycle must be a real polygon (≥3 points), never a digon.
      expect(r.n / gcd(r.n, r.k)).toBeGreaterThanOrEqual(3);
      r.star.forEach((d) => expect(d.split('L').length).toBeGreaterThanOrEqual(3));
    }
  });

  it('emits no NaN or negative radii into path data', () => {
    for (let i = 0; i < 200; i += 1) {
      const r = rosette(`plate:seed-${i}`);
      [...r.star, ...r.petals].forEach((d) => expect(d).not.toMatch(/NaN|Infinity/));
      r.rings.forEach((radius) => expect(radius).toBeGreaterThan(0));
      expect(r.centre).toBeGreaterThan(0);
    }
  });
});

describe('plateFor', () => {
  it('combines parsed fields, ink and geometry', () => {
    const p = plateFor('Burgmüller Op. 100 No. 17 — La Babillarde');
    expect(p).toMatchObject({ composer: 'Burgmüller', opus: 100, number: 17, name: 'La Babillarde' });
    expect(p.ink.ink).toBe('#6d4526');
    expect(p.rosette.star.length).toBeGreaterThan(0);
  });

  it('gives a whole opus one ink but distinct figures', () => {
    const one = plateFor('Burgmüller Op. 100 No. 01 — La Candeur');
    const two = plateFor('Burgmüller Op. 100 No. 02 — l\'Arabesque');
    expect(one.ink.ink).toBe(two.ink.ink);
    expect(one.rosette.star.join()).not.toBe(two.rosette.star.join());
  });
});
