import { describe, it, expect } from 'vitest';
import { SceneBuilder } from './SceneBuilder.mjs';

const tag = (id, t, category = 'violence_blood_gore/graphic', label = `tag ${id}`) =>
  ({ id, type: 'skip', category, in: t, out: t, label, precision: 'second-approx' });

/** Decision fake: answers by question key; scores per group from a table. */
function fakeDecisions({ situation = 2, picture = [], same = 0.9 } = {}) {
  const calls = [];
  let frame = 0;
  return {
    calls,
    async evaluate(state, questions) {
      calls.push(Object.keys(questions));
      const answers = {};
      for (const [k, q] of Object.entries(questions)) {
        if (q.type === 'yesNo') answers[k] = { probability: same };
        else if (state.frame) answers[k] = { score: picture[frame] ?? 0, confidence: 0.9 };
        else answers[k] = { score: situation, confidence: 0.8 };
      }
      if (state.frame) frame++;
      return { model: 'fake', answers };
    },
  };
}

const media = (cuts = []) => ({
  async shotCuts(_s, t0, t1) { return cuts.filter((c) => c >= t0 && c < t1).map((pts) => ({ pts, score: 0.5 })); },
  async frames(_s, pts) { return [{ pts, png: Buffer.from('x') }]; },
});

const sync = { scale: 1, offsetSec: 10 };

describe('SceneBuilder', () => {
  it('builds a scene with cut edges, situation and second-highest picture levels', async () => {
    // first four frames: the grow probes (2 s and 8 s) either side, quiet; then the 8 scene probes
    const decisions = fakeDecisions({ situation: 2.2, picture: [0, 0, 0, 0, 0, 3, 2, 1, 0, 0, 0, 0] });
    // reference times 100..125; file times +10
    const b = new SceneBuilder({ media: media([95, 150]), decisions, src: 'f', sync });
    const [s] = await b.build([tag('va3', 100), tag('va4', 110), tag('va5', 125)]);
    expect(s.id).toBe('sc-va3');
    expect(s).toMatchObject({ in: 85, out: 140, edges: 'cut', cues: ['va3', 'va4', 'va5'], groups: ['violence_blood_gore'] });
    expect(s.level.violence_blood_gore).toEqual({ situation: 2, picture: 2, confidence: 0.8 });
    expect(s.probes).toBe(8);
  });

  it('drops runs with no scene group (drugs, kissing)', async () => {
    const b = new SceneBuilder({ media: media(), decisions: fakeDecisions(), src: 'f', sync });
    const out = await b.build([tag('va1', 100, 'alcohol_or_drug_use/drugs_illegal'), tag('va2', 105, 'kissing/kissing_normal'), tag('va3', 110, 'alcohol_or_drug_use/drugs_implied')]);
    expect(out).toEqual([]);
  });

  it('asks no same-scene question unless switched on', async () => {
    const decisions = fakeDecisions();
    const b = new SceneBuilder({ media: media(), decisions, src: 'f', sync });
    await b.build([tag('va1', 100), tag('va2', 105), tag('va3', 110), tag('va7', 140), tag('va8', 145), tag('va9', 150)]);
    expect(decisions.calls.some((q) => q.includes('same'))).toBe(false);
  });

  it('merges neighbouring candidates Jev calls one scene', async () => {
    const decisions = fakeDecisions({ same: 0.9 });
    const b = new SceneBuilder({ media: media(), decisions, src: 'f', sync, options: { sameScene: true } });
    const out = await b.build([tag('va1', 100), tag('va2', 105), tag('va3', 110), tag('va7', 140), tag('va8', 145), tag('va9', 150)]);
    expect(out).toHaveLength(1);
    expect(out[0].cues).toEqual(['va1', 'va2', 'va3', 'va7', 'va8', 'va9']);
  });

  it('never merges across a gap over 60 s', async () => {
    const b = new SceneBuilder({ media: media(), decisions: fakeDecisions({ same: 0.99 }), src: 'f', sync, options: { sameScene: true } });
    const out = await b.build([tag('va1', 100), tag('va2', 105), tag('va3', 110), tag('va7', 200), tag('va8', 205), tag('va9', 210)]);
    expect(out).toHaveLength(2);
  });

  it('logs every answer with the question version', async () => {
    const log = [];
    const b = new SceneBuilder({ media: media(), decisions: fakeDecisions(), src: 'f', sync, log: (e) => log.push(e) });
    await b.build([tag('va1', 100), tag('va2', 105), tag('va3', 110)]);
    expect(log.find((e) => e.step === 'scene-situation')).toMatchObject({ scene: 'sc-va1', v: 1, model: 'fake' });
    expect(log.filter((e) => e.step === 'scene-picture')).toHaveLength(8);
    expect(log.filter((e) => e.step === 'scene-grow').map((e) => e.side)).toEqual(['in', 'in', 'out', 'out']);
  });

  it('grows an edge past the farthest graphic probe, to the next shot boundary', async () => {
    // file cuts 72, 95, 150 -> reference 62, 85, 140; scene snaps to 85..140
    // before: 83 quiet, 77 graphic -> grow past 77 to the cut at 62 (15 s); then 60, 54 quiet
    const decisions = fakeDecisions({ picture: [0, 2, 0, 0, 0, 0] });
    const b = new SceneBuilder({ media: media([72, 95, 150]), decisions, src: 'f', sync });
    const [s] = await b.build([tag('va3', 100), tag('va4', 110), tag('va5', 125)]);
    expect(s.in).toBe(62);
    expect(s.out).toBe(140);
    expect(s.grown).toEqual({ in: 23, out: 0 });
  });

  it('stops growing at growMaxSec', async () => {
    const decisions = fakeDecisions({ picture: Array(40).fill(3) });
    const b = new SceneBuilder({ media: media([]), decisions, src: 'f', sync, options: { growMaxSec: 12 } });
    const [s] = await b.build([tag('va3', 100), tag('va4', 110), tag('va5', 125)]);
    expect(s.grown).toEqual({ in: 12, out: 12 });
  });
});
