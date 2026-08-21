import { describe, it, expect } from 'vitest';
import {
  NATIONALITY_COUNTRY,
  birthCountryFor,
  countryCaptionFor,
  cityCaptionFor,
  eraCaptionFor,
  yearsIn,
} from './placeCaption.js';

/**
 * The corpus these are written against: 354 `_composer.yml` files carrying
 * `nationality`, `birthplace`, `born`, `died` and `map` at 100% coverage, and
 * `map.caption` at 349/354. The fixtures below are real rows out of it — Chopin
 * the emigre, Bach the native, Handel the naturalised, Hildegard the one whose
 * city name is three words long.
 */
const CHOPIN = {
  name: 'Frederic Chopin',
  born: 1810,
  died: 1849,
  birthplace: 'Zelazowa Wola',
  nationality: 'Polish-French',
  map: {
    country: 'France',
    city: 'Paris',
    caption: 'Paris — he arrived at twenty-one and never went home',
  },
};
const BACH = {
  name: 'Johann Sebastian Bach',
  born: 1685,
  died: 1750,
  birthplace: 'Eisenach',
  nationality: 'German',
  map: { country: 'Germany', city: 'Leipzig' },
};

describe('placeCaption — the nationality table', () => {
  it('resolves the adjective the corpus authors to the country the map names', () => {
    expect(birthCountryFor('Polish')).toBe('Poland');
    expect(birthCountryFor('German')).toBe('Germany');
    expect(birthCountryFor('English')).toBe('United Kingdom');
    expect(birthCountryFor('American')).toBe('United States');
    expect(birthCountryFor('Dutch')).toBe('Netherlands');
  });

  it('takes the FIRST adjective of a compound as the birth nationality', () => {
    // "Polish-French" is a life in two halves and the corpus writes it origin
    // first. The map draws the second half; the caption exists to name the first.
    expect(birthCountryFor('Polish-French')).toBe('Poland');
    expect(birthCountryFor('Russian-American')).toBe('Russia');
    expect(birthCountryFor('Hungarian-Austrian')).toBe('Hungary');
  });

  it('names a country for every adjective the corpus actually carries', () => {
    // The table is an allowlist, so a corpus adjective missing from it is a
    // caption silently downgraded. These are the ones in the library today.
    const authored = [
      'American', 'Argentine', 'Armenian', 'Australian', 'Austrian', 'Belgian',
      'Bohemian', 'Brazilian', 'British', 'Canadian', 'Catalan', 'Chinese',
      'Czech', 'Danish', 'Dutch', 'English', 'Estonian', 'Finnish', 'Flemish',
      'French', 'German', 'Greek', 'Hungarian', 'Irish', 'Italian',
      'Japanese', 'Korean', 'Liechtensteiner', 'Mexican', 'Norwegian', 'Polish',
      'Romanian', 'Russian', 'Scottish', 'South African', 'Soviet', 'Spanish',
      'Swedish', 'Swiss', 'Tatar', 'Venezuelan',
    ];
    for (const adjective of authored) {
      expect(NATIONALITY_COUNTRY[adjective], adjective).toBeTruthy();
    }
  });

  it('refuses "Franco-Flemish", which is a school and not a birth country', () => {
    // Seven composers are authored this way and five of them were born in what
    // is now Belgium — Ghent, Namur, Mons, Beersel, Saint-Ghislain. Reading the
    // first word would print "Born in Ghent, France." under a map of Spain.
    expect(birthCountryFor('Franco-Flemish')).toBeNull();
    expect(countryCaptionFor({
      birthplace: 'Ghent', nationality: 'Franco-Flemish',
      map: { country: 'Spain', city: 'Madrid' },
    }).text).toBe('Worked in Spain; born in Ghent.');
  });

  it('refuses to guess where the corpus is not naming a nationality', () => {
    // "Anonymous" is a real value in the medieval corpus, and a parenthetical
    // ("French (Italian born)") contradicts the very thing the table would
    // conclude from its first word. Both must decline rather than assert.
    expect(birthCountryFor('Anonymous')).toBeNull();
    expect(birthCountryFor('French (Italian born)')).toBeNull();
    expect(birthCountryFor('')).toBeNull();
    expect(birthCountryFor(null)).toBeNull();
  });
});

