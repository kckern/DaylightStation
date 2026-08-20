// cli/libretto.cli.test.mjs
//
// The reader turns a printed libretto into the corpus's own segment list. Its
// three traps are all silent ones — a wrong reading produces a plausible file
// with the wrong contents — so each has a test that fails loudly instead.

import { describe, it, expect } from 'vitest';
import {
  parseLibretto, assignParts, splitColumns, PART_ANCHORS, RECOGNISED_FORMS,
} from './libretto.cli.mjs';

const SAMPLE = [
  'PART ONE',
  '',
  '2 Sinfonia (Ouverture)',
  '',
  'Recitative (Accompanied – Tenor)',
  '3 Comfort ye, comfort ye my people,',
  'saith your God.',
  '(Isaiah 40: 1-3)',
  '',
  'Air (Tenor)',
  "4 Ev'ry valley shall be exalted,",
  '(Isaiah 40: 4)',
].join('\n');

describe('parseLibretto', () => {
  it('renumbers from the PDF’s 1-54 to the corpus’s 1-53', () => {
    const { items } = parseLibretto(SAMPLE);
    // PDF 2 (Sinfonia) is corpus 1, PDF 3 is corpus 2, PDF 4 is corpus 3.
    expect(items.map((i) => i.n)).toEqual([1, 2, 3]);
    expect(items[0].incipit).toBe('Sinfonia');
  });

  it('drops "Play All" — a DVD menu entry, not music', () => {
    const { items } = parseLibretto('PART ONE\n\n1 Play All\n\n2 Sinfonia (Ouverture)\n');
    expect(items).toHaveLength(1);
    expect(items[0].incipit).toBe('Sinfonia');
  });

  it('carries the form and voice down from the label line', () => {
    const { items } = parseLibretto(SAMPLE);
    expect(items[1]).toMatchObject({ form: 'Recitative', voice: 'Accompanied – Tenor' });
    expect(items[2]).toMatchObject({ form: 'Air', voice: 'Tenor' });
  });

  it('gives an instrumental number its own form, taken from its title', () => {
    const { items } = parseLibretto(SAMPLE);
    expect(items[0].form).toBe('Sinfonia');
    expect(items[0].voice).toBeNull();
  });

  it('captures the scripture citation and the sung text separately', () => {
    const { items } = parseLibretto(SAMPLE);
    expect(items[1].scripture).toBe('Isaiah 40: 1-3');
    expect(items[1].text.split('\n')).toHaveLength(2);
    expect(items[1].text.startsWith('Comfort ye')).toBe(true);
  });

  /**
   * A number may draw on more than one passage, and its text CONTINUES after the
   * first citation. A parser that stops capturing at the first `(…)` silently
   * drops the rest of the verse — measured at 41 lines and 9 citations on this
   * libretto — which is the kind of loss nothing downstream would ever reveal.
   */
  it('keeps capturing text after a citation, and keeps every citation', () => {
    const multi = [
      'Air (Soprano)',
      '53 If God be for us, who can be against us?',
      '(Romans 8: 31)',
      'Who shall lay anything to the charge',
      'of God’s elect?',
      '(Romans 8: 33-34)',
    ].join('\n');
    const { items } = parseLibretto(multi);
    expect(items[0].scripture).toBe('Romans 8: 31; Romans 8: 33-34');
    expect(items[0].text.split('\n')).toHaveLength(3);
    expect(items[0].text).toContain('of God’s elect?');
  });

  /**
   * THE PDF's OWN NUMBERS ARE A CHECKSUM. Discarding them is how a compensating
   * pair of errors — one number missed, one page number captured — keeps the
   * count at 53 while shifting every incipit against its timing by one. The
   * segments would carry the wrong names against the right seconds, and nothing
   * downstream could reveal it.
   */
  it('warns when the PDF’s own numbering skips', () => {
    const gap = [
      'Chorus', '2 First', '(A 1: 1)',
      'Chorus', '4 Third', '(A 1: 2)',
    ].join('\n');
    const { items, warnings } = parseLibretto(gap);
    expect(items).toHaveLength(2);
    expect(warnings.join(' ')).toMatch(/sequence break: PDF 2 followed by 4/);
  });

  it('warns when a number repeats — the page-number trap', () => {
    const dupe = [
      'Chorus', '12 First', '(A 1: 1)',
      'Chorus', '12 Page number glued to a line', '(A 1: 2)',
    ].join('\n');
    const { warnings } = parseLibretto(dupe);
    expect(warnings.join(' ')).toMatch(/sequence break: PDF 12 followed by 12/);
  });
});

describe('assignParts', () => {
  const items = Array.from({ length: 53 }, (_, i) => ({
    n: i + 1,
    // No. 22 opens Part Two, No. 45 opens Part Three.
    incipit: i === 21 ? 'Behold the Lamb of God'
      : i === 44 ? 'I know that my Redeemer liveth' : `Number ${i + 1}`,
  }));

  it('splits the work at its two known anchors', () => {
    const out = assignParts(items);
    const count = (p) => out.filter((i) => i.part === p).length;
    // Messiah divides 21 / 23 / 9.
    expect([count('One'), count('Two'), count('Three')]).toEqual([21, 23, 9]);
  });

  it('refuses rather than guessing when an anchor is missing', () => {
    const broken = items.map((i) => ({ ...i, incipit: 'x' }));
    expect(() => assignParts(broken)).toThrow(/anchor/i);
  });

  it('publishes the anchors it divides on', () => {
    expect(PART_ANCHORS.Two).toBe('Behold the Lamb of God');
    expect(PART_ANCHORS.Three).toBe('I know that my Redeemer liveth');
  });
});

describe('splitColumns', () => {
  /**
   * `-layout` keeps the two columns physically apart on each line. Reading such
   * a page line-by-line interleaves them exactly as `-raw` did; the fix is to
   * cut at the gutter and read the left column entirely before the right.
   */
  it('reads the left column top-to-bottom, then the right', () => {
    const page = [
      'left one                       right one',
      'left two                       right two',
    ].join('\n');
    expect(splitColumns(page).split('\n')).toEqual([
      'left one', 'left two', 'right one', 'right two',
    ]);
  });

  it('leaves a page alone when no column is convincingly blank', () => {
    // Prose that fills the width has no gutter; splitting it would cut words.
    const prose = [
      'the quick brown fox jumps over the lazy dog and then keeps running on',
      'a second line of continuous prose with no gutter anywhere within it at',
    ].join('\n');
    expect(splitColumns(prose)).toBe(prose);
  });
});

describe('RECOGNISED_FORMS', () => {
  it('is what the reader can actually label, so the gate can be checked against it', () => {
    expect(RECOGNISED_FORMS).toContain('Recitative');
    expect(RECOGNISED_FORMS).toContain('Soli');
    expect(RECOGNISED_FORMS).toContain('Pifa');
  });
});
