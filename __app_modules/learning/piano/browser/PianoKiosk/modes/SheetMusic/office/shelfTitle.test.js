import { describe, it, expect } from 'vitest';
import { shelfTitle } from './shelfTitle.js';

describe('shelfTitle (a printed title set as a title on a card)', () => {
  it('capitalises a title the file left lowercase, keeping the small words small', () => {
    expect(shelfTitle('Santa Claus is coming to town')).toBe('Santa Claus Is Coming to Town');
    expect(shelfTitle('twinkle twinkle little star')).toBe('Twinkle Twinkle Little Star');
    expect(shelfTitle('the girl from ipanema')).toBe('The Girl from Ipanema');
  });

  it('never lowers a capital the title has, nor touches accents or catalogue numbers', () => {
    expect(shelfTitle('Minuet in G major, BWV Anh. 114')).toBe('Minuet in G Major, BWV Anh. 114');
    expect(shelfTitle('Gymnopédie No. 1')).toBe('Gymnopédie No. 1');
    expect(shelfTitle('Für Elise')).toBe('Für Elise');
    expect(shelfTitle('étude in c minor')).toBe('Étude in C Minor');
  });

  it('capitalises a word after a bracket or a colon start, and leaves an empty title empty', () => {
    expect(shelfTitle('Hallelujah (from the messiah)')).toBe('Hallelujah (From the Messiah)');
    expect(shelfTitle('')).toBe('');
    expect(shelfTitle(null)).toBe('');
  });
});
