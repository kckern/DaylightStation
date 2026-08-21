// frontend/src/modules/Surround/placeCaption.js
//
// WHAT THE CAPTION UNDER A PLATE IS FOR — and the wave-11 finding that it was
// not doing it.
//
// The place carousel draws four plates and wrote a caption under each of them:
// "FRANCE" under a map with FRANCE lettered across the shape, "PARIS" under a
// map with a star already labelled PARIS, and "1829-1839" under a dial with a
// brass 1839 hanging off it. Three captions, three restatements. A caption that
// repeats its picture is not neutral — it is the one line of the slide a viewer
// reads first, spent saying nothing.
//
// The corpus was already carrying the answer. Every `_composer.yml` in the
// classical library (354 of them) has `nationality`, `birthplace`, `born` and
// `died`; 349 have an authored `map.caption` — a human sentence about the place
// ("Paris — he arrived at twenty-one and never went home; his heart was
// returned to Warsaw"). That sentence was reachable from ONE slide, the city
// photograph, and `city_image` exists for SEVEN composers. The best line in the
// corpus was authored for everybody and shown to almost nobody.
//
// So this module derives, per plate, the thing the plate cannot draw:
//
//   COUNTRY PLATE  the composer's relation to the country that is lit. Chopin is
//                  Polish and the map shows France, and nothing else in the
//                  frame says why — the card prints "Zelazowa Wola" with no
//                  country beside it and never prints the nationality at all.
//   CITY PLATE     the authored sentence, at last, unless the photograph took it.
//   ERA PLATE      the work's place in the LIFE. The dial spans 1550-1910 and
//                  cannot show that a set of etudes runs from a boy of nineteen
//                  to a man of twenty-nine; a caption can, from `born` and the
//                  dating the piece already carries.
//
// EVERY LINE IS DERIVED FROM DATA THAT IS ALREADY THERE. Nothing here asks the
// corpus for a new field, which is the whole reason it can ship to 354
// composers at once rather than to the seven with photographs.
//
// TWO RULES THE PHRASING KEEPS:
//   * NO PRONOUNS. The corpus has no gender field and never will need one for
//     this: "Born in Eisenach, Germany." works for Bach and for Hildegard,
//     and "he was born" would be a guess with a 50% failure mode.
//   * NO CLAIM THAT CANNOT BE DERIVED. Where the nationality table has never
//     heard of an adjective — "Anonymous", or a parenthetical like "French
//     (Italian born)" whose first word contradicts its own note — the caption
//     states the relation it CAN stand behind and stops.

import { trimmed } from './typography.js';

/**
 * The nationality adjective the corpus authors -> the country name the map
 * block authors. Both halves are the corpus's own vocabulary, which is why this
 * is a table rather than a rule: `map.country` is "United Kingdom", and the
 * composers working there are authored English, Scottish and British.
 *
 * AN ALLOWLIST, and deliberately: an adjective missing from it downgrades one
 * caption to a safer sentence, where a wrong guess would print a false
 * biography under a map. `names a country for every adjective the corpus
 * actually carries` is the test that keeps it in step with the library.
 *
 * THREE OF THESE ARE EDITORIAL CALLS, made here once rather than argued in four
 * places: Bohemian -> Czechia and Soviet -> Russia are the modern states over
 * the historical ones the corpus names, because the map is drawn from modern
 * borders and a caption naming a country the plate cannot show is worse than a
 * caption naming its successor. Catalan -> Spain and Flemish -> Belgium are the
 * same call about regions.
 */
