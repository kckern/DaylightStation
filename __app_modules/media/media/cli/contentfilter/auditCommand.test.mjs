import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { computeAudit, formatAudit, runAudit, AUDIT_USAGE } from './auditCommand.mjs';

const sync = { offsetSec: 0, scale: 1 };
const track = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => ({ in: a + i, grid: 6, cells: [8, 9], box: { x: 0.3, y: 0.2, w: 0.3, h: 0.2 } })).concat([{ in: b + 1, cells: [] }]);
const shown = (id, a, b, over = {}) => ({ id, type: 'skip', category: 'sex_any/sexually_suggestive', label: `sign ${id}`, in: a, out: b, precision: 'frame', ...over });
const word = (id, t, over = {}) => ({ id, type: 'mute', category: 'language/profanity/damn', label: 'damn', in: t, out: t + 0.4, precision: 'ms', ...over });
const line = (id, a, b, over = {}) => ({ id, type: 'mute', category: 'language/profanity/other', label: 'He says something rude to her', in: a, out: b, tagIn: a, tagOut: b, precision: 'second-approx', ...over });
const profile = { categories: { language: { effect: 'bleep' }, sex_any: { effect: 'blur' } } };

const film = () => ({
  title: 'Fixture', timebase: { clock: 'vidangel' },
  certification: { level: 'machine' },
  cues: [
    word('w1', 10), word('w2', 20, { category: 'language/blasphemy/god', label: 'G*d' }), word('w3', 30, { category: 'language/childish/jerk', label: 'jerk' }),
    word('w4', 40, { category: 'language/language_racial/other', label: 'slur' }),
    line('l1', 50, 53), line('x1', 60, 70), line('x2', 80, 90),
    shown('s1', 100, 112, { subject: 'sub-a' }), shown('s2', 101, 110, { subject: 'sub-a', regions: track(101, 110) }),
    shown('s3', 200, 210, { regions: track(200, 210) }),
    shown('s4', 300, 310, { regions: track(300, 310), refine: { edges: 'coarse' }, precision: 'second-approx' }),
    shown('s5', 400, 410),
  ],
  scenes: [{ id: 'sc-1', in: 95, out: 115, edges: 'cut', cues: ['s1', 's2'], groups: ['sex_any'] }],
});
const override = { sync, cueOverrides: { x1: { card: { text: 'They argue.' } } } };

