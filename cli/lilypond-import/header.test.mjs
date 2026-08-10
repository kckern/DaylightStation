import { describe, it, expect } from 'vitest';
import {
  parseHeader, composerName, opusLabel, numberFromPath, scoreBasename, provenance, trimSetPrefix,
} from './header.mjs';

const BURG = `\\header {
  title             = "La Candeur"
  composer          = "Johann Friedrich Franz Burgmüller (1806-1874)"
  opus              = "Opus 100."
  mutopiatitle      = "La Candeur"
  mutopiacomposer   = "BurgmullerJFF"
  style             = "Romantic"
  license           = "Public Domain"
  maintainer        = "Bas Wassink"
  tagline = \\markup { \\override #'(box-padding . 1.0) \\box "junk" }
}`;

const CLEM = `\\header {
title = "Sonatina"  composer = " M. Clementi, Opus 36 No. 1"
mutopiatitle = "Sonatina"
mutopiacomposer = "ClementiM"
mutopiaopus = "O 36"
license = "Public Domain"
}`;

describe('parseHeader', () => {
  it('reads quoted scalars', () => {
    const h = parseHeader(BURG);
    expect(h.title).toBe('La Candeur');
    expect(h.mutopiacomposer).toBe('BurgmullerJFF');
  });

  it('drops \\markup-valued keys like tagline rather than capturing engraving junk', () => {
    expect(parseHeader(BURG).tagline).toBeUndefined();
  });

  it('handles two assignments sharing a line', () => {
    const h = parseHeader(CLEM);
    expect(h.title).toBe('Sonatina');
    expect(h.composer).toBe('M. Clementi, Opus 36 No. 1'); // values are trimmed
  });

  it('returns {} when there is no header', () => {
    expect(parseHeader('\\version "2.18.2"')).toEqual({});
  });
});

describe('composerName', () => {
  it('uses the alias table for accented surnames', () => {
    expect(composerName({ mutopiacomposer: 'BurgmullerJFF' })).toBe('Burgmüller');
  });

  it('strips trailing initials from unknown ids', () => {
    expect(composerName({ mutopiacomposer: 'HandelGF' })).toBe('Handel');
  });

  it('falls back to the free-text composer field', () => {
    expect(composerName({ composer: 'Erik Satie, 1888' })).toBe('Erik Satie');
  });
});

describe('opusLabel', () => {
  it('normalizes Mutopia opus spellings', () => {
    expect(opusLabel({ mutopiaopus: 'O 36' })).toBe('Op. 36');
    expect(opusLabel({ opus: 'Opus 100.' })).toBe('Op. 100');
  });

  it('is null when there is no opus', () => {
    expect(opusLabel({})).toBeNull();
  });
});

describe('numberFromPath', () => {
  it('prefers the trailing number so mid-name digits lose', () => {
    expect(numberFromPath('SchumannR/O68/schumann-op68-01-melodie/x.ly')).toBe(1);
    expect(numberFromPath('BurgmullerJFF/O100/25EF-07/25EF-07.ly')).toBe(7);
    expect(numberFromPath('ClementiM/O36/sonatina-3/sonatina-3.ly')).toBe(3);
  });

  it('is null when the path carries no number', () => {
    expect(numberFromPath('BachJS/air/air.ly')).toBeNull();
  });
});

describe('trimSetPrefix', () => {
  it('drops the repeated collection prefix and its number', () => {
    expect(trimSetPrefix('Album pour la jeunesse - 1.Mélodie')).toBe('Mélodie');
    expect(trimSetPrefix('Album pour la jeunesse - 12.Le Père Fouettard')).toBe('Le Père Fouettard');
  });

  it('leaves a plain title alone', () => {
    expect(trimSetPrefix('La Candeur')).toBe('La Candeur');
    expect(trimSetPrefix('Sonatina')).toBe('Sonatina');
  });

  it('keeps the original when stripping would leave nothing', () => {
    expect(trimSetPrefix('Album pour la jeunesse - 26.')).toBe('Album pour la jeunesse - 26.');
  });
});

describe('scoreBasename', () => {
  it('zero-pads the number so graded order survives alphabetical sorting', () => {
    const header = parseHeader(BURG);
    const two = scoreBasename({ header, sourcePath: 'x/25EF-02/25EF-02.ly' });
    const ten = scoreBasename({ header, sourcePath: 'x/25EF-10/25EF-10.ly' });
    expect(two).toContain('No. 02');
    expect([ten, two].sort()).toEqual([two, ten]); // 02 sorts before 10
  });

  it('names a single-movement piece without a movement suffix', () => {
    expect(scoreBasename({ header: parseHeader(BURG), sourcePath: 'x/25EF-01/25EF-01.ly' }))
      .toBe('Burgmüller Op. 100 No. 01 — La Candeur');
  });

  it('adds a roman-numeral movement suffix with its tempo hint', () => {
    const header = parseHeader(CLEM);
    const name = scoreBasename({
      header, sourcePath: 'x/sonatina-1/sonatina-1.ly', movementIndex: 0, movementCount: 3, hint: 'Spiritoso',
    });
    expect(name).toBe('Clementi Op. 36 No. 01 — Sonatina (I. Spiritoso)');
  });

  it('still numbers the movement when there is no hint', () => {
    const name = scoreBasename({
      header: parseHeader(CLEM), sourcePath: 'x/sonatina-1/s.ly', movementIndex: 2, movementCount: 3, hint: null,
    });
    expect(name).toMatch(/\(III\)$/);
  });

  it('omits the title entirely when the piece is untitled', () => {
    // Schumann Op.68 No.26 is titled "* * * * *" — nothing survives sanitizing.
    const header = { mutopiatitle: 'Album pour la jeunesse - 26. * * * * * ', mutopiacomposer: 'SchumannR', mutopiaopus: 'O 68' };
    expect(scoreBasename({ header, sourcePath: 'x/schumann-op68-26/x.ly' }))
      .toBe('Schumann Op. 68 No. 26');
  });

  it('never emits a path separator', () => {
    const name = scoreBasename({ header: { title: 'A/B', mutopiacomposer: 'X' }, sourcePath: 'p/1/x.ly' });
    expect(name).not.toMatch(/[/\\]/);
  });
});

describe('provenance', () => {
  it('records licence and origin for traceability', () => {
    const p = provenance({ header: parseHeader(BURG), sourcePath: 'a/b.ly', sourceUrl: 'https://x/b.ly' });
    expect(p).toMatchObject({
      title: 'La Candeur', composer: 'Burgmüller', opus: 'Op. 100',
      license: 'Public Domain', maintainer: 'Bas Wassink', sourceUrl: 'https://x/b.ly',
    });
  });

  it('defaults the licence to Public Domain for Mutopia sources', () => {
    expect(provenance({ header: {}, sourcePath: 'a.ly' }).license).toBe('Public Domain');
  });
});
