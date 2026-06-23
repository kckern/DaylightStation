import { describe, it, expect } from 'vitest';
import { applyPianoBodyTheme } from './pianoBodyTheme.js';

describe('applyPianoBodyTheme', () => {
  it('sets a light body background and returns a restore fn', () => {
    document.body.style.backgroundColor = 'black';
    const restore = applyPianoBodyTheme();
    expect(document.body.style.backgroundColor).toMatch(/^(#ffffff|rgb\(255,\s*255,\s*255\))$/i);
    restore();
    expect(document.body.style.backgroundColor).toBe('black');
  });
});
