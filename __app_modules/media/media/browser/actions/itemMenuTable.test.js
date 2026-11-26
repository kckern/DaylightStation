// Addendum item 7: one menu table, so labels never drift between menus.
import { describe, it, expect } from 'vitest';
import { itemMenuEntries, moveMenuEntries, MENU_LABELS, splitItemMenu } from "./itemMenuTable.js";

const labels = (entries) => entries.filter((e) => !e.divider).map((e) => e.label);
const kinds = (entries) => entries.filter((e) => !e.divider).map((e) => e.kind);

describe('itemMenuEntries', () => {
  it('a row and a tile say the same words for the same verbs', () => {
    const where = { elsewhere: true, short: 'Office Screen', sentence: 'Play on Office Screen' };
    const row = itemMenuEntries({ surface: 'row', kind: 'leaf', where });
    const tile = itemMenuEntries({ surface: 'tile', kind: 'leaf', where });
    const shared = ['playNow', 'playHere', 'playNext', 'playFirst', 'add', 'playOn', 'addOn', 'details'];
    for (const k of shared) {
      expect(row.find((e) => e.kind === k)?.label).toBe(tile.find((e) => e.kind === k)?.label);
    }
    expect(labels(row)).toEqual(expect.arrayContaining([
      'Play on Office Screen', 'Play here', 'Play Next on Office Screen', 'Play First on Office Screen',
      'Add to Queue on Office Screen', 'Play on…', 'Add on…', 'Open detail',
    ]));
  });

  it('plays here: plain verbs, no Play here', () => {
    const entries = itemMenuEntries({ surface: 'tile', kind: 'leaf' });
    expect(labels(entries).slice(0, 4)).toEqual(['Play Now', 'Play Next', 'Play First', 'Add to Queue']);
    expect(kinds(entries)).not.toContain('playHere');
  });

  it('a collection shuffles and has no watched marks; a still is shown, not played, on a screen', () => {
    const coll = kinds(itemMenuEntries({ surface: 'row', kind: 'collection' }));
    expect(coll).toContain('shuffle');
    expect(coll).not.toContain('watched');
    expect(itemMenuEntries({ surface: 'row', kind: 'show' }).find((e) => e.kind === 'playOn').label).toBe('Show on…');
  });

  it('household verbs follow what is known: favourite toggles, watched marks, removal only in a list', () => {
    const k = kinds(itemMenuEntries({ surface: 'tile', kind: 'leaf', favourite: true, watched: true, removable: true }));
    expect(k).toEqual(expect.arrayContaining(['unfavourite', 'unwatched', 'hide']));
    expect(k).not.toContain('watched');
    expect(kinds(itemMenuEntries({ surface: 'row', kind: 'leaf', household: false }))).not.toContain('favourite');
  });

  it('an item already on a screen offers Open <screen> (item 5); Continue comes first', () => {
    const entries = itemMenuEntries({ surface: 'tile', kind: 'collection', playingOn: { name: 'Office Screen' }, continueLabel: 'Continue S2E7' });
    expect(labels(entries).slice(0, 2)).toEqual(['Continue S2E7', 'Open Office Screen']);
  });

  it('Play Next carries its press-and-hold front offer; no trailing or doubled dividers', () => {
    const entries = itemMenuEntries({ surface: 'row', kind: 'leaf', household: false });
    expect(entries.find((e) => e.kind === 'playNext').hold).toBe('playFirst');
    expect(entries[entries.length - 1].divider).toBeUndefined();
    expect(entries.some((e, i) => e.divider && entries[i + 1]?.divider)).toBe(false);
  });

  it('Move to… names this device the same way everywhere', () => {
    const move = moveMenuEntries([{ id: 'tv', label: 'Living Room TV' }]);
    expect(move.heading).toBe(MENU_LABELS.moveHeading);
    expect(move.entries.map((e) => e.label)).toEqual(['This device', 'Living Room TV']);
  });
});

