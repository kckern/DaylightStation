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
  it('says whether a part is tracked (has regions)', () => {
    expect(byId['subject:subject-b1'].tracked).toBe(true);
    expect(byId['cue:v1'].tracked).toBe(false);
    const letPlay = reviewRows({ cues: [], source: [piece({ id: 'k9', category: 'violence/gore', label: 'x', type: 'skip', effect: 'blur', in: 5, out: 9, regions: [{ in: 5 }] }), piece({ id: 'k8', category: 'violence/gore', label: 'y', type: 'skip', effect: 'blur', in: 15, out: 19 })] });
    expect(letPlay.find((r) => r.id === 'cue:k9')).toMatchObject({ acts: false, tracked: true });
    expect(letPlay.find((r) => r.id === 'cue:k8')).toMatchObject({ acts: false, tracked: false });
    const viaOverride = reviewRows({ cues: [], source: [piece({ id: 'k7', category: 'violence/gore', label: 'z', type: 'skip', effect: 'blur', in: 25, out: 29 })], override: { cueOverrides: { k7: { regions: [{ in: 25 }] } } } });
    expect(viaOverride.find((r) => r.id === 'cue:k7')).toMatchObject({ acts: false, tracked: true }); // regions stored only in the override
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

describe('reviewRows: what the resolver stands for is filtered, not playing (review 2026-11-21)', () => {
  const resolved = [
    // a subject piece: its id is the subject, its members in `cues`
    { id: 'sub-a', subject: 'sub-a', cues: ['s1', 's2'], category: 'sex_nudity_immodesty/x', label: 'Billboard', effect: 'blur', in: 50, out: 58, precision: 'ms' },
    // two bleeps merged into one tone keep the first id; mergedFrom names both
    { id: 'w2', category: 'language/profanity/damn', label: 'damn', effect: 'bleep', in: 80, out: 81, merged: true, mergedFrom: ['w2', 'w3'], precision: 'ms' },
    { id: 'v1', category: 'violence/gore', label: 'Gore', effect: 'full-blur', in: 70, out: 75, precision: 'ms' },
  ];
  const source = [
    { id: 's1', category: 'sex_nudity_immodesty/x', label: 'Billboard', in: 50, out: 55 },
    { id: 's2', category: 'sex_nudity_immodesty/x', label: 'Poster', in: 52, out: 58 },
    { id: 'w2', category: 'language/profanity/damn', label: 'damn', in: 80, out: 80.4 },
    { id: 'w3', category: 'language/profanity/damn', label: 'damn', in: 80.6, out: 81 },
    { id: 'v2', kind: 'visual', category: 'violence/mild', label: 'A shove under the gore blur', in: 71, out: 73 },
    { id: 'gone', category: 'language/profanity/hell', label: 'hell', in: 90, out: 90.5 },
    { id: 'k1', category: 'kissing/kiss', label: 'A kiss.', in: 95, out: 97 },
  ];
  const rows = reviewRows({ cues: resolved, source, override: { cueOverrides: { gone: { disabled: true } } } });
  const ids = rows.map((r) => r.id);
  it('subject members, merged tones and a covered picture cue are not "Plays" rows', () => {
    for (const id of ['cue:s1', 'cue:s2', 'cue:w3', 'cue:v2']) expect(ids).not.toContain(id);
    expect(rows.find((r) => r.id === 'subject:sub-a').members).toEqual(['s1', 's2']);
  });
  it('a playing part says why: removed by a verdict, or the settings', () => {
    expect(rows.find((r) => r.id === 'cue:gone')).toMatchObject({ acts: false, why: 'removed' });
    expect(rows.find((r) => r.id === 'cue:k1')).toMatchObject({ acts: false, why: 'settings' });
  });
});

describe('reviewRows: one moment tagged twice is one row (review 2026-11-21)', () => {
  it('merges same label, same span, same effect cue rows; members keep both', () => {
    const twin = (id) => ({ id, category: 'language/blasphemy/god', label: 'G*d', type: 'mute', effect: 'mute', in: 629.35, out: 630.6, precision: 'second-approx' });
    const rows = reviewRows({ cues: [twin('va1'), twin('va2')], source: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0].members.sort()).toEqual(['va1', 'va2']);
  });
});
