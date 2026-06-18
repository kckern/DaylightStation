// frontend/src/modules/WeeklyReview/state/keymap.test.js
import { describe, it, expect } from 'vitest';
import { resolveKey } from './keymap.js';

const base = (over = {}) => ({
  view: { level: 'grid', dayIndex: 7, itemIndex: 0, playing: false, muted: true, contextOpen: false },
  modalType: null, modalFocus: 0, preflight: 'ok',
  cols: 4, totalDays: 8, now: 1000, lastEdge: null, doubleWindowMs: 500,
  media: { itemCount: 3, currentType: 'photo', atFirst: true, atLast: false,
           hasPrevDay: true, hasNextDay: false, prevDayIndex: 6, nextDayIndex: -1, prevDayLastIndex: 2 },
  ...over,
});
const r = (input) => resolveKey(base(input));

describe('keymap — week grid', () => {
  const onGrid = (over) => ({ view: { level: 'grid', dayIndex: 5, itemIndex: 0, playing: false, muted: true, contextOpen: false }, ...over });
  it('arrows move focus via GRID_MOVE', () => {
    expect(r({ ...onGrid(), key: 'ArrowRight' }).view).toEqual([{ type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }]);
  });
  it('Up from the top row is a clamped no-op move (no accidental exit)', () => {
    const res = r({ ...onGrid({ view: { level: 'grid', dayIndex: 1, itemIndex: 0, playing: false, muted: true, contextOpen: false } }), key: 'ArrowUp' });
    expect(res.view).toEqual([{ type: 'GRID_MOVE', dir: 'up', cols: 4, total: 8 }]);
    expect(res.modal).toEqual([]);
  });
  it('Up from the bottom row just moves up a row', () => {
    expect(r({ ...onGrid(), key: 'ArrowUp' }).view).toEqual([{ type: 'GRID_MOVE', dir: 'up', cols: 4, total: 8 }]);
  });
  it('Enter opens the focused day', () => {
    expect(r({ ...onGrid(), key: 'Enter' }).view).toEqual([{ type: 'OPEN_DAY' }]);
  });
  it('Back raises the exit gate', () => {
    expect(r({ ...onGrid(), key: 'Escape' }).modal).toEqual([{ type: 'OPEN', modal: 'exitGate' }]);
  });
});

describe('keymap — reel, photo focused', () => {
  const onReel = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 1, playing: false, muted: true, contextOpen: false },
    media: { itemCount: 3, currentType: 'photo', atFirst: false, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Right steps to the next item', () => {
    expect(resolveKey(onReel({ key: 'ArrowRight' })).view).toEqual([{ type: 'STEP_ITEM', delta: 1, totalItems: 3 }]);
  });
  it('Enter also steps to the next item (photo has no other action)', () => {
    expect(resolveKey(onReel({ key: 'Enter' })).view).toEqual([{ type: 'STEP_ITEM', delta: 1, totalItems: 3 }]);
  });
  it('Up climbs to the grid', () => {
    expect(resolveKey(onReel({ key: 'ArrowUp' })).view).toEqual([{ type: 'CLIMB' }]);
  });
  it('Down opens the context panel', () => {
    expect(resolveKey(onReel({ key: 'ArrowDown' })).view).toEqual([{ type: 'OPEN_CONTEXT' }]);
  });
  it('Back climbs to the grid', () => {
    expect(resolveKey(onReel({ key: 'Escape' })).view).toEqual([{ type: 'CLIMB' }]);
  });
});

