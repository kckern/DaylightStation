import { describe, it, expect } from 'vitest';
import { smartQuotes, smartQuotesAll } from './typography.js';

/**
 * The ambiguous cases are the whole point of this file. A regex that turns every
 * `'` into `’` gets `dell'armonia` right and `'Spring'` wrong; one that pairs
 * them gets `'Spring'` right and `'Tis` wrong. Each block below is one of the
 * decisions the state machine has to make, tested against strings that are
 * either verbatim from the corpus (marked) or the minimal shape of a case the
 * corpus could grow.
 */
describe('smartQuotes — apostrophes', () => {
  it('curls a contraction', () => {
    expect(smartQuotes("don't")).toBe('don’t');
  });

  it('curls an elided vowel inside a word — the real Vivaldi fact', () => {
    // Verbatim: data/content/library/classical/vivaldi/four-seasons-spring.yml
    expect(smartQuotes("Il cimento dell'armonia e dell'inventione"))
      .toBe('Il cimento dell’armonia e dell’inventione');
  });

  it('curls a singular possessive — the real Vivaldi note', () => {
    expect(smartQuotes("A shepherd's dance.")).toBe('A shepherd’s dance.');
  });

  it('curls a PLURAL possessive, where the mark follows the word and precedes a space', () => {
    // Verbatim: the Eroica's second-segment listening note.
    expect(smartQuotes("Basses mutter like muffled drums beneath the violins' grief"))
      .toBe('Basses mutter like muffled drums beneath the violins’ grief');
  });

  it('curls a leading elision rather than opening a quotation', () => {
    expect(smartQuotes("'Tis the season")).toBe('’Tis the season');
    expect(smartQuotes("rock 'n' roll")).toBe('rock ’n’ roll');
  });

  it('curls an elided year', () => {
    expect(smartQuotes("the '90s")).toBe('the ’90s');
  });

  it('curls a lone leading tick closed — an unclosed quotation is the unlikelier reading', () => {
    expect(smartQuotes("'twixt")).toBe('’twixt');
  });
});

describe('smartQuotes — quotation marks', () => {
  it('pairs double quotes — the real Vivaldi title', () => {
    // Verbatim: the `title:` of four-seasons-spring.yml.
    expect(smartQuotes('Violin Concerto in E major, "Spring"'))
      .toBe('Violin Concerto in E major, “Spring”');
  });

  it('pairs the Eroica title the same way', () => {
    expect(smartQuotes('Symphony No. 3 in E-flat major, "Eroica"'))
      .toBe('Symphony No. 3 in E-flat major, “Eroica”');
  });

  it('pairs single quotes around a nickname — the real Vivaldi listening note', () => {
    // Verbatim: "…Vivaldi marked the part 'the dog that barks'."
    expect(smartQuotes("Vivaldi marked the part 'the dog that barks'."))
      .toBe('Vivaldi marked the part ‘the dog that barks’.');
  });

  it('nests single inside double', () => {
    expect(smartQuotes(`He said "the part is marked 'the dog that barks'" and left`))
      .toBe('He said “the part is marked ‘the dog that barks’” and left');
  });

  it('leaves a possessive INSIDE a quotation without closing it', () => {
    expect(smartQuotes("'the dog's bark' is marked in the score"))
      .toBe('‘the dog’s bark’ is marked in the score');
  });

  it('curls a possessive that follows a closing single quote', () => {
    expect(smartQuotes("'Spring's opening bars"))
      .toBe('‘Spring’s opening bars');
  });

  it('opens a double quote after a dash or bracket, not only after a space', () => {
    expect(smartQuotes('the sonnet ("Spring has come") is printed with it'))
      .toBe('the sonnet (“Spring has come”) is printed with it');
  });
});

describe('smartQuotes — what it must not touch', () => {
  it('is idempotent', () => {
    const once = smartQuotes("Vivaldi marked the part 'the dog that barks'.");
    expect(smartQuotes(once)).toBe(once);
  });

  it('leaves already-curly text alone', () => {
    const curly = 'Symphony No. 3 in E-flat major, “Eroica”';
    expect(smartQuotes(curly)).toBe(curly);
  });

  it('leaves feet-and-inches primes as typed', () => {
    expect(smartQuotes(`5' 3" of manuscript`)).toBe(`5' 3" of manuscript`);
  });

  it('leaves the corpus em dashes alone — the corpus has no double hyphens to convert', () => {
    const line = 'Playful — fast and lively';
    expect(smartQuotes(line)).toBe(line);
    expect(smartQuotes('a range 1803--1804')).toBe('a range 1803--1804');
  });

  it('returns non-strings and empty strings unchanged', () => {
    expect(smartQuotes(null)).toBeNull();
    expect(smartQuotes(undefined)).toBeUndefined();
    expect(smartQuotes(42)).toBe(42);
    expect(smartQuotes('')).toBe('');
  });

  it('short-circuits a string with no straight marks to the identical reference', () => {
    const plain = 'Marcia funebre. Adagio assai';
    expect(smartQuotes(plain)).toBe(plain);
  });
});

describe('smartQuotesAll', () => {
  it('curls every entry and drops none', () => {
    const pool = ["a dog's bark", 'plain', "the violins' grief"];
    expect(smartQuotesAll(pool)).toEqual(['a dog’s bark', 'plain', 'the violins’ grief']);
  });

  it('passes a non-list through', () => {
    expect(smartQuotesAll(null)).toBeNull();
  });
});
