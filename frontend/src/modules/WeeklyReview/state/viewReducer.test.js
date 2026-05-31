// frontend/src/modules/WeeklyReview/state/viewReducer.test.js
import { describe, it, expect } from 'vitest';
import { viewReducer, initialViewState } from './viewReducer.js';

const grid = (over = {}) => ({ level: 'grid', dayIndex: 0, itemIndex: 0, playing: false, muted: true, contextOpen: false, ...over });
const reel = (over = {}) => ({ level: 'reel', dayIndex: 0, itemIndex: 0, playing: false, muted: true, contextOpen: false, ...over });

describe('viewReducer', () => {
  it('starts on the grid', () => {
    expect(initialViewState).toEqual(grid());
  });

  describe('SELECT_DAY', () => {
    it('sets focus dayIndex without leaving the grid', () => {
      expect(viewReducer(grid(), { type: 'SELECT_DAY', dayIndex: 3 })).toEqual(grid({ dayIndex: 3 }));
    });
  });

  describe('GRID_MOVE (4 cols)', () => {
    const g = (i) => grid({ dayIndex: i });
    it('right/left move within a row and hard-stop at column edges', () => {
      expect(viewReducer(g(0), { type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }).dayIndex).toBe(1);
      expect(viewReducer(g(3), { type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }).dayIndex).toBe(3); // edge
      expect(viewReducer(g(4), { type: 'GRID_MOVE', dir: 'left', cols: 4, total: 8 }).dayIndex).toBe(4); // edge
      expect(viewReducer(g(5), { type: 'GRID_MOVE', dir: 'left', cols: 4, total: 8 }).dayIndex).toBe(4);
    });
    it('down/up move between rows and hard-stop at grid edges', () => {
      expect(viewReducer(g(1), { type: 'GRID_MOVE', dir: 'down', cols: 4, total: 8 }).dayIndex).toBe(5);
      expect(viewReducer(g(5), { type: 'GRID_MOVE', dir: 'down', cols: 4, total: 8 }).dayIndex).toBe(5); // bottom edge
      expect(viewReducer(g(5), { type: 'GRID_MOVE', dir: 'up', cols: 4, total: 8 }).dayIndex).toBe(1);
      expect(viewReducer(g(1), { type: 'GRID_MOVE', dir: 'up', cols: 4, total: 8 }).dayIndex).toBe(1); // top edge
    });
    it('down hard-stops when the target cell has no day', () => {
      expect(viewReducer(g(2), { type: 'GRID_MOVE', dir: 'down', cols: 4, total: 6 }).dayIndex).toBe(2); // 2+4=6 out of range
    });
  });

  describe('OPEN_DAY', () => {
    it('enters the reel at item 0 with playback reset', () => {
      expect(viewReducer(grid({ dayIndex: 4 }), { type: 'OPEN_DAY' }))
        .toEqual(reel({ dayIndex: 4 }));
    });
  });

  describe('STEP_ITEM', () => {
    it('advances and clamps with no wrap, resetting playback', () => {
      expect(viewReducer(reel({ itemIndex: 2, playing: true, muted: false }), { type: 'STEP_ITEM', delta: 1, totalItems: 5 }))
        .toEqual(reel({ itemIndex: 3 }));
      expect(viewReducer(reel({ itemIndex: 4 }), { type: 'STEP_ITEM', delta: 1, totalItems: 5 }).itemIndex).toBe(4); // edge
      expect(viewReducer(reel({ itemIndex: 0 }), { type: 'STEP_ITEM', delta: -1, totalItems: 5 }).itemIndex).toBe(0); // edge
    });
  });

  describe('CROSS_DAY', () => {
    it('jumps to a given day + item with playback reset', () => {
      expect(viewReducer(reel({ dayIndex: 2, itemIndex: 3, playing: true }), { type: 'CROSS_DAY', dayIndex: 3, itemIndex: 0 }))
        .toEqual(reel({ dayIndex: 3, itemIndex: 0 }));
    });
  });

  describe('CLIMB (priority: context > playing > level)', () => {
    it('closes the context panel first', () => {
      expect(viewReducer(reel({ contextOpen: true, playing: true }), { type: 'CLIMB' }))
        .toEqual(reel({ contextOpen: false, playing: true }));
    });
    it('stops a playing video to the poster', () => {
      expect(viewReducer(reel({ playing: true, muted: false }), { type: 'CLIMB' }))
        .toEqual(reel({ playing: false, muted: true }));
    });
    it('reel climbs to the grid, resetting reel fields but keeping dayIndex', () => {
      expect(viewReducer(reel({ dayIndex: 5, itemIndex: 4 }), { type: 'CLIMB' }))
        .toEqual(grid({ dayIndex: 5 }));
    });
    it('grid is a no-op (caller raises the exit gate)', () => {
      expect(viewReducer(grid({ dayIndex: 2 }), { type: 'CLIMB' })).toEqual(grid({ dayIndex: 2 }));
    });
  });

  describe('context + video actions', () => {
    it('OPEN_CONTEXT / CLOSE_CONTEXT toggle the panel', () => {
      expect(viewReducer(reel(), { type: 'OPEN_CONTEXT' }).contextOpen).toBe(true);
      expect(viewReducer(reel({ contextOpen: true }), { type: 'CLOSE_CONTEXT' }).contextOpen).toBe(false);
    });
    it('PLAY_VIDEO starts muted; TOGGLE_MUTE flips; STOP_VIDEO stops', () => {
      expect(viewReducer(reel(), { type: 'PLAY_VIDEO' })).toEqual(reel({ playing: true, muted: true }));
      expect(viewReducer(reel({ playing: true, muted: true }), { type: 'TOGGLE_MUTE' }).muted).toBe(false);
      expect(viewReducer(reel({ playing: true }), { type: 'STOP_VIDEO' }).playing).toBe(false);
    });
  });
});
