import { describe, it, expect } from 'vitest';
import { ContentFilterReview, ReviewError } from './ContentFilterReview.mjs';

const ref = { workId: 1, tagSetId: 2 };
const base = () => ({
  raw: { title: 'Film', sourceRef: ref, cues: [] },
  refined: { timebase: { clock: 'vidangel' }, certification: { level: 'machine', machine: { at: 'x' } },
    cues: [{ id: 'va1', type: 'mute', category: 'language/x', label: 'damn', in: 100.2, out: 100.6, precision: 'ms' },
      { id: 'va2', type: 'skip', category: 'violence/x', in: 200, out: 202, precision: 'frame' }],
    scenes: [{ id: 'sc1', in: 300, out: 360 }] },
  override: { sync: { scale: 1, offsetSec: 10 } },
});
const rowsOf = () => [{ id: 'cue:va1', in: 110.2, out: 110.6 }, { id: 'cue:va2', in: 210, out: 212 }];
const setup = ({ audit = { ok: true, digest: 'D', rows: rowsOf() }, digest = 'D', state = base(), auditing = false } = {}) => {
  const repo = {
    getEdl: async () => state.raw, getRefinedEdl: async () => state.refined,
    saveRefinedEdl: async (_r, e) => { state.refined = e; },
    getOverride: async () => state.override, saveOverride: async (_rk, o) => { state.override = o; },
    getProfile: async () => ({}),
    appendReviewHistory: async (_rk, e) => { state.history = [...(state.history || []), e]; },
    readReviewHistory: async () => state.history || [],
  };
  const jobs = { record: async () => ({ runs: [], audit }), isAuditing: () => auditing };
  const review = new ContentFilterReview({ contentFilterRepository: repo, jobs, digestOf: async () => digest,
    logger: { info() {}, warn() {} }, clock: () => new Date('2026-11-08T00:00:00Z') });
  return { review, state };
};

describe('ContentFilterReview nudges', () => {
  it('stores a cue nudge as integer ms on the VidAngel clock', async () => {
    const { review, state } = setup();
    await review.nudgeCue({ ratingKey: '9', cueId: 'va1', nudge: { in: 110.1, out: 110.7 } });
    expect(state.override.cueOverrides.va1).toEqual({ startMs: 100100, endMs: 100700 });
  });
  it.each([
    ['moves more than 30 s', { in: 60, out: 110.7 }],
    ['has in >= out', { in: 110.7, out: 110.7 }],
    ['is outside the sync', { in: 5, out: 110.7 }],
  ])('refuses a nudge that %s', async (_n, nudge) => {
    const { review } = setup();
    const s = { ...base() }; s.override = { sync: { scale: 1, offsetSec: 10, segments: [{ fromVa: 50, scale: 1, offsetSec: 10 }] } };
    await expect(setup({ state: s }).review.nudgeCue({ ratingKey: '9', cueId: 'va1', nudge })).rejects.toMatchObject({ status: 400 });
    void review;
  });
  it('clears a nudge with null, and nudges a scene', async () => {
    const { review, state } = setup();
    await review.nudgeCue({ ratingKey: '9', cueId: 'va1', nudge: { in: 110.1, out: 110.7 } });
    await review.nudgeCue({ ratingKey: '9', cueId: 'va1', nudge: null });
    expect(state.override.cueOverrides?.va1).toBeUndefined();
    await review.nudgeScene({ ratingKey: '9', sceneId: 'sc1', nudge: { in: 312, out: 365 } });
    expect(state.override.sceneOverrides.sc1).toEqual({ startMs: 302000, endMs: 355000 });
  });
});

