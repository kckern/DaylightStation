import { describe, it, expect } from 'vitest';
import { slashIsNotForSearch } from './searchShortcut.js';

const key = (extra = {}) => ({ key: '/', defaultPrevented: false, ...extra });

describe('slashIsNotForSearch', () => {
  it('lets a bare / through', () => expect(slashIsNotForSearch(key(), document.body)).toBe(false));
  it('ignores other keys and handled events', () => {
    expect(slashIsNotForSearch(key({ key: 'a' }), document.body)).toBe(true);
    expect(slashIsNotForSearch(key({ defaultPrevented: true }), document.body)).toBe(true);
  });
  it('ignores browser shortcuts with a modifier', () => {
    for (const m of ['ctrlKey', 'metaKey', 'altKey']) expect(slashIsNotForSearch(key({ [m]: true }), document.body)).toBe(true);
  });
  it('ignores typing in fields and contenteditable', () => {
    expect(slashIsNotForSearch(key(), document.createElement('input'))).toBe(true);
    expect(slashIsNotForSearch(key(), document.createElement('textarea'))).toBe(true);
    expect(slashIsNotForSearch(key(), { tagName: 'DIV', isContentEditable: true })).toBe(true);
  });
});