describe('computeAudit', () => {
  const r = computeAudit({ edl: film(), profile, override });

  it('passes the hard checks on a well-formed film', () => {
    expect(r.checks.toneCap).toMatchObject({ ok: true, violations: 0, ids: [] });
    expect(r.checks.channel).toMatchObject({ ok: true, audioOnShown: [], visualOnSaid: [] });
    expect(r.ok).toBe(true);
  });
  it('counts shown cues with a region track, coarse-edge ones separately, and flags the 70% target', () => {
    // s1+s2 (group, tracked via s2), s3, s4 tracked; s5 not
    expect(r.regions).toMatchObject({ shown: 5, tracked: 4, coarseEdge: 1, target: 0.7, withTrackData: 3 });
    expect(r.regions.share).toBeCloseTo(0.8, 5);
    // The Proof metric is the DATA share (shown cues carrying a track): 3/5 misses the 70% target.
    expect(r.regions.pass).toBe(false);
    const low = computeAudit({ edl: { ...film(), cues: film().cues.filter((c) => !['s2', 's3', 's4'].includes(c.id)) }, profile, override });
    expect(low.regions.pass).toBe(false);
    expect(low.ok).toBe(true); // soft target: does not fail the exit
  });
  it('a profile full-blur on tracked cues resolves regional too (R2); the data share is counted alongside', () => {
    const fullFrame = { categories: { language: { effect: 'bleep' }, sex_any: { effect: 'full-blur' } } };
    const f = computeAudit({ edl: film(), profile: fullFrame, override });
    expect(f.regions.tracked).toBe(4); // a full-blur with a track is the regional blur, alone or in a group
    expect(f.regions).toMatchObject({ shown: 5, withTrackData: 3 });
    expect(f.regions.dataShare).toBeCloseTo(0.6, 5);
    expect(formatAudit(f)).toMatch(/track data 3\/5/);
  });
  it('PASS/FAIL on the region target follows the data share; the resolved share is printed as info', () => {
    const fullFrame = { categories: { language: { effect: 'bleep' }, sex_any: { effect: 'full-blur' } } };
    const e = film(); e.cues = e.cues.map((c) => (c.id === 's1' || c.id === 's5' ? { ...c, regions: track(c.in, c.out) } : c));
    const f = computeAudit({ edl: e, profile: fullFrame, override });
    expect(f.regions.tracked).toBe(5);
    expect(f.regions.dataShare).toBeCloseTo(1, 5);
    expect(f.regions.pass).toBe(true);
    expect(formatAudit(f)).toMatch(/region tracks on shown\s+PASS\s+track data 5\/5 \(100%, target 70%\); resolved regional 5\/5 \(100%\)/);
  });
  it('a same-subject group nothing resolves for (profile off) is "no effect", not a failure', () => {
    const off = { categories: { language: { effect: 'bleep' }, sex_any: { effect: 'off' } } };
    const o = computeAudit({ edl: film(), profile: off, override });
    expect(o.subjects).toMatchObject({ groups: 1, noEffect: 1, resolvedOne: 0 });
    expect(formatAudit(o)).toMatch(/same-subject groups\s+n\/a/);
  });
  it('counts same-subject groups and the share resolved to one effect', () => {
    expect(r.subjects).toMatchObject({ groups: 1, members: 2, resolvedOne: 1, share: 1 });
  });
  it('counts R4 lines muted, exchanges skipped, and cards approved vs generic', () => {
    expect(r.lines).toMatchObject({ muted: 1, skipped: 2, cardsApproved: 1, cardsGeneric: 1 });
  });
  it('reports scene edge leaks and certification', () => {
    expect(r.scenes.leaks).toEqual([]);
    expect(r.certification.level).toBe('machine');
    const leaky = film(); leaky.scenes[0].in = 105;
    expect(computeAudit({ edl: leaky, profile, override }).scenes.leaks).toEqual([{ scene: 'sc-1', cues: ['s1', 's2'] }]);
  });
  it('counts language per R9 group with the effect each resolved to', () => {
    expect(r.language.profanity).toMatchObject({ total: 4, effects: { bleep: 1, mute: 1, 'skip-card': 2 } });
    expect(r.language.blasphemy.total).toBe(1);
    expect(r.language.slurs.total).toBe(1);
    expect(r.language.childish.total).toBe(1);
    expect(r.language.sexual.total).toBe(0);
    expect(r.language.unknown.total).toBe(0);
    const withChildOff = computeAudit({ edl: film(), profile: { ...profile, categories: { ...profile.categories, 'language/childish': { effect: 'off' } } }, override });
    expect(withChildOff.language.childish.effects).toEqual({ off: 1 });
  });
  it('puts a language tag with no known group term under unknown', () => {
    const edl = { ...film(), cues: [word('u1', 5, { category: 'language' })] };
    expect(computeAudit({ edl, profile, override }).language.unknown.total).toBe(1);
  });
});