describe('ContentFilterReview marks and sign-off', () => {
  it('a mark with a stale span is refused (409)', async () => {
    const { review } = setup();
    await expect(review.markReviewed({ ratingKey: '9', rowId: 'cue:va1', span: [110.3, 110.6], by: 'p' }))
      .rejects.toMatchObject({ status: 409, message: 'This part moved. Reload the list.' });
  });
  it('approve is refused with the exact missing lines, then accepted when all hold; withdraw removes parent', async () => {
    const { review, state } = setup();
    let r = await review.get({ ratingKey: '9' });
    expect(r.signOff).toMatchObject({ ready: false, missing: ['2 rows have no verdict'] });
    await expect(review.approve({ ratingKey: '9', by: 'p' })).rejects.toBeInstanceOf(ReviewError);
    await review.markReviewed({ ratingKey: '9', rowId: 'cue:va1', span: [110.2, 110.6], by: 'p' });
    await review.markReviewed({ ratingKey: '9', rowId: 'cue:va2', span: [210, 212], by: 'p' });
    r = await review.get({ ratingKey: '9' });
    expect(r).toMatchObject({ reviewed: 2, total: 2, signOff: { ready: true, missing: [] } });
    await review.approve({ ratingKey: '9', by: 'p' });
    expect(state.refined.certification).toMatchObject({ level: 'parent', parent: { by: 'p' } });
    await review.withdraw({ ratingKey: '9', by: 'p' });
    expect(state.refined.certification.parent).toBeUndefined();
    expect(state.refined.certification.level).toBe('machine');
  });
  it('a moved row stops counting and stays named as changed; a mark whose row is gone is pruned', async () => {
    const s = base(); s.override.review = { 'cue:va1': { by: 'p', at: 'x', span: [110.2, 110.6] }, 'cue:gone': { by: 'p', at: 'x', span: [1, 2] } };
    const moved = [{ id: 'cue:va1', in: 110.25, out: 110.6 }, { id: 'cue:va2', in: 210, out: 212 }];
    const { review, state } = setup({ state: s, audit: { ok: true, digest: 'D', rows: moved } });
    const r = await review.get({ ratingKey: '9' });
    expect(r.reviewed).toBe(0);
    expect(r.signOff.missing).toEqual(['1 rows have no verdict', '1 parts changed since you reviewed them']);
    await review.pruneMarks('9');
    expect(Object.keys(state.override.review)).toEqual(['cue:va1']);
    expect((await review.get({ ratingKey: '9' })).signOff.missing).toContain('1 parts changed since you reviewed them');
  });
  it('an uncovered nudge, a failed audit and a stale audit are named', async () => {
    const s = base(); s.override.cueOverrides = { va1: { startMs: 100300, endMs: 100700 } };
    const r = await setup({ state: s, audit: { ok: false, digest: 'OLD', rows: [{ id: 'cue:va1', in: 110.2, out: 110.6, label: 'damn', members: ['va1'] }] }, digest: 'NEW' }).review.get({ ratingKey: '9' });
    expect(r.audit.fresh).toBe(false);
    expect(r.signOff.missing).toEqual(['Not machine-certified: 1 mutes do not cover their word (damn)', 'The audit has not passed', 'The audit is out of date. Run Stage again → Audit.', '1 rows have no verdict']);
  });
  it('sets and clears a word ruling for this film', async () => {
    const { review, state } = setup();
    await review.setTitleWord({ ratingKey: '9', word: 'Damn', value: 'bleep' });
    expect(state.override.profilePatch.languageWords).toEqual({ damn: 'bleep' });
    await review.setTitleWord({ ratingKey: '9', word: 'damn', value: null });
    expect(state.override.profilePatch?.languageWords?.damn).toBeUndefined();
    await expect(review.setTitleWord({ ratingKey: '9', word: 'damn', value: 'loud' })).rejects.toMatchObject({ status: 400 });
  });
  it('while an audit is queued or running, it says so', async () => {
    const r = await setup({ audit: { ok: true, digest: 'OLD', rows: rowsOf() }, digest: 'NEW', auditing: true }).review.get({ ratingKey: '9' });
    expect(r.signOff.missing).toContain('The audit is still running');
    expect(r.audit.running).toBe(true);
  });
  it('returns this film\'s word rulings', async () => {
    const s = base(); s.override.profilePatch = { languageWords: { damn: 'bleep' } };
    expect((await setup({ state: s }).review.get({ ratingKey: '9' })).wordRulings).toEqual({ damn: 'bleep' });
  });
});

