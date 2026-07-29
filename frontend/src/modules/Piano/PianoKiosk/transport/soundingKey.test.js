import { soundingKeyLabel } from './soundingKey.js';

describe('soundingKeyLabel', () => {
  it('defers to the written key at 0 offset', () => {
    expect(soundingKeyLabel(0, 'minor', 0)).toBe('A minor');
    expect(soundingKeyLabel(-2, 'major', 0)).toBe('Bb major');
  });
  it('transposes up with sharp-preferring names', () => {
    expect(soundingKeyLabel(0, 'major', 1)).toBe('C# major');   // C + 1
    expect(soundingKeyLabel(2, 'major', 1)).toBe('D# major');   // D + 1
  });
  it('transposes down with flat-preferring names', () => {
    expect(soundingKeyLabel(0, 'major', -1)).toBe('B major');   // C − 1
    expect(soundingKeyLabel(0, 'major', -2)).toBe('Bb major');  // C − 2
  });
  it('handles minor and octave wrap', () => {
    expect(soundingKeyLabel(0, 'minor', 3)).toBe('C minor');    // A + 3
    expect(soundingKeyLabel(0, 'major', 12)).toBe('C major');
  });
  it('returns null when the written key is unknown', () => {
    expect(soundingKeyLabel(undefined, 'major', 2)).toBeNull();
    expect(soundingKeyLabel(9, 'major', 2)).toBeNull();
  });
});