describe('keymap — reel edges + double-tap cross-day', () => {
  const atLast = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 2, playing: false, muted: true, contextOpen: false },
    media: { itemCount: 3, currentType: 'photo', atFirst: false, atLast: true, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Right at the last item bumps and records a right edge (no movement)', () => {
    const res = resolveKey(atLast({ key: 'ArrowRight', now: 1000, lastEdge: null }));
    expect(res.view).toEqual([]);
    expect(res.edge).toEqual({ dir: 'right', at: 1000 });
  });
  it('second Right within the window crosses to the next day, first item', () => {
    const res = resolveKey(atLast({ key: 'ArrowRight', now: 1300, lastEdge: { dir: 'right', at: 1000 } }));
    expect(res.view).toEqual([{ type: 'CROSS_DAY', dayIndex: 3, itemIndex: 0 }]);
    expect(res.edge).toBeNull();
  });
  it('second Right after the window expires only bumps again', () => {
    const res = resolveKey(atLast({ key: 'ArrowRight', now: 2000, lastEdge: { dir: 'right', at: 1000 } }));
    expect(res.view).toEqual([]);
    expect(res.edge).toEqual({ dir: 'right', at: 2000 });
  });
  it('double-Left at the first item crosses to the previous day, last item', () => {
    const atFirst = base({
      view: { level: 'reel', dayIndex: 4, itemIndex: 0, playing: false, muted: true, contextOpen: false },
      media: { itemCount: 3, currentType: 'photo', atFirst: true, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
      key: 'ArrowLeft', now: 1200, lastEdge: { dir: 'left', at: 1000 },
    });
    expect(resolveKey(atFirst).view).toEqual([{ type: 'CROSS_DAY', dayIndex: 5, itemIndex: 4 }]);
  });
  it('cannot cross past the last day (no next day)', () => {
    const res = resolveKey(atLast({ key: 'ArrowRight', now: 1200, lastEdge: { dir: 'right', at: 1000 }, media: { itemCount: 3, currentType: 'photo', atFirst: false, atLast: true, hasPrevDay: true, hasNextDay: false, prevDayIndex: 5, nextDayIndex: -1, prevDayLastIndex: 4 } }));
    expect(res.view).toEqual([]);
  });
});

describe('keymap — reel, video focused', () => {
  const onVideo = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 1, playing: false, muted: true, contextOpen: false },
    media: { itemCount: 3, currentType: 'video', atFirst: false, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Enter plays the video (muted)', () => {
    expect(resolveKey(onVideo({ key: 'Enter' })).view).toEqual([{ type: 'PLAY_VIDEO' }]);
  });
});

describe('keymap — video playing', () => {
  const playing = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 1, playing: true, muted: true, contextOpen: false },
    media: { itemCount: 3, currentType: 'video', atFirst: false, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Enter toggles mute', () => {
    expect(resolveKey(playing({ key: 'Enter' })).view).toEqual([{ type: 'TOGGLE_MUTE' }]);
  });
  it('Right steps to the next item (stops the video)', () => {
    expect(resolveKey(playing({ key: 'ArrowRight' })).view).toEqual([{ type: 'STEP_ITEM', delta: 1, totalItems: 3 }]);
  });
  it('Up/Back climb one level (stop video → poster)', () => {
    expect(resolveKey(playing({ key: 'ArrowUp' })).view).toEqual([{ type: 'CLIMB' }]);
    expect(resolveKey(playing({ key: 'Escape' })).view).toEqual([{ type: 'CLIMB' }]);
  });
  it('Down opens the context panel', () => {
    expect(resolveKey(playing({ key: 'ArrowDown' })).view).toEqual([{ type: 'OPEN_CONTEXT' }]);
  });
});

describe('keymap — context panel open', () => {
  const ctx = (over = {}) => base({
    view: { level: 'reel', dayIndex: 4, itemIndex: 1, playing: false, muted: true, contextOpen: true },
    media: { itemCount: 3, currentType: 'photo', atFirst: false, atLast: false, hasPrevDay: true, hasNextDay: true, prevDayIndex: 5, nextDayIndex: 3, prevDayLastIndex: 4 },
    ...over,
  });
  it('Down / Up / Back all close the panel', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Escape']) {
      expect(resolveKey(ctx({ key })).view).toEqual([{ type: 'CLOSE_CONTEXT' }]);
    }
  });
  it('Left / Right are inert while the panel is open', () => {
    expect(resolveKey(ctx({ key: 'ArrowRight' })).view).toEqual([]);
  });
});