// Owner ruling 2026-11-26: the info view is PLAY, Play here, Play on… and a More ⋯.
describe('itemMenuEntries: the info view More ⋯', () => {
  const where = { elsewhere: true, short: 'Office Screen', sentence: 'Play on Office Screen' };
  const groups = (entries) => entries.reduce((acc, e) => {
    if (e.divider) acc.push([]); else acc[acc.length - 1].push(e.label);
    return acc;
  }, [[]]);

  it('a film: the queue named for its screen, Show briefly, Quality, then household', () => {
    const entries = itemMenuEntries({ surface: 'detail', kind: 'leaf', where, quality: true });
    expect(groups(entries)).toEqual([
      ['Play Next on Office Screen', 'Play First on Office Screen', 'Add to Queue on Office Screen', 'Add on…'],
      ['Show briefly on…'],
      ['Quality…'],
      ['Add to favourites', 'Mark watched', 'Mark unwatched'],
    ]);
    // Row 1 holds these; More never repeats them.
    for (const k of ['playNow', 'playHere', 'playOn', 'details', 'hide']) expect(kinds(entries)).not.toContain(k);
  });

  it('audio here: plain queue words, no Quality when the item takes none', () => {
    const entries = itemMenuEntries({ surface: 'detail', kind: 'leaf' });
    expect(groups(entries)).toEqual([
      ['Play Next', 'Play First', 'Add to Queue', 'Add on…'],
      ['Show briefly on…'],
      ['Add to favourites', 'Mark watched', 'Mark unwatched'],
    ]);
  });

  it('a show: Shuffle named for its screen leads the queue; no watched marks', () => {
    const entries = itemMenuEntries({ surface: 'detail', kind: 'collection', where, favourite: true });
    expect(groups(entries)[0]).toEqual(['Shuffle on Office Screen', 'Play Next on Office Screen', 'Play First on Office Screen', 'Add to Queue on Office Screen', 'Add on…']);
    expect(labels(entries)).toContain('Remove from favourites');
    expect(kinds(entries)).not.toContain('watched');
    expect(kinds(entries)).not.toContain('unwatched');
    expect(entries.find((e) => e.label === 'Shuffle on Office Screen').kind).toBe('shuffle');
  });
});

describe('splitItemMenu (smart long lists)', () => {
  it('Play, Play on…, Play Next and Add to Queue first; the rest behind More with tidy dividers', () => {
    const where = { elsewhere: true, short: 'Office Screen', sentence: 'Play on Office Screen' };
    const entries = splitItemMenu(itemMenuEntries({ surface: 'row', kind: 'leaf', where }));
    const top = entries.filter((e) => !e.more);
    expect(top.map((e) => e.kind)).toEqual(['playNow', 'playOn', 'playNext', 'add']);
    const more = entries.filter((e) => e.more);
    expect(more.filter((e) => !e.divider).map((e) => e.kind))
      .toEqual(['playHere', 'playFirst', 'addOn', 'details', 'favourite', 'watched', 'unwatched']);
    expect(more[0].divider).toBeUndefined();
    expect(more[more.length - 1].divider).toBeUndefined();
    expect(more.some((e, i) => e.divider && more[i + 1]?.divider)).toBe(false);
  });

  it('Continue takes the Play place when there is a next part; Play Now goes behind More', () => {
    const entries = splitItemMenu(itemMenuEntries({ surface: 'tile', kind: 'collection', continueLabel: 'Continue S2E7', playingOn: { name: 'Office Screen' } }));
    expect(entries.filter((e) => !e.more).map((e) => e.label)).toEqual(['Continue S2E7', 'Play on…', 'Play Next', 'Add to Queue']);
    expect(entries.filter((e) => e.more).map((e) => e.kind)).toEqual(expect.arrayContaining(['playNow', 'openScreen', 'shuffle']));
  });
});
