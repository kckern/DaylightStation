import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import GlyphStrip from './GlyphStrip.jsx';
import { columnsFor } from './glyphStrip.js';

const strip = (columns, props) => render(<GlyphStrip columns={columns} {...props} />).container;
const colsOf = (el) => Array.from(el.querySelectorAll('.lang-strip__col'));
const wantOf = (col) => col.querySelector('.lang-strip__want').textContent;

describe('GlyphStrip', () => {
  it('draws one column per entry, model above and answer beneath', () => {
    const el = strip(columnsFor({ target: '오늘', committed: '우', pending: '느' }));
    const cols = colsOf(el);
    expect(cols).toHaveLength(2);
    expect(cols.map(wantOf)).toEqual(['오', '늘']);
    expect(cols.map((c) => c.querySelector('.lang-strip__got').textContent)).toEqual(['우', '느']);
  });

  it('puts the caret on the current column and nowhere else', () => {
    const el = strip(columnsFor({ target: '가나다라', committed: '가' }));
    const cols = colsOf(el);
    expect(cols.map((c) => Boolean(c.querySelector('.lang-strip__caret')))).toEqual([false, true, false, false]);
    expect(el.querySelectorAll('.lang-strip__caret')).toHaveLength(1);
  });

  it('draws no caret at all when the field is not the learner\'s focus', () => {
    const el = strip(columnsFor({ target: '오늘', committed: '' }), { caret: false });
    expect(el.querySelectorAll('.lang-strip__caret')).toHaveLength(0);
  });

  // Listen mode: the model is withheld, so the glyph must not be in the DOM at
  // all. Hiding it in CSS would still hand it to a screen reader, and to any
  // child who knows what "view source" is — the drill is to hear it, not read
  // it, and an empty column is the whole point of the rung.
  it('renders no text in a blind column', () => {
    const el = strip(columnsFor({ target: '오늘', committed: '', reveal: 'none' }));
    const cols = colsOf(el);
    expect(cols.map(wantOf)).toEqual(['', '']);
    expect(el.textContent).toBe('');
    expect(cols.every((c) => c.classList.contains('is-blind'))).toBe(true);
  });

  it('carries each column\'s state as a class so the styling can speak', () => {
    const el = strip(columnsFor({ target: '가나다라', committed: '가니' }));
    expect(colsOf(el).map((c) => c.className)).toEqual([
      'lang-strip__col is-done',
      'lang-strip__col is-wrong',
      'lang-strip__col is-current',
      'lang-strip__col is-next',
    ]);
  });

  // The strip is decorative duplication of the input's own value. The input
  // keeps its label and stays the accessible control; a second reading of the
  // same characters, letter by letter, is noise in a screen reader.
  it('is presentational — the input remains the accessible control', () => {
    const el = strip(columnsFor({ target: '오늘', committed: '' }));
    expect(el.querySelector('.lang-strip').getAttribute('role')).toBe('presentation');
  });

  // A rung mounting before the day's sentence arrives passes []; that is an
  // empty strip, not a crash.
  it('renders an empty strip rather than throwing when there is nothing yet', () => {
    const el = strip([]);
    expect(colsOf(el)).toHaveLength(0);
    expect(el.querySelector('.lang-strip')).toBeTruthy();
  });
});
