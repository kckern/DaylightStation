import { describe, it, expect } from 'vitest';
import { buildMoments, groupCounts, upcoming, nextOfEach, matchesFind, sceneRows, cardOf, levelLines, sceneName, selectionKey } from './railItems.js';

const CUES = [
  { id: 'w1', in: 10, out: 10.4, effect: 'mute', label: 'd*mn' },
  { id: 'va5@0', in: 20, out: 20.5, effect: 'blur', label: 'A sign' },
  { id: 'va5@1', in: 20.5, out: 22, effect: 'full-blur', label: 'A sign' },
  { id: 'sc1', scene: 'sc1', in: 50, out: 80, effect: 'skip-card', category: 'scene/sex_any' },
  { id: 'w2', in: 90, out: 90.3, effect: 'bleep', label: 'h*ll' },
  { id: 'va7', in: 95, out: 99, effect: 'skip', label: 'A kiss' },
];
const SCENES = [{ id: 'sc1', groups: ['sex_any'], in: 50, out: 80 }, { id: 'sc2', in: 200, out: 230, groups: ['violence_blood_gore', 'sex_any'], level: { violence_blood_gore: { situation: 3, picture: 2 } } }];

describe('railItems', () => {
  const ms = buildMoments(CUES, SCENES);
  it('folds pieces into moments with the strongest effect and the full span', () => {
    expect(ms.map((m) => m.key)).toEqual(['cue:w1', 'cue:va5', 'scene:sc1', 'cue:w2', 'cue:va7']);
    const blur = ms[1];
    expect(blur).toMatchObject({ id: 'va5', group: 'picture', effect: 'full-blur', in: 20, out: 22 });
    expect(ms[2]).toMatchObject({ kind: 'scene', group: 'scenes', label: 'Sexual content scene' });
    expect(ms[4].group).toBe('scenes'); // a lone skip is a cut
  });
  it('counts per group', () => { expect(groupCounts(ms)).toEqual({ all: 5, words: 2, picture: 1, scenes: 2 }); });
  it('next per group and in total', () => {
    expect(upcoming(ms, 'words', 10).map((m) => m.id)).toEqual(['w2']);
    expect(upcoming(ms, 'all', 0, 2).map((m) => m.id)).toEqual(['w1', 'va5']);
    const each = nextOfEach(ms, 15);
    expect(each.words).toMatchObject({ after: 0 });
    expect(each.words.next.id).toBe('w2');
    expect(each.scenes.next.id).toBe('sc1');
    expect(each.scenes.after).toBe(1);
    expect(nextOfEach(ms, 100).picture.next).toBeNull();
  });
  it('finds censored words by letters, and plain text', () => {
    expect(matchesFind(ms[0], 'damn')).toBe(true);
    expect(matchesFind(ms[0], 'dumb')).toBe(false);
    expect(matchesFind(ms[1], 'sign')).toBe(true);
    expect(matchesFind(ms[3], 'what the hell')).toBe(true);
  });
  it('splits scenes into cut and shown', () => {
    const { cut, shown } = sceneRows(ms, SCENES);
    expect(cut.map((m) => m.id)).toEqual(['sc1', 'va7']);
    expect(shown.map((m) => m.id)).toEqual(['sc2']);
    expect(shown[0].label).toBe('Violence and sexual content scene');
  });
  it('card status from rulings and drafts', () => {
    const sc = ms[2];
    expect(cardOf(sc, {}).status).toBe('none');
    expect(cardOf({ ...sc, scene: { card: { text: 'x' } } }, {})).toEqual({ status: 'draft', text: 'x' });
    expect(cardOf(sc, { sceneOverrides: { sc1: { card: { text: 'y' } } } })).toEqual({ status: 'approved', text: 'y' });
    expect(cardOf(ms[4], { cueOverrides: { va7: { cardDraft: { text: 'z' } } } }).status).toBe('draft');
  });
  it('levels and names in plain words', () => {
    expect(levelLines(SCENES[1])).toEqual(['Violence: torture or cruel killing, injury shown']);
    expect(sceneName({})).toBe('Flagged scene');
    expect(selectionKey({ id: 'va5@1' })).toBe('cue:va5');
    expect(selectionKey({ id: 'sc1', kind: 'scene' })).toBe('scene:sc1');
  });
});
