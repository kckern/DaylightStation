import { describe, it, expect } from 'vitest';
import { mapPinFrom } from './countryMapPayload.js';

describe('mapPinFrom — piece/composer fallback', () => {
  it('prefers the piece’s own map over the composer’s', () => {
    const data = {
      piece: { map: { country: 'Italy', city: 'Padua', lat: 45.41, lon: 11.88 } },
      composer: { map: { country: 'United Kingdom', city: 'Stratford-upon-Avon', lat: 52.19, lon: -1.71 } },
    };
    expect(mapPinFrom(data)).toEqual({
      country: 'Italy', city: 'Padua', lat: 45.41, lon: 11.88, source: 'piece',
    });
  });

  it('falls back to the composer’s map when the piece authors none', () => {
    const data = { composer: { map: { country: 'United Kingdom', city: 'Stratford-upon-Avon', lat: 52.19, lon: -1.71 } } };
    expect(mapPinFrom(data)).toEqual({
      country: 'United Kingdom', city: 'Stratford-upon-Avon', lat: 52.19, lon: -1.71, source: 'composer',
    });
  });

  it('returns null when neither authors a map', () => {
    expect(mapPinFrom({})).toBeNull();
  });

  it('returns null when the piece map has no country, even with a composer map absent too', () => {
    expect(mapPinFrom({ piece: { map: { city: 'Padua' } } })).toBeNull();
  });
});