describe('hard checks fail (injected resolver output)', () => {
  const edl = film();
  const base = { edl, profile, override };
  it('a tone longer than 1.5 s', () => {
    const r = computeAudit({ ...base, resolve: () => [{ id: 'w1', effect: 'bleep', in: 10, out: 12.2 }, { id: 'w2', effect: 'bleep', in: 20, out: 21.5 }] });
    expect(r.checks.toneCap).toMatchObject({ ok: false, violations: 1, ids: ['w1'] });
    expect(r.ok).toBe(false);
  });
  it('an audio effect on a shown cue', () => {
    const r = computeAudit({ ...base, resolve: () => [{ id: 's3', effect: 'mute', in: 200, out: 210 }] });
    expect(r.checks.channel.audioOnShown).toEqual(['s3']);
    expect(r.ok).toBe(false);
  });
  it('a visual effect on a said cue', () => {
    const r = computeAudit({ ...base, resolve: () => [{ id: 'w1@2', effect: 'blur', in: 10, out: 11 }] });
    expect(r.checks.channel.visualOnSaid).toEqual(['w1']);
    expect(r.ok).toBe(false);
  });
  it('a group that resolves to two effects is not counted as resolved to one', () => {
    const r = computeAudit({ ...base, resolve: () => [{ id: 'sub-a@0', effect: 'blur', cues: ['s1', 's2'], in: 100, out: 105 }, { id: 'sub-a@1', effect: 'full-blur', cues: ['s1', 's2'], in: 105, out: 112 }] });
    expect(r.subjects).toMatchObject({ groups: 1, resolvedOne: 0, share: 0 });
  });
});

describe('formatAudit and runAudit', () => {
  it('prints a table with the verdicts', () => {
    const text = formatAudit(computeAudit({ edl: film(), profile, override }));
    expect(text).toMatch(/tone cap/i);
    expect(text).toMatch(/region tracks.*4\/5/);
    expect(text).toMatch(/profanity/);
  });
  it('loads the refined EDL, override and the named profile from disk and merges profilePatch', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'audit-'));
    const media = path.join(root, 'media'); const data = path.join(root, 'data');
    for (const d of ['edl', 'refined'].map((x) => path.join(media, x))) mkdirSync(d, { recursive: true });
    for (const d of ['overrides', 'profiles'].map((x) => path.join(data, x))) mkdirSync(d, { recursive: true });
    const raw = { title: 'Fixture', sourceRef: { workId: 7, tagSetId: 9 }, cues: [] };
    writeFileSync(path.join(media, 'edl', '55.edl.yml'), yaml.dump(raw));
    writeFileSync(path.join(media, 'refined', '7-9.edl.yml'), yaml.dump({ ...film(), sourceRef: raw.sourceRef }));
    writeFileSync(path.join(data, 'overrides', '55.yml'), yaml.dump({ ...override, profilePatch: { categories: { 'language/childish': { effect: 'mute' } } } }));
    writeFileSync(path.join(data, 'profiles', 'family.yml'), yaml.dump(profile));
    const r = runAudit({ rk: '55', flags: {}, args: [], mediaFilterDir: media, dataFilterDir: data });
    expect(r.profile).toBe('family');
    expect(r.language.childish.effects).toEqual({ mute: 1 });
    expect(() => runAudit({ rk: '55', flags: { profile: 'nope' }, args: [], mediaFilterDir: media, dataFilterDir: data })).toThrow(/profile/);
  });
  it('has a usage string', () => { expect(AUDIT_USAGE).toMatch(/audit <ratingKey>/); });
});

describe('computeAudit: words treated as exchanges', () => {
  it('counts a word-labelled cue whose tag span is over 4 s', () => {
    const e = film(); e.cues.push(word('wl', 500, { label: 'd*mn', out: 512, tagIn: 500, tagOut: 512 }));
    const r = computeAudit({ edl: e, profile, override });
    expect(r.lines.wordsAsExchanges).toBe(1);
    expect(formatAudit(r)).toMatch(/1 words treated as exchanges/);
  });
});

describe('computeAudit certification counts nudges', () => {
  it('a nudge that uncovers a word blocks certification', () => {
    const edl = { timebase: { clock: 'vidangel' }, certification: { level: 'machine' },
      cues: [{ id: 'va1', type: 'mute', category: 'language/x', in: 100.2, out: 100.6, precision: 'ms' }] };
    const r = computeAudit({ edl, profile: { categories: { 'language/x': { effect: 'mute' } } },
      override: { cueOverrides: { va1: { startMs: 100300, endMs: 100700 } } } });
    expect(r.certification).toEqual({ level: 'none', blocking: ['va1'] });
  });
});
