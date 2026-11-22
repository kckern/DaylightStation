import { describe, it, expect } from 'vitest';
import { reviewRows } from './reviewRows.mjs';

const piece = (o) => ({ precision: 'ms', ...o });
const cues = [
  piece({ id: 'w1', category: 'language/profanity/damn', label: 'damn', type: 'mute', effect: 'mute', in: 10.1234, out: 10.5 }),
  piece({ id: 'w2', category: 'language/profanity/hell', label: 'hell', type: 'mute', effect: 'mute', in: 30, out: 36, precision: 'safe-window' }),
  piece({ id: 'b1#0@1', subject: 'subject-b1', category: 'language/language_sexual/x', label: 'Billboard', type: 'skip', effect: 'blur', in: 50, out: 55, regions: [{ in: 50 }] }),
  piece({ id: 'b2#0@1', subject: 'subject-b1', category: 'language/language_sexual/x', label: 'Crude word', type: 'skip', effect: 'blur', in: 51, out: 58 }),
  piece({ id: 'v1', category: 'violence/gore', label: 'Gore', type: 'skip', effect: 'full-blur', in: 70, out: 72 }),
  piece({ id: 'sc-1', scene: 'sc-1', category: 'scene/violence_blood_gore', effect: 'skip-card', in: 100, out: 160 }),
  piece({ id: 'w3', category: 'language/profanity/x', label: 'shut up', type: 'mute', effect: 'skip-card', in: 200, out: 206 }),
  piece({ id: 'h1', category: 'language/profanity/damn', label: 'damn', type: 'mute', effect: 'mute', in: 300, out: 300.4, handFixed: true }),
];
const refined = { scenes: [{ id: 'sc-1', in: 90, out: 150, groups: ['violence_blood_gore'], cues: ['v9'], reviewNote: 'check levels', card: { text: 'Draft card' } }] };
const override = { sceneOverrides: { 'sc-1': { card: { text: 'They fight.' } } }, cueOverrides: { w3: { cardDraft: { text: 'An argument.' } } } };
const refineReview = { items: [{ id: 'w1', status: 'giveup' }], subjectsUnsure: [['v1', 'zz']] };

describe('reviewRows', () => {
  const rows = reviewRows({ cues, refined, override, refineReview });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  it('is one row per moment: a subject is one row, a scene is one row', () => {
    expect(rows.map((r) => r.id).sort()).toEqual(['cue:h1', 'cue:v1', 'cue:w1', 'cue:w2', 'cue:w3', 'scene:sc-1', 'subject:subject-b1'].sort());
    expect(byId['subject:subject-b1'].out).toBe(58);
    expect(byId['scene:sc-1'].peekId).toBe('sc-1');
    expect(byId['subject:subject-b1'].members).toEqual(['b1', 'b2']);
    expect(byId['cue:w1'].members).toEqual(['w1']);
    expect(byId['scene:sc-1'].members).toEqual([]);
  });
  it('carries kind, group, modality, effect, card and hand-fixed, with times rounded to ms', () => {
    expect(byId['cue:w1']).toMatchObject({ kind: 'words', group: 'profanity', modality: 'said', effect: 'mute', in: 10.123 });
    expect(byId['scene:sc-1']).toMatchObject({ kind: 'scenes', group: 'violence_blood_gore', card: { text: 'They fight.', approved: true } });
    expect(byId['cue:w3'].card).toEqual({ text: 'An argument.', approved: false });
    expect(byId['cue:h1'].handFixed).toBe(true);
    expect(byId['cue:w2'].card).toBeNull();
  });
  it('names each unsure reason', () => {
    expect(byId['cue:w1'].unsure).toEqual(['refine-giveup']);
    expect(byId['cue:w2'].unsure).toEqual(['safe-window']);
    expect(byId['scene:sc-1'].unsure).toEqual(['check-levels']);
    expect(byId['cue:w3'].unsure).toEqual(['exchange-by-length']);
    expect(byId['cue:v1'].unsure).toEqual(['untracked-visual', 'subject-unsure']);
    expect(byId['subject:subject-b1'].unsure).toEqual([]);
    expect(byId['cue:h1'].unsure).toEqual([]);
  });
  it('sorts unsure rows first, then by time', () => {
    expect(rows.map((r) => r.id)).toEqual(['cue:w1', 'cue:w2', 'cue:v1', 'scene:sc-1', 'cue:w3', 'subject:subject-b1', 'cue:h1']);
  });
  it('a moment the profile turned off is not a row (it is not in the resolved cues)', () => {
    expect(reviewRows({ cues: [], refined, override, refineReview })).toEqual([]);
  });
});

describe('reviewRows: every part is a row (owner, 2026-11-21)', () => {
  const source = [
    { id: 'w1', category: 'language/profanity/damn', label: 'damn', in: 10, out: 11 },
    { id: 'v9', category: 'violence_blood_gore/non_graphic', label: 'A punch inside the scene', in: 120, out: 125 },
    { id: 'k1', category: 'kissing/kiss', label: 'A couple kisses.', in: 400, out: 404 },
    { id: 'gone', category: 'violence_blood_gore/x', label: 'Cut from this copy', in: 9000, out: 9001 },
  ];
  const sync = { segments: [{ fromVa: 0, toVa: 1000, scale: 1, offsetSec: 0 }] };
  const rows = reviewRows({ cues, source, refined, override: { ...override, sync }, refineReview });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  it('a part the household lets play is a row that says so, after the parts the filter acts on', () => {
    expect(byId['cue:k1']).toMatchObject({ acts: false, effect: 'off', timing: 'rough', members: ['k1'], in: 400, out: 404 });
    expect(rows.at(-1).id).toBe('cue:k1');
    expect(rows.filter((r) => r.acts).every((r) => r.effect !== 'off')).toBe(true);
  });
  it('a part a hidden scene covers is the scene row, not a part that plays', () => {
    expect(byId['cue:v9']).toBeUndefined();
  });
  it('a part outside this copy\'s cut is left out', () => {
    expect(byId['cue:gone']).toBeUndefined();
  });
  it('timing: refined for ms/frame, safe-window, rough otherwise', () => {
    expect(byId['cue:w1'].timing).toBe('refined');
    expect(byId['cue:w2'].timing).toBe('safe-window');
  });
});