export const NATIONALITY_COUNTRY = Object.freeze({
  American: 'United States',
  Argentine: 'Argentina',
  Armenian: 'Armenia',
  Australian: 'Australia',
  Austrian: 'Austria',
  Belgian: 'Belgium',
  Bohemian: 'Czechia',
  Brazilian: 'Brazil',
  British: 'United Kingdom',
  Canadian: 'Canada',
  Catalan: 'Spain',
  Chinese: 'China',
  Czech: 'Czechia',
  Danish: 'Denmark',
  Dutch: 'Netherlands',
  English: 'United Kingdom',
  Estonian: 'Estonia',
  Finnish: 'Finland',
  Flemish: 'Belgium',
  // NO `Franco`, and it is the one omission worth a line of its own. Seven
  // composers are authored "Franco-Flemish", which is a SCHOOL and not a birth
  // nationality, and taking its first word would put Ghent, Namur, Mons,
  // Beersel and Saint-Ghislain in France — five false birth countries out of
  // seven, all of them in modern Belgium. With the adjective absent the caption
  // drops to the relation it can stand behind and names no country of birth.
  French: 'France',
  German: 'Germany',
  Greek: 'Greece',
  Hungarian: 'Hungary',
  Irish: 'Ireland',
  Italian: 'Italy',
  Japanese: 'Japan',
  Korean: 'South Korea',
  Liechtensteiner: 'Liechtenstein',
  Mexican: 'Mexico',
  Norwegian: 'Norway',
  Polish: 'Poland',
  Portuguese: 'Portugal',
  Romanian: 'Romania',
  Russian: 'Russia',
  Scottish: 'United Kingdom',
  'South African': 'South Africa',
  Soviet: 'Russia',
  Spanish: 'Spain',
  Swedish: 'Sweden',
  Swiss: 'Switzerland',
  Tatar: 'Russia',
  Venezuelan: 'Venezuela',
  Welsh: 'United Kingdom',
});

/**
 * The country names that take a definite article in the middle of a sentence.
 * "worked in United Kingdom" is the one thing that would make these captions
 * read as generated rather than written.
 */
const ARTICLE_COUNTRIES = Object.freeze(new Set([
  'United Kingdom', 'United States', 'Netherlands', 'Czech Republic', 'Philippines',
]));

const withArticle = (country) => (ARTICLE_COUNTRIES.has(country) ? `the ${country}` : country);

/**
 * The country a composer was BORN in, from the authored nationality — or null
 * where that cannot be stood behind.
 *
 * The corpus writes a life in two countries origin-first ("Polish-French",
 * "Russian-American", "Hungarian-Austrian"), so the first adjective is the
 * birth one and the map draws the second. A parenthetical is refused outright:
 * "French (Italian born)" would resolve to France on its first word and its own
 * note says otherwise.
 */
export function birthCountryFor(nationality) {
  const text = trimmed(nationality);
  if (!text) return null;
  if (text.includes('(')) return null;
  const first = text.split(/[-–—]/)[0].trim();
  return NATIONALITY_COUNTRY[first] ?? null;
}

/**
 * THE COUNTRY PLATE — "why is this country the one that is lit".
 *
 * Three answers, in descending order of what can be derived:
 *   1. the origin country is known and is NOT the one drawn: the move, which is
 *      the single most interesting fact about a map of France for a Pole;
 *   2. the origin country is the one drawn: the birthplace tied INTO the lit
 *      shape. This is not the card repeating itself — the card writes the
 *      birthplace with nothing to locate it by;
 *   3. no origin can be derived: the relation to the drawn country, and the
 *      birthplace as a bare place, with no claim about where it is.
 *
 * The floor under all three is wave 3's own caption, the bare country label, so
 * a composer with no biography at all still gets a captioned plate.
 *
 * @param {object|null} composer the surround payload's composer block.
 * @returns {{text: string, kind: 'sentence'|'label'}|null}
 */
export function countryCaptionFor(composer) {
  const country = trimmed(composer?.map?.country);
  if (!country) return null;

  const birthplace = trimmed(composer?.birthplace);
  const origin = birthCountryFor(composer?.nationality);
  const here = withArticle(country);

  // "Born in Halle, Germany" — the museum plate's own construction, and the
  // reason it is `in` and a comma rather than `at ... in ...`: the corpus
  // birthplaces are not all towns. One of them is "Western Europe" (the
  // plainchant entry, which is a tradition rather than a person) and another is
  // "Picardy (region)", and "born at Western Europe" is the kind of sentence
  // that tells a viewer a machine wrote it.
  if (origin && origin !== country) {
    return {
      text: birthplace
        ? `Born in ${birthplace}, ${origin}; worked in ${here}.`
        : `Born in ${withArticle(origin)}; worked in ${here}.`,
      kind: 'sentence',
    };
  }
  if (origin && birthplace) {
    return { text: `Born in ${birthplace}, ${country}.`, kind: 'sentence' };
  }
  if (birthplace) {
    return { text: `Worked in ${here}; born in ${birthplace}.`, kind: 'sentence' };
  }
  return { text: country, kind: 'label' };
}