describe('ContentFilterReview verdicts', () => {
  const rows = () => [
    { id: 'cue:va1', kind: 'words', category: 'language/x', modality: 'heard', in: 110.2, out: 110.6, effect: 'mute', handFixed: false, unsure: ['safe-window'], members: ['va1'] },
    { id: 'cue:va2', kind: 'picture', category: 'violence/x', modality: 'shown', in: 210, out: 212, effect: 'skip', handFixed: true, unsure: [], members: ['va2'] },
  ];
  const run = () => setup({ audit: { ok: true, digest: 'D', rows: rows() } });
  const span1 = [110.2, 110.6];

  it('stores each verdict, reads a plain mark as approve, and appends history with machine provenance', async () => {
    const { review, state } = run();
    await review.setVerdict('9', 'cue:va1', { verdict: 'redo', reason: 'edges', span: span1, by: 'p', dwellMs: 1500, replays: 2 });
    await review.markReviewed({ ratingKey: '9', rowId: 'cue:va2', span: [210, 212], by: 'p' });
    const r = await review.get({ ratingKey: '9' });
    expect(r.rows[0].verdict).toMatchObject({ verdict: 'redo', reason: 'edges', by: 'p' });
    expect(r.rows[1].verdict).toMatchObject({ verdict: 'approve' });
    expect(state.history[0]).toMatchObject({
      by: 'p', rowId: 'cue:va1', kind: 'words', category: 'language/x', modality: 'heard', effect: 'mute', span: [110.2, 110.6],
      verdict: 'redo', reason: 'edges', dwellMs: 1500, replays: 2,
      machine: { unsure: ['safe-window'], handFixed: false }, film: { stage: 'machine' },
    });
    expect(typeof state.history[0].at).toBe('string');
    expect(state.history).toHaveLength(2);
  });
  it('rejects an unknown verdict or redo reason', async () => {
    const { review } = run();
    await expect(review.setVerdict('9', 'cue:va1', { verdict: 'maybe', span: span1 })).rejects.toMatchObject({ status: 400 });
    await expect(review.setVerdict('9', 'cue:va1', { verdict: 'redo', reason: 'vibes', span: span1 })).rejects.toMatchObject({ status: 400 });
  });
  it('remove disables the cue and undo re-enables it, each appending history', async () => {
    const { review, state } = run();
    await review.setVerdict('9', 'cue:va1', { verdict: 'remove', span: span1, by: 'p' });
    expect(state.override.cueOverrides.va1.disabled).toBe(true);
    await review.clearVerdict({ ratingKey: '9', rowId: 'cue:va1', by: 'p' });
    expect(state.override.cueOverrides?.va1?.disabled).toBeUndefined();
    expect(state.override.review['cue:va1']).toBeUndefined();
    expect(state.history.map((h) => h.verdict)).toEqual(['remove', 'undo']);
    expect(state.history[1]).toMatchObject({ rowId: 'cue:va1', undid: 'remove' });
  });
  it('undo leaves a cue that was already disabled disabled', async () => {
    const s = base(); s.override.cueOverrides = { va1: { disabled: true } };
    const { review, state } = setup({ state: s, audit: { ok: true, digest: 'D', rows: rows() } });
    await review.setVerdict('9', 'cue:va1', { verdict: 'remove', span: span1 });
    await review.clearVerdict({ ratingKey: '9', rowId: 'cue:va1' });
    expect(state.override.cueOverrides.va1.disabled).toBe(true);
  });
  it('an in-place action change is recorded and undo restores the previous effect', async () => {
    const { review, state } = run();
    state.override.cueOverrides = { va1: { effect: 'bleep' } }; // the client already applied mute -> bleep
    await review.setVerdict('9', 'cue:va1', { verdict: 'approve', change: { from: 'mute', to: 'bleep' }, span: span1, by: 'p' });
    expect(state.history[0].change).toEqual({ from: 'mute', to: 'bleep' });
    await review.clearVerdict({ ratingKey: '9', rowId: 'cue:va1' });
    expect(state.override.cueOverrides.va1.effect).toBe('mute');
  });
  it('a verdict on a moved row is refused, and a stored one stops counting', async () => {
    const s = base(); s.override.review = { 'cue:va1': { by: 'p', at: 'x', span: [110.2, 110.6], verdict: 'approve' } };
    const moved = rows(); moved[0].in = 110.25;
    const { review } = setup({ state: s, audit: { ok: true, digest: 'D', rows: moved } });
    const r = await review.get({ ratingKey: '9' });
    expect(r.rows[0].verdict).toBeNull();
    await expect(review.setVerdict('9', 'cue:va1', { verdict: 'approve', span: span1 })).rejects.toMatchObject({ status: 409 });
  });
  it('sign-off is blocked by rows without a verdict and by redo rows', async () => {
    const { review } = run();
    await review.setVerdict('9', 'cue:va1', { verdict: 'redo', span: span1, by: 'p' });
    let r = await review.get({ ratingKey: '9' });
    expect(r.signOff.missing).toEqual(['1 rows have no verdict', '1 rows wait for redo']);
    await review.setVerdict('9', 'cue:va1', { verdict: 'ignore', span: span1, by: 'p' });
    await review.setVerdict('9', 'cue:va2', { verdict: 'approve', span: [210, 212], by: 'p' });
    r = await review.get({ ratingKey: '9' });
    expect(r.signOff).toMatchObject({ ready: true, missing: [] });
  });
});

