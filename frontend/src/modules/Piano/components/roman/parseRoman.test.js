import { describe, it, expect } from 'vitest';
import { parseRoman } from './parseRoman.js';

describe('parseRoman', () => {
  it('splits accidental, numeral, quality and figure', () => {
    expect(parseRoman('bVII')).toEqual({ accidental: '♭', numeral: 'VII', quality: 'major', figure: '', isMinor: false });
    expect(parseRoman('ii')).toEqual({ accidental: '', numeral: 'ii', quality: 'minor', figure: '', isMinor: true });
    expect(parseRoman('vii°')).toEqual({ accidental: '', numeral: 'vii', quality: 'dim', figure: '', isMinor: true });
    expect(parseRoman('V7')).toEqual({ accidental: '', numeral: 'V', quality: 'major', figure: '7', isMinor: false });
    expect(parseRoman('imaj7')).toEqual({ accidental: '', numeral: 'i', quality: 'minor', figure: 'maj7', isMinor: true });
  });
  it('renders # as ♯ and returns a placeholder for junk', () => {
    expect(parseRoman('#IV').accidental).toBe('♯');
    expect(parseRoman('?')).toEqual({ accidental: '', numeral: '·', quality: 'unknown', figure: '', isMinor: false });
  });
});
