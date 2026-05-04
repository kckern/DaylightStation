import { describe, it, expect } from 'vitest';
import { viewReducer, initialViewState, makeInitialView } from './viewReducer.js';

describe('viewReducer', () => {
  it('default state is TOC, focus on main, day 0, image 0', () => {
    expect(initialViewState).toEqual({
      level: 'toc', dayIndex: 0, imageIndex: 0, focusRow: 'main',
    });
  });

  it('makeInitialView clamps dayIndex to last day', () => {
    expect(makeInitialView(7)).toEqual({
      level: 'toc', dayIndex: 6, imageIndex: 0, focusRow: 'main',
    });
    expect(makeInitialView(0)).toEqual(initialViewState);
  });

  describe('SELECT_DAY', () => {
    it('moves selection within TOC without changing level', () => {
      const next = viewReducer(initialViewState, { type: 'SELECT_DAY', index: 3 });
      expect(next).toEqual({ level: 'toc', dayIndex: 3, imageIndex: 0, focusRow: 'main' });
    });

    it('clamps within [0, totalDays-1]', () => {
      const next = viewReducer(initialViewState, { type: 'SELECT_DAY', index: 99, totalDays: 7 });
      expect(next.dayIndex).toBe(6);
      const back = viewReducer(initialViewState, { type: 'SELECT_DAY', index: -5, totalDays: 7 });
      expect(back.dayIndex).toBe(0);
    });
  });

  describe('OPEN_DAY', () => {
    it('moves to day level at the current dayIndex', () => {
      const start = { level: 'toc', dayIndex: 4, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'OPEN_DAY' }))
        .toEqual({ level: 'day', dayIndex: 4, imageIndex: 0, focusRow: 'main' });
    });

    it('OPEN_DAY with index moves AND opens', () => {
      const start = { level: 'toc', dayIndex: 0, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'OPEN_DAY', index: 2 }))
        .toEqual({ level: 'day', dayIndex: 2, imageIndex: 0, focusRow: 'main' });
    });
  });

  describe('OPEN_PHOTO', () => {
    it('moves to fullscreen at index 0', () => {
      const start = { level: 'day', dayIndex: 2, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'OPEN_PHOTO' }).level).toBe('fullscreen');
      expect(viewReducer(start, { type: 'OPEN_PHOTO' }).imageIndex).toBe(0);
    });
  });

  describe('CYCLE_PHOTO', () => {
    it('cycles forward modulo totalPhotos', () => {
      const start = { level: 'fullscreen', dayIndex: 1, imageIndex: 4, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_PHOTO', delta: 1, totalPhotos: 5 }).imageIndex).toBe(0);
    });

    it('cycles backward modulo totalPhotos', () => {
      const start = { level: 'fullscreen', dayIndex: 1, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_PHOTO', delta: -1, totalPhotos: 5 }).imageIndex).toBe(4);
    });

    it('no-op when totalPhotos is 0', () => {
      const start = { level: 'fullscreen', dayIndex: 1, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_PHOTO', delta: 1, totalPhotos: 0 })).toEqual(start);
    });
  });

  describe('CYCLE_DAY', () => {
    it('clamps forward at last day', () => {
      const start = { level: 'toc', dayIndex: 6, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_DAY', delta: 1, totalDays: 7 }).dayIndex).toBe(6);
    });

    it('clamps backward at day 0', () => {
      const start = { level: 'toc', dayIndex: 0, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_DAY', delta: -1, totalDays: 7 }).dayIndex).toBe(0);
    });

    it('moves within bounds', () => {
      const start = { level: 'toc', dayIndex: 3, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_DAY', delta: 1, totalDays: 7 }).dayIndex).toBe(4);
      expect(viewReducer(start, { type: 'CYCLE_DAY', delta: -1, totalDays: 7 }).dayIndex).toBe(2);
    });

    it('resets imageIndex when changing day', () => {
      const start = { level: 'fullscreen', dayIndex: 3, imageIndex: 5, focusRow: 'main' };
      expect(viewReducer(start, { type: 'CYCLE_DAY', delta: 1, totalDays: 7 }).imageIndex).toBe(0);
    });
  });

  describe('BACK', () => {
    it('fullscreen → day', () => {
      const start = { level: 'fullscreen', dayIndex: 2, imageIndex: 3, focusRow: 'main' };
      expect(viewReducer(start, { type: 'BACK' }).level).toBe('day');
    });
    it('day → toc', () => {
      const start = { level: 'day', dayIndex: 2, imageIndex: 0, focusRow: 'main' };
      expect(viewReducer(start, { type: 'BACK' }).level).toBe('toc');
    });
    it('toc stays at toc (no-op; caller decides what to do)', () => {
      expect(viewReducer(initialViewState, { type: 'BACK' })).toEqual(initialViewState);
    });
    it('focusRow=bar → focusRow=main (climbs out of bar focus before view level)', () => {
      const start = { level: 'toc', dayIndex: 0, imageIndex: 0, focusRow: 'bar' };
      expect(viewReducer(start, { type: 'BACK' }).focusRow).toBe('main');
    });
  });

  describe('FOCUS_BAR / FOCUS_MAIN', () => {
    it('FOCUS_BAR sets focusRow=bar', () => {
      expect(viewReducer(initialViewState, { type: 'FOCUS_BAR' }).focusRow).toBe('bar');
    });
    it('FOCUS_MAIN sets focusRow=main', () => {
      const start = { ...initialViewState, focusRow: 'bar' };
      expect(viewReducer(start, { type: 'FOCUS_MAIN' }).focusRow).toBe('main');
    });
  });
});
