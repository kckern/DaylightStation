import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { listPage, browseSlots, pickerGrid, SHELF_NOTES } from './officeKeys.js';

vi.mock('../../../desk/PianoHomeDesk.jsx', () => ({ usePrintedTitle: (scoreId) => `santa claus is coming to town ${scoreId.split('/').pop()}` }));
const { default: OfficePiecePicker } = await import('./OfficePiecePicker.jsx');

const passage = (index, state) => ({ id: `p${index}`, state });
const piece = (n, total, { bronze = 0 } = {}) => ({
  scoreId: `files:x/p${n}`, cover: null, total, silver: bronze, gold: 0, pieceSilver: false,
  next: { passageId: `p${Math.min(bronze, total - 1)}` },
  passages: Array.from({ length: total }, (_, index) => passage(index, index < bronze ? 'silver' : index === bronze ? 'learning' : 'todo')),
});
const draw = (items, { pageAt = 0, level = 'mine', kind = 'pieces' } = {}) => {
  const page = listPage(items, pageAt);
  return render(<OfficePiecePicker title="Your pieces" kind={kind} slots={page.slots} browse={browseSlots(level, page)} page={page} />);
};

describe('pickerGrid (how a page of keys sits on the canvas)', () => {
  it('stacks up to three in one column and splits more into two, filled down then across', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => pickerGrid(n))).toEqual([
      { columns: 1, rows: 1 }, { columns: 1, rows: 2 }, { columns: 1, rows: 3 },
      { columns: 2, rows: 2 }, { columns: 2, rows: 3 }, { columns: 2, rows: 3 },
    ]);
    expect(pickerGrid(SHELF_NOTES.length)).toEqual({ columns: 2, rows: 4 });
    expect(pickerGrid(0)).toEqual({ columns: 1, rows: 1 });
  });
});

describe('OfficePiecePicker', () => {
  it('lays the keys on the grid: low keys down the left column, the rest down the right', () => {
    const { container } = draw([1, 2, 3, 4, 5].map((n) => piece(n, 3)));
    const list = container.querySelector('.office-piece-picker__keys');
    expect(list.style.getPropertyValue('--columns')).toBe('2');
    expect(list.style.getPropertyValue('--rows')).toBe('3');
    expect([...container.querySelectorAll('.office-piece-key__note')].map((el) => el.textContent)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4']);
  });

  it('every poster is drawn in one aspect box (cover-fit), so badges and titles line up', () => {
    const items = [{ ...piece(1, 3), cover: 'tall.png' }, { ...piece(2, 3), cover: 'square.png' }, piece(3, 3)];
    const { container } = draw(items);
    const posters = [...container.querySelectorAll('.office-piece-key__poster')];
    expect(posters).toHaveLength(3);
    // The picture sits inside the same box on every card; no poster draws the stand-in in that box.
    expect(posters.map((poster) => poster.querySelector('img')?.getAttribute('src') ?? 'stand-in')).toEqual(['tall.png', 'square.png', 'stand-in']);
    // Key, poster, text: the same three children in the same order on every card.
    for (const card of container.querySelectorAll('.office-piece-key')) {
      expect([...card.children].map((el) => el.className.split(' ')[0])).toEqual(['office-piece-key__tip', 'office-piece-key__poster', 'office-piece-key__text']);
    }
  });

  it('a title is the printed title, clamped to two lines', () => {
    const { container } = draw([piece(1, 3)]);
    const title = container.querySelector('.office-piece-key__title');
    // Set in headline case: files often print it in sentence case or lowercase.
    expect(title.textContent).toBe('Santa Claus Is Coming to Town P1');
    expect(title.tagName).toBe('STRONG'); // the two-line clamp is the stylesheet's (.office-piece-key__title)
  });

  it('a passage map over 6 coins collapses to a count ("4 of 12 Bronze")', () => {
    const { container } = draw([piece(1, 6), piece(2, 12, { bronze: 4 })]);
    const [short, long] = container.querySelectorAll('.office-piece-key__progress');
    expect(short.querySelectorAll('[data-passage]')).toHaveLength(6);
    expect(short.querySelectorAll('[data-current]')).toHaveLength(1);
    expect(long.querySelectorAll('[data-passage]')).toHaveLength(0);
    expect(long.textContent).toBe('4 of 12 Bronze');
  });

  it('a browse key that does nothing on this page is an empty key, not a dim slab', () => {
    const { container } = draw([piece(1, 3)]);
    const slot = (id) => container.querySelector(`.office-piece-picker__page[data-browse="${id}"]`);
    expect(slot('switch').textContent).toContain('All music');
    expect(slot('switch').querySelector('.office-key-card')).not.toBeNull();
    for (const id of ['previous', 'next']) {
      expect(slot(id)).not.toBeNull();
      expect(slot(id).dataset.enabled).toBeUndefined();
      expect(slot(id).childElementCount).toBe(0);
    }
    expect(container.querySelector('.office-piece-picker__page-count').textContent).toBe('');
  });

  it('says the page between the page keys when the list runs over', () => {
    const items = Array.from({ length: 14 }, (_, n) => piece(n, 2));
    const { container } = draw(items, { pageAt: 1 });
    expect(container.querySelector('.office-piece-picker__page-count').textContent).toBe('2 of 3');
    for (const id of ['previous', 'next']) {
      const slot = container.querySelector(`.office-piece-picker__page[data-browse="${id}"]`);
      expect(slot.dataset.enabled).toBe('true');
      expect(slot.querySelector('.office-key-card')).not.toBeNull();
    }
  });
});
