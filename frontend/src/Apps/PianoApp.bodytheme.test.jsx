import { describe, it, expect } from 'vitest';
import { applyPianoBodyTheme } from './pianoBodyTheme.js';

describe('applyPianoBodyTheme', () => {
  it('sets the charcoal body background and returns a restore fn', () => {
    document.body.style.backgroundColor = 'black';
    const restore = applyPianoBodyTheme();
    expect(document.body.style.backgroundColor).toMatch(/^(#16161b|rgb\(22,\s*22,\s*27\))$/i);
    restore();
    expect(document.body.style.backgroundColor).toBe('black');
  });
});