describe('placeCaption — the country slide', () => {
  it('names the move for a composer who left: origin, then the country drawn', () => {
    // The whole reason the plate has France lit for a Pole. Nothing else in the
    // frame says this — the card prints the birthplace with no country beside it.
    expect(countryCaptionFor(CHOPIN)).toEqual({
      text: 'Born in Zelazowa Wola, Poland; worked in France.',
      kind: 'sentence',
    });
  });

  it('puts the article in front of the countries that take one', () => {
    const handel = {
      birthplace: 'Halle', nationality: 'German-English',
      map: { country: 'United Kingdom', city: 'London' },
    };
    expect(countryCaptionFor(handel).text)
      .toBe('Born in Halle, Germany; worked in the United Kingdom.');
  });

  it('ties the card’s birthplace INTO the shape for a composer who stayed', () => {
    // Not a restatement of the card: the card writes "Eisenach" with nothing to
    // locate it, and this is the line that puts it inside the lit country.
    expect(countryCaptionFor(BACH)).toEqual({
      text: 'Born in Eisenach, Germany.',
      kind: 'sentence',
    });
  });

  it('states the relation without claiming a birth country it cannot derive', () => {
    const anon = {
      birthplace: 'Notre-Dame de Paris', nationality: 'Anonymous',
      map: { country: 'France', city: 'Paris' },
    };
    expect(countryCaptionFor(anon)).toEqual({
      text: 'Worked in France; born in Notre-Dame de Paris.',
      kind: 'sentence',
    });
  });

  it('falls back to the bare country label when there is no biography at all', () => {
    // The wave-3 behaviour, kept as the floor: a slide is never left uncaptioned.
    expect(countryCaptionFor({ map: { country: 'Italy', city: 'Venice' } }))
      .toEqual({ text: 'Italy', kind: 'label' });
  });

  it('captions nothing when no country is pinned', () => {
    expect(countryCaptionFor({ birthplace: 'Venice', nationality: 'Italian' })).toBeNull();
    expect(countryCaptionFor(null)).toBeNull();
  });
});

describe('placeCaption — the city slide', () => {
  it('gives the city plate the authored sentence, which 349 of 354 composers have', () => {
    expect(cityCaptionFor(CHOPIN)).toEqual({
      text: 'Paris — he arrived at twenty-one and never went home',
      kind: 'sentence',
    });
  });

  it('leaves the sentence to the photograph when there IS one, so it is never shown twice', () => {
    expect(cityCaptionFor(CHOPIN, { photoTookCaption: true }))
      .toEqual({ text: 'Paris', kind: 'label' });
  });

  it('falls back to the city name where nothing is authored', () => {
    expect(cityCaptionFor(BACH)).toEqual({ text: 'Leipzig', kind: 'label' });
    expect(cityCaptionFor({ map: { city: 'Leipzig', caption: '   ' } }))
      .toEqual({ text: 'Leipzig', kind: 'label' });
  });

  it('captions nothing with no city and no sentence', () => {
    expect(cityCaptionFor({ map: { country: 'Germany' } })).toBeNull();
    expect(cityCaptionFor(null)).toBeNull();
  });
});

describe('placeCaption — the era slide', () => {
  it('reads the years out of whatever dating the corpus authored', () => {
    expect(yearsIn('1829-1839')).toEqual([1829, 1839]);
    expect(yearsIn('1839')).toEqual([1839]);
    expect(yearsIn('c. 1755')).toEqual([1755]);
    expect(yearsIn('by 1725')).toEqual([1725]);
    expect(yearsIn('mid-15th century (exact date unknown)')).toEqual([]);
  });

  it('locates the work in the LIFE, which the dial of centuries cannot show', () => {
    // Chopin's Etudes: the plate stands the marker at 1839 among four eras. What
    // it cannot say is that the set runs from a boy of nineteen to a man of
    // twenty-nine — half his working life in one caption.
    expect(eraCaptionFor({ composed: '1829-1839', year: 1839, city: 'Paris' }, CHOPIN)).toEqual({
      text: 'Composed 1829–1839, aged 19 to 29.',
      kind: 'sentence',
    });
  });

  it('leads with where it was written when that is not where the composer lived', () => {
    // The Preludes were finished in a Majorcan monastery. The two map slides
    // just drew France and Paris; this is the slide that can say otherwise.
    expect(eraCaptionFor({ composed: '1835-1839', year: 1839, city: 'Majorca' }, CHOPIN).text)
      .toBe('Written at Majorca — 1835–1839, aged 25 to 29.');
  });

  it('says one age for a work of one year', () => {
    expect(eraCaptionFor({ composed: '1839', year: 1839, city: 'Paris' }, CHOPIN).text)
      .toBe('Composed 1839, aged 29.');
  });

  it('keeps the author’s own hedge on a dating, in the house dash', () => {
    expect(eraCaptionFor({ composed: 'c. 1802-1817', year: 1810, city: 'Leipzig' }, BACH).text)
      .toContain('c. 1802–1817');
  });

  it('drops the age rather than print an absurd one', () => {
    // A work dated before its composer was born, or four hundred years after —
    // a corpus typo, and the caption must not repeat it as biography.
    expect(eraCaptionFor({ composed: '1650', year: 1650 }, CHOPIN).text).toBe('1650');
    expect(eraCaptionFor({ composed: '1990', year: 1990 }, BACH).text).toBe('1990');
  });

  it('falls back to the bare dating with no composer to measure against', () => {
    // The wave-6 behaviour, kept: the label register, the authored range.
    expect(eraCaptionFor({ composed: '1803-1804', year: 1804 }, null))
      .toEqual({ text: '1803–1804', kind: 'label' });
    expect(eraCaptionFor({ year: 1725 }, null)).toEqual({ text: '1725', kind: 'label' });
  });

  it('captions nothing when the piece is dated nowhere at all', () => {
    expect(eraCaptionFor({ period: 'Baroque' }, BACH)).toBeNull();
    expect(eraCaptionFor(null, BACH)).toBeNull();
  });
});
