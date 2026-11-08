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
    expect(r.signOff).toMatchObject({ ready: false, missing: ['2 of 2 parts not reviewed'] });
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
    expect(r.signOff.missing).toEqual(['1 of 2 parts not reviewed', '1 parts changed since you reviewed them']);
    await review.pruneMarks('9');
    expect(Object.keys(state.override.review)).toEqual(['cue:va1']);
    expect((await review.get({ ratingKey: '9' })).signOff.missing).toContain('1 parts changed since you reviewed them');
  });
  it('an uncovered nudge, a failed audit and a stale audit are named', async () => {
    const s = base(); s.override.cueOverrides = { va1: { startMs: 100300, endMs: 100700 } };
    const r = await setup({ state: s, audit: { ok: false, digest: 'OLD', rows: [{ id: 'cue:va1', in: 110.2, out: 110.6, label: 'damn', members: ['va1'] }] }, digest: 'NEW' }).review.get({ ratingKey: '9' });
    expect(r.audit.fresh).toBe(false);
    expect(r.signOff.missing).toEqual(['Not machine-certified: 1 mutes do not cover their word (damn)', 'The audit has not passed', 'The audit is out of date. Run Stage again → Audit.', '1 of 1 parts not reviewed']);
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
