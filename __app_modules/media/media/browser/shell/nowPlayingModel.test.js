import { describe, it, expect } from 'vitest';
import {
  queueWindow, earlierLabel, miniBarVisible, heroSubtitle, wherePlayingLabel,
  seekKeyStep, endActionOption, END_ACTION_OPTIONS, heroStateWord,
} from './nowPlayingModel.js';

const items = (n) => Array.from({ length: n }, (_, i) => ({ queueItemId: `q${i}`, title: `T${i}` }));
const ids = (list) => list.map((it) => it.queueItemId);

describe('queueWindow', () => {
  it('shows the current item and the next five; earlier ones are counted apart, later ones go under More', () => {
    const w = queueWindow(items(12), 3);
    expect(ids(w.earlier)).toEqual(['q0', 'q1', 'q2']);
    expect(ids(w.window)).toEqual(['q3', 'q4', 'q5', 'q6', 'q7', 'q8']);
    expect(ids(w.later)).toEqual(['q9', 'q10', 'q11']);
  });

  it('a queue that has not started yet (or a ready queue) starts its window at the head', () => {
    const w = queueWindow(items(3), -1);
    expect(w.earlier).toEqual([]);
    expect(ids(w.window)).toEqual(['q0', 'q1', 'q2']);
    expect(w.later).toEqual([]);
  });

  it('a short queue near its end has nothing later', () => {
    const w = queueWindow(items(6), 2);
    expect(ids(w.earlier)).toEqual(['q0', 'q1']);
    expect(ids(w.window)).toEqual(['q2', 'q3', 'q4', 'q5']);
    expect(w.later).toEqual([]);
  });

  it('copes with no items and an index past the end', () => {
    expect(queueWindow([], 0)).toEqual({ earlier: [], window: [], later: [] });
    const w = queueWindow(items(2), 9);
    expect(ids(w.earlier)).toEqual(['q0', 'q1']);
    expect(w.window).toEqual([]);
  });
});

describe('earlierLabel', () => {
  it('folds what already played into one short row (owner ruling 2026-11-27: "2 played")', () => {
    expect(earlierLabel(2)).toBe('2 played');
    expect(earlierLabel(1)).toBe('1 played');
    expect(earlierLabel(0)).toBeNull();
  });
});

describe('miniBarVisible', () => {
  it('never shows on Now Playing: the hero is the one status there', () => {
    expect(miniBarVisible({ view: 'nowPlaying', hasItem: true, queueCount: 3 })).toBe(false);
    // A ready queue (nothing started) too — the hero names it and offers Play.
    expect(miniBarVisible({ view: 'nowPlaying', hasItem: false, queueCount: 3 })).toBe(false);
  });

  it('shows elsewhere while there is an item or a retained queue', () => {
    expect(miniBarVisible({ view: 'home', hasItem: true, queueCount: 0 })).toBe(true);
    expect(miniBarVisible({ view: 'browse', hasItem: false, queueCount: 2 })).toBe(true);
    expect(miniBarVisible({ view: 'home', hasItem: false, queueCount: 0 })).toBe(false);
  });
});

describe('heroSubtitle', () => {
  it('a show episode reads show · season and episode when known', () => {
    expect(heroSubtitle({ title: 'Ep' }, { containerTitle: 'Bibleman', parentIndex: 1, itemIndex: 3 }))
      .toBe('Bibleman · S1 E3');
    expect(heroSubtitle({ title: 'Ep' }, { containerTitle: 'Bibleman' })).toBe('Bibleman');
  });

  it('a track reads artist · album', () => {
    expect(heroSubtitle({ title: 'Song', artist: 'The Beatles', album: 'Abbey Road' }, null))
      .toBe('The Beatles · Abbey Road');
    expect(heroSubtitle({ title: 'Song' }, { artist: 'A', album: 'B', containerTitle: 'B' })).toBe('A · B');
  });

  it('never repeats the title or shows a raw id', () => {
    expect(heroSubtitle({ title: 'Same', contentId: 'plex:1' }, { containerTitle: 'Same' })).toBeNull();
    expect(heroSubtitle({ title: 'X', contentId: 'plex:1' }, { containerTitle: 'plex:1' })).toBeNull();
    expect(heroSubtitle(null, null)).toBeNull();
  });
});

describe('wherePlayingLabel', () => {
  it('says where it plays', () => {
    expect(wherePlayingLabel({ local: true })).toBe('on This device');
    expect(wherePlayingLabel({ local: false, name: 'Living Room TV' })).toBe('on Living Room TV');
    expect(wherePlayingLabel({ local: false, name: '' })).toBeNull();
  });
});

describe('seekKeyStep', () => {
  const key = (k, extra = {}) => ({ key: k, target: { tagName: 'DIV', closest: () => null }, ...extra });
  it('← and → seek 10 s', () => {
    expect(seekKeyStep(key('ArrowLeft'))).toBe(-10);
    expect(seekKeyStep(key('ArrowRight'))).toBe(10);
  });
  it('never while typing, with a modifier, or when a control owns the arrows', () => {
    expect(seekKeyStep(key('ArrowLeft', { target: { tagName: 'INPUT', closest: () => null } }))).toBeNull();
    expect(seekKeyStep(key('ArrowRight', { altKey: true }))).toBeNull();
    expect(seekKeyStep(key('ArrowRight', { metaKey: true }))).toBeNull();
    expect(seekKeyStep(key('ArrowRight', { target: { tagName: 'DIV', closest: (sel) => (sel.includes('slider') ? {} : null) } }))).toBeNull();
    expect(seekKeyStep(key('ArrowUp'))).toBeNull();
  });
});

describe('heroStateWord', () => {
  it('names the state only when it is not simply playing', () => {
    expect(heroStateWord('playing')).toBeNull();
    expect(heroStateWord('paused')).toBe('Paused');
    expect(heroStateWord('buffering')).toBe('Buffering…');
  });
});

describe('end action options', () => {
  it('one control with the current choice named', () => {
    expect(END_ACTION_OPTIONS.map((o) => o.value)).toEqual(['stop', 'repeat', 'similar']);
    expect(endActionOption('similar').label).toBe('Keep similar playing');
    expect(endActionOption('nonsense').value).toBe('stop');
  });
});