describe('keymap — exit gate modal', () => {
  const gate = (focus, key) => base({ modalType: 'exitGate', modalFocus: focus, key });
  it('arrows toggle focus', () => {
    expect(resolveKey(gate(0, 'ArrowRight')).modal).toEqual([{ type: 'TOGGLE_FOCUS' }]);
    expect(resolveKey(gate(0, 'ArrowUp')).modal).toEqual([{ type: 'TOGGLE_FOCUS' }]);
  });
  it('Enter on "Keep going" closes; on "Save & end" closes + saveAndExit', () => {
    const keep = resolveKey(gate(0, 'Enter'));
    expect(keep.modal).toEqual([{ type: 'CLOSE' }]);
    expect(keep.intents).toEqual([]);
    const save = resolveKey(gate(1, 'Enter'));
    expect(save.modal).toEqual([{ type: 'CLOSE' }]);
    expect(save.intents).toEqual(['saveAndExit']);
  });

  it('Back on the gate confirms exit (mash-Back must escape)', () => {
    const back = resolveKey(gate(0, 'Escape'));
    expect(back.modal).toEqual([{ type: 'CLOSE' }]);
    expect(back.intents).toEqual(['saveAndExit']);
  });
});

describe('keymap — recording-lifecycle overlays', () => {
  it('preflight acquiring: Back exits without saving; arrows fall through to grid', () => {
    const acq = base({ preflight: 'acquiring', view: { level: 'grid', dayIndex: 5, itemIndex: 0, playing: false, muted: true, contextOpen: false } });
    expect(resolveKey({ ...acq, key: 'Escape' }).intents).toEqual(['exitNoSave']);
    expect(resolveKey({ ...acq, key: 'ArrowRight' }).view).toEqual([{ type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }]);
  });
  it('preflightFailed: Enter focus 0 retries, focus 1 exits; Back exits', () => {
    expect(resolveKey(base({ modalType: 'preflightFailed', modalFocus: 0, key: 'Enter' })).intents).toEqual(['retryMic']);
    expect(resolveKey(base({ modalType: 'preflightFailed', modalFocus: 1, key: 'Enter' })).intents).toEqual(['exitWidget']);
    expect(resolveKey(base({ modalType: 'preflightFailed', modalFocus: 0, key: 'Escape' })).intents).toEqual(['exitWidget']);
  });
  it('disconnect: all keys inert', () => {
    for (const key of ['ArrowUp', 'Enter', 'Escape']) {
      const res = resolveKey(base({ modalType: 'disconnect', key }));
      expect(res).toEqual({ view: [], modal: [], intents: [], edge: null });
    }
  });
  it('resumeDraft: Enter finalizes; arrows fall through to grid; Back defers (close)', () => {
    const d = base({ modalType: 'resumeDraft', view: { level: 'grid', dayIndex: 5, itemIndex: 0, playing: false, muted: true, contextOpen: false } });
    const enter = resolveKey({ ...d, key: 'Enter' });
    expect(enter.intents).toEqual(['finalizeDraft']);
    expect(enter.modal).toEqual([{ type: 'CLOSE' }]);
    expect(resolveKey({ ...d, key: 'ArrowRight' }).view).toEqual([{ type: 'GRID_MOVE', dir: 'right', cols: 4, total: 8 }]);
    expect(resolveKey({ ...d, key: 'Escape' }).modal).toEqual([{ type: 'CLOSE' }]);
  });
  it('finalizeError: Enter focus 1 exits; Back closes', () => {
    expect(resolveKey(base({ modalType: 'finalizeError', modalFocus: 1, key: 'Enter' })).intents).toEqual(['exitWidget']);
    expect(resolveKey(base({ modalType: 'finalizeError', modalFocus: 0, key: 'Enter' })).modal).toEqual([{ type: 'CLOSE' }]);
    expect(resolveKey(base({ modalType: 'finalizeError', modalFocus: 0, key: 'Escape' })).modal).toEqual([{ type: 'CLOSE' }]);
  });
});
