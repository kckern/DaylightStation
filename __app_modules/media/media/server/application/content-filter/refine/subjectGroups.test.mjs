import { describe, it, expect } from 'vitest';
import { groupSubjects, overlapPairs, jevSameSubject } from './subjectGroups.mjs';

const shown = (id, a, b, label = id) => ({ id, type: 'skip', category: 'language/language_sexual/other_sexual', label, in: a, out: b });
const bttf = [shown('va3388987', 100, 112), shown('va3388988', 101, 110), shown('va3388989', 100, 125), shown('va3388990', 104, 120)];

describe('overlapPairs', () => {
  it('pairs only shown cues that overlap in time', () => {
    const cues = [shown('a', 0, 10), shown('b', 5, 15), shown('c', 20, 30), { id: 'w', type: 'mute', category: 'language/profanity/damn', label: 'damn', in: 6, out: 6.4 }];
    expect(overlapPairs(cues).map((p) => `${p.a.id}-${p.b.id}`)).toEqual(['a-b']);
  });
  it('a point tag counts as a second wide', () => {
    expect(overlapPairs([shown('a', 10, 10), shown('b', 10.2, 10.2)])).toHaveLength(1);
  });
});

describe('groupSubjects (R6)', () => {
  it('yes groups all four BTTF billboard tags under one subject', async () => {
    const r = await groupSubjects({ cues: bttf, ask: async () => true });
    expect(r.groups).toEqual([['va3388987', 'va3388988', 'va3388989', 'va3388990']]);
    expect(new Set(Object.values(r.subjects)).size).toBe(1);
    expect(r.subjects.va3388987).toBe('subject-va3388987');
  });
  it.each([['no', async () => false], ['abstain', async () => null], ['timeout', async () => { throw Object.assign(new Error('t'), { code: 'JEV_TIMEOUT' }); }], ['error', async () => { throw new Error('x'); }]])('%s keeps them separate', async (_n, ask) => {
    const r = await groupSubjects({ cues: bttf, ask });
    expect(r.groups).toEqual([]);
    expect(r.subjects).toEqual({});
  });
  it('merges only the pairs Jev said yes to', async () => {
    const ask = async (a, b) => [a.id, b.id].sort().join() === 'va3388987,va3388988';
    const r = await groupSubjects({ cues: bttf, ask });
    expect(r.groups).toEqual([['va3388987', 'va3388988']]);
  });
  it('a re-run keeps existing subjects without asking; reask asks again and can ungroup', async () => {
    const existing = { va3388987: 'subject-x', va3388988: 'subject-x' };
    const asked = [];
    const ask = async (a, b) => { asked.push(`${a.id}-${b.id}`); return false; };
    const kept = await groupSubjects({ cues: bttf.slice(0, 2), existing, ask });
    expect(asked).toEqual([]);
    expect(kept.subjects).toEqual({ va3388987: 'subject-x', va3388988: 'subject-x' });
    const again = await groupSubjects({ cues: bttf.slice(0, 2), existing, ask, reask: true });
    expect(asked).toHaveLength(1);
    expect(again.subjects).toEqual({ va3388987: null, va3388988: null });
  });
  it('a new yes joins an existing group and reuses its id', async () => {
    const existing = { va3388987: 'subject-x', va3388988: 'subject-x' };
    const r = await groupSubjects({ cues: bttf.slice(0, 3), existing, ask: async () => true });
    expect(Object.values(r.subjects)).toEqual(['subject-x', 'subject-x', 'subject-x']);
  });
});

describe('jevSameSubject', () => {
  const timebase = { frameAt: (t) => Math.round(t * 24), frameStart: (f) => f / 24 };
  const media = { async frames(_s, pts) { return [{ pts, png: Buffer.from('F') }]; } };
  const gw = (p, calls = []) => ({ async evaluate(state, q) { calls.push({ state, q }); return { model: 'fake', answers: { same: { probability: p } } }; } });
  const a = shown('a', 0, 10, 'Billboard'); const b = shown('b', 5, 15, 'Crude word');
  it('asks with both labels and a frame from the overlap; only a confident yes groups, an abstain is null', async () => {
    const calls = [];
    expect(await jevSameSubject({ decisions: gw(0.9, calls), media, src: 'f', timebase })(a, b, { in: 5, out: 10 })).toBe(true);
    expect(calls[0].state).toMatchObject({ a: 'Billboard', b: 'Crude word' });
    expect(calls[0].state.frame).toBeTruthy();
    expect(await jevSameSubject({ decisions: gw(0.5), media, src: 'f', timebase })(a, b, { in: 5, out: 10 })).toBe(null);
    expect(await jevSameSubject({ decisions: gw(0.1), media, src: 'f', timebase })(a, b, { in: 5, out: 10 })).toBe(false);
  });
  it('widens the frame for a scope picture so its short side reaches the model minimum (T2 640x266 was refused)', async () => {
    const widths = [];
    const m = { async frames(_s, pts, _n, { width }) { widths.push(width); return [{ pts, png: Buffer.from('F') }]; } };
    await jevSameSubject({ decisions: gw(0.9), media: m, src: 'f', timebase, aspect: 1920 / 800 })(a, b, { in: 5, out: 10 });
    await jevSameSubject({ decisions: gw(0.9), media: m, src: 'f', timebase, aspect: 16 / 9 })(a, b, { in: 5, out: 10 });
    expect(widths[0] / (1920 / 800)).toBeGreaterThanOrEqual(300);
    expect(widths[1]).toBe(640);
  });
  it('a gateway timeout surfaces as no through groupSubjects', async () => {
    const decisions = { async evaluate() { throw Object.assign(new Error('late'), { code: 'JEV_TIMEOUT' }); } };
    const r = await groupSubjects({ cues: [a, b], ask: jevSameSubject({ decisions, media, src: 'f', timebase }) });
    expect(r.groups).toEqual([]);
  });
});

describe('groupSubjects unsure pairs', () => {
  const two = bttf.slice(0, 2);
  it('an abstain or an error lands in unsure', async () => {
    expect((await groupSubjects({ cues: two, ask: async () => null })).unsure).toEqual([['va3388987', 'va3388988']]);
    expect((await groupSubjects({ cues: two, ask: async () => { throw new Error('x'); } })).unsure).toEqual([['va3388987', 'va3388988']]);
  });
  it('a plain no or a yes is not unsure', async () => {
    expect((await groupSubjects({ cues: two, ask: async () => false })).unsure).toEqual([]);
    expect((await groupSubjects({ cues: two, ask: async () => true })).unsure).toEqual([]);
  });
});
