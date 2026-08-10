import { describe, it, expect } from 'vitest';
import { prettyTitle, titleFromScoreId } from './scoreTitle.js';

describe('scoreTitle', () => {
  it('prettifies filename-derived titles', () => {
    expect(prettyTitle('fur-elise-super_easy.mxl')).toBe('Fur Elise Super Easy');
    expect(prettyTitle('')).toBe('Score');
  });

  it('leaves an already-real title alone, accents and all', () => {
    // `\b\w` treats an accent as a non-word char, so title-casing a real title
    // capitalised the letter AFTER it. That mangled the display name and broke
    // the composer lookup behind the score plates' per-composer ink.
    expect(prettyTitle('Burgmüller Op. 100 No. 01 — La Candeur'))
      .toBe('Burgmüller Op. 100 No. 01 — La Candeur');
    expect(prettyTitle('La Petite Réunion')).toBe('La Petite Réunion');
    expect(prettyTitle('Progrès')).toBe('Progrès');
    expect(prettyTitle("l'Arabesque")).toBe("l'Arabesque");
  });

  it('still strips the extension from a real title', () => {
    expect(prettyTitle('La Chasse.musicxml')).toBe('La Chasse');
  });

  it('still title-cases a single-word slug', () => {
    expect(prettyTitle('gymnopedie.mxl')).toBe('Gymnopedie');
  });
  it('derives a title from a full content id', () => {
    expect(titleFromScoreId('files:docs/sheet-music/video-games/super-mario-theme.mxl')).toBe('Super Mario Theme');
    expect(titleFromScoreId('')).toBe('Score');
  });
});