/**
 * THE CITY PLATE — the authored sentence, which is what this whole module
 * exists to get onto a plate somebody will actually see.
 *
 * `map.caption` is a human line about the place and it is authored for 349 of
 * the library's 354 composers. Before wave 11 it could only appear under the
 * city PHOTOGRAPH, and `city_image` exists for seven of them.
 *
 * @param {object|null} composer
 * @param {object} [opts]
 * @param {boolean} [opts.photoTookCaption] true when this carousel is also
 *   showing a photo slide, which keeps the sentence — the photograph is the
 *   better plate for it, and one line under two plates twelve seconds apart
 *   reads as a bug rather than as emphasis.
 * @returns {{text: string, kind: 'sentence'|'label'}|null}
 */
export function cityCaptionFor(composer, { photoTookCaption = false } = {}) {
  const authored = trimmed(composer?.map?.caption);
  const city = trimmed(composer?.map?.city);
  if (authored && !photoTookCaption) return { text: authored, kind: 'sentence' };
  if (city) return { text: city, kind: 'label' };
  return null;
}

/**
 * Every four-digit year in an authored dating, in the order written.
 *
 * The corpus's `composed` is mostly "1839" or "1829-1839", with a long tail of
 * "c. 1755", "by 1725", "c. 1690s" and a handful of prose ("mid-15th century
 * (exact date unknown)"). Anything that yields no four-digit year yields no
 * ages, which is the correct outcome — the caption keeps the author's words and
 * drops the arithmetic.
 */
export function yearsIn(text) {
  const matches = String(text ?? '').match(/\b\d{4}\b/g);
  return matches ? matches.map(Number) : [];
}

/** The house dash for a range of years — the same call `datelineFor` makes. */
const enDash = (text) => String(text).replace(/(\d)\s*-\s*(\d)/g, '$1–$2');

/** An age is only an age if a person could have been that old and composing. */
const plausibleAge = (age) => Number.isFinite(age) && age >= 5 && age <= 105;

/**
 * THE ERA PLATE — the work in the composer's life, not on the dial again.
 *
 * The dial already draws four centuries with the year hung on it in brass, and
 * the plate's own note names the era. What none of that can show is how old the
 * composer was, which is the difference between "a Romantic piano work" and "a
 * set begun at nineteen and finished at twenty-nine".
 *
 * WHERE IT WAS WRITTEN LEADS, when that is not where the composer lived. Two
 * slides have just drawn France and Paris; the Preludes were finished in a
 * Majorcan monastery, and this is the only plate in the carousel that can say
 * so. It is suppressed when the two agree, because then it is the city slide
 * again.
 *
 * The floor is wave 6's caption — the authored dating, in the label register —
 * for a piece whose composer is unknown to the payload or whose dating the
 * arithmetic cannot read.
 *
 * @param {object|null} piece  the payload's piece block (`composed`, `year`, `city`).
 * @param {object|null} composer the payload's composer block (`born`, `map.city`).
 * @returns {{text: string, kind: 'sentence'|'label'}|null}
 */
export function eraCaptionFor(piece, composer) {
  const composed = trimmed(piece?.composed);
  const year = Number(piece?.year);
  const dating = composed ?? (Number.isFinite(year) ? String(year) : null);
  if (!dating) return null;

  const dates = enDash(dating);
  const born = Number(composer?.born);
  const years = yearsIn(dating);
  const first = years.length ? years[0] - born : NaN;
  const last = years.length ? years[years.length - 1] - born : NaN;
  const aged = Number.isFinite(born) && plausibleAge(first) && plausibleAge(last) && last >= first
    ? (first === last ? `aged ${first}` : `aged ${first} to ${last}`)
    : null;

  const city = trimmed(piece?.city);
  const home = trimmed(composer?.map?.city);
  const elsewhere = city && city !== home ? city : null;

  if (elsewhere && aged) return { text: `Written at ${elsewhere} — ${dates}, ${aged}.`, kind: 'sentence' };
  if (elsewhere) return { text: `Written at ${elsewhere} — ${dates}.`, kind: 'sentence' };
  if (aged) return { text: `Composed ${dates}, ${aged}.`, kind: 'sentence' };
  return { text: dates, kind: 'label' };
}