describe('ContentFilterReview verdicts: review round 1', () => {
  const rows = () => [
    { id: 'cue:va1', kind: 'words', category: 'language/x', modality: 'heard', in: 110.2, out: 110.6, effect: 'mute', handFixed: false, unsure: [], members: ['va1'] },
    { id: 'scene:sc1', kind: 'scenes', category: null, modality: null, in: 310, out: 370, effect: 'skip', handFixed: false, unsure: [], members: [] },
    { id: 'cue:ghost', kind: 'words', category: 'language/x', modality: 'heard', in: 50, out: 51, effect: 'mute', handFixed: false, unsure: [], members: ['ghost'] },
  ];
  const mkr = (extra = {}) => setup({ audit: { ok: true, digest: 'D', rows: rows() }, ...extra });
  const va1 = [110.2, 110.6]; const sc1 = [310, 370];

  it('a scene change undoes with scene semantics: effect only, disabled untouched', async () => {
    const s = base(); s.override.sceneOverrides = { sc1: { effect: 'off', disabled: true, card: { text: 't' } } };
    const { review, state } = mkr({ state: s });
    const before = JSON.parse(JSON.stringify(state.override.sceneOverrides));
    state.override.sceneOverrides.sc1.effect = 'skip'; // client applied off -> skip
    await review.setVerdict('9', 'scene:sc1', { verdict: 'approve', change: { from: 'off', to: 'skip' }, span: sc1 });
    await review.clearVerdict({ ratingKey: '9', rowId: 'scene:sc1' });
    expect(state.override.sceneOverrides).toEqual(before);
  });
  it('a plain re-approve over an approve-with-change keeps the change, and undo still restores it', async () => {
    const { review, state } = mkr();
    state.override.cueOverrides = { va1: { effect: 'bleep' } };
    await review.setVerdict('9', 'cue:va1', { verdict: 'approve', change: { from: 'mute', to: 'bleep' }, span: va1 });
    await review.setVerdict('9', 'cue:va1', { verdict: 'approve', span: va1 });
    expect(state.override.cueOverrides.va1.effect).toBe('bleep');
    await review.clearVerdict({ ratingKey: '9', rowId: 'cue:va1' });
    expect(state.override.cueOverrides.va1.effect).toBe('mute');
  });
  it('approve then remove then approve re-enables the cue', async () => {
    const { review, state } = mkr();
    await review.setVerdict('9', 'cue:va1', { verdict: 'remove', span: va1 });
    expect(state.override.cueOverrides.va1.disabled).toBe(true);
    await review.setVerdict('9', 'cue:va1', { verdict: 'approve', span: va1 });
    expect(state.override.cueOverrides?.va1?.disabled).toBeUndefined();
  });
  it('a widen (edges change) undoes to the prior edges, or clears the nudge when there were none', async () => {
    const { review, state } = mkr();
    state.override.cueOverrides = { va1: { startMs: 100000, endMs: 100800 } }; // widened (sync offset 10 s)
    await review.setVerdict('9', 'cue:va1', { verdict: 'approve', change: { from: { in: 110.1, out: 110.7 }, to: { in: 110, out: 110.8 } }, span: va1 });
    await review.clearVerdict({ ratingKey: '9', rowId: 'cue:va1' });
    expect(state.override.cueOverrides.va1).toEqual({ startMs: 100100, endMs: 100700 });
    state.override.cueOverrides = { va1: { startMs: 100000, endMs: 100800 } };
    await review.setVerdict('9', 'cue:va1', { verdict: 'approve', change: { from: { in: null, out: null }, to: { in: 110, out: 110.8 } }, span: va1 });
    await review.clearVerdict({ ratingKey: '9', rowId: 'cue:va1' });
    expect(state.override.cueOverrides?.va1).toBeUndefined();
  });
  it('machine.stage and film.stage come from filmStage; no jev field', async () => {
    const s = base(); s.refined.certification = { level: 'parent', machine: { at: 'x' }, parent: { by: 'p' } };
    const { review, state } = mkr({ state: s });
    await review.setVerdict('9', 'cue:va1', { verdict: 'ignore', span: va1 });
    expect(state.history[0].machine).toEqual({ stage: 'machine', unsure: [], handFixed: false });
    expect(state.history[0].film.stage).toBe('parent');
  });
  it('remove on an id missing from the refined EDL is refused and writes nothing', async () => {
    const { review, state } = mkr();
    const before = JSON.stringify(state.override);
    await expect(review.setVerdict('9', 'cue:ghost', { verdict: 'remove', span: [50, 51] })).rejects.toMatchObject({ status: 404 });
    expect(JSON.stringify(state.override)).toBe(before);
    expect(state.history).toBeUndefined();
  });
});
