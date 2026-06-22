import { describe, it, expect } from 'vitest';
import { anchorForNumpad, keyToAction } from './keymap.js';

describe('anchorForNumpad', () => {
  it('maps the numpad compass to object-position keywords', () => {
    expect(anchorForNumpad('7')).toBe('top left');
    expect(anchorForNumpad('8')).toBe('top');
    expect(anchorForNumpad('5')).toBe('center');
    expect(anchorForNumpad('3')).toBe('bottom right');
    expect(anchorForNumpad('0')).toBe(null);   // clear
  });
  it('returns undefined for non-numpad', () => { expect(anchorForNumpad('q')).toBeUndefined(); });
});

describe('keyToAction', () => {
  const opts = { quickTags: ['impressionism', 'baroque'] };

  it('arrows / J K navigate', () => {
    expect(keyToAction({ key: 'ArrowRight' }, opts)).toEqual({ action: 'next' });
    expect(keyToAction({ key: 'j' }, opts)).toEqual({ action: 'next' });
    expect(keyToAction({ key: 'k' }, opts)).toEqual({ action: 'prev' });
  });

  it('digits toggle the matching quick-tag', () => {
    expect(keyToAction({ key: '1' }, opts)).toEqual({ action: 'toggleTag', tag: 'impressionism' });
    expect(keyToAction({ key: '2' }, opts)).toEqual({ action: 'toggleTag', tag: 'baroque' });
    expect(keyToAction({ key: '3' }, opts)).toBeNull();   // no 3rd quick-tag
  });

  it('X hides, F flags, E edits, T opens palette, A toggles auto-advance, U undoes', () => {
    expect(keyToAction({ key: 'x' }, opts)).toEqual({ action: 'toggleHidden' });
    expect(keyToAction({ key: 'f' }, opts)).toEqual({ action: 'toggleFlagged' });
    expect(keyToAction({ key: 'e' }, opts)).toEqual({ action: 'edit' });
    expect(keyToAction({ key: 't' }, opts)).toEqual({ action: 'palette' });
    expect(keyToAction({ key: 'a' }, opts)).toEqual({ action: 'autoAdvance' });
    expect(keyToAction({ key: 'u' }, opts)).toEqual({ action: 'undo' });
  });

  it('numpad sets the anchor', () => {
    expect(keyToAction({ key: '5', code: 'Numpad5' }, opts)).toEqual({ action: 'anchor', value: 'center' });
  });

  it('Backspace / - removes from the current collection', () => {
    expect(keyToAction({ key: 'Backspace' }, opts)).toEqual({ action: 'removeFromCollection' });
    expect(keyToAction({ key: '-' }, opts)).toEqual({ action: 'removeFromCollection' });
  });

  it('Enter toggles loupe/grid', () => {
    expect(keyToAction({ key: 'Enter' }, opts)).toEqual({ action: 'toggleView' });
  });

  it('in edit mode, only Escape is interpreted (typing passes through)', () => {
    expect(keyToAction({ key: 'x' }, { ...opts, editMode: true })).toBeNull();
    expect(keyToAction({ key: 'Escape' }, { ...opts, editMode: true })).toEqual({ action: 'exitEdit' });
  });
});
