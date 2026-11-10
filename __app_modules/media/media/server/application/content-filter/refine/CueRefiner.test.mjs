import { describe, it, expect } from 'vitest';
import { CueRefiner } from './CueRefiner.mjs';
import { makeTimebase } from '../../../domain/content-filter/refine/timebase.mjs';

const FPS = 24;
const timebase = makeTimebase({ fps: '24/1', startTime: 0 });
const cue = (over = {}) => ({ id: 'va1', type: 'skip', category: 'sex_any/sexually_suggestive', in: 100, out: 110, label: 'A sign is visible.', ...over });

/** Frames are Buffers "F<n>"; cell crops "C|F<n>|<grid>|<cell>". The fake answers from those bytes. */
const media = {
  async shotCuts() { return []; },
  async frames(_s, pts) { return [{ pts, png: Buffer.from(`F${Math.round(pts * FPS)}`) }]; },
};
const renderer = { async cellCrop(png, { grid, cell }) { return Buffer.from(`C|${png}|${grid}|${cell}`); } };

/**
 * Jev stand-in. `present(n)` says whether the subject is on screen at frame n.
 * Whole-frame probes at the window's own cadence (frame % 24 === 0) answer from `present`;
 * any other frame (the edge search's) answers `edgeP`: unsure. Cell crops hold the subject in
 * cell 4 of the 3x3 grid (and every sub-cell of it) while it is present.
 */
function gateway({ present, edgeP = 0.5 } = {}) {
  const calls = [];
  return {
    calls,
    async evaluate(state, questions) {
      calls.push(Object.keys(questions).length);
      const answers = {};
      for (const key of Object.keys(questions)) {
        const i = key.slice(1);
        const img = state[`f${i}`] || state[`c${i}`];
        const bytes = String(img.data);
        let p;
        if (bytes.startsWith('F')) {
          const n = Number(bytes.slice(1));
          p = n % 24 === 0 ? (present(n) ? 0.95 : 0.03) : edgeP;
        } else {
          const [, f, grid, cell] = bytes.split('|');
          const n = Number(f.slice(1));
          const inCell4 = grid === '3' ? Number(cell) === 4 : true;
          p = present(n) && inCell4 ? 0.95 : 0.03;
        }
        answers[key] = { probability: p };
      }
      return { model: 'fake', answers };
    },
  };
}

const refiner = (decisions, extra = {}) => new CueRefiner({
  media, renderer, decisions, timebase, src: 'f', sync: { scale: 1, offset: 0 }, duration: 600, log: extra.log || (() => {}), options: extra.options || {},
  transcript: 'transcript' in extra ? extra.transcript : null,
});

describe('CueRefiner region-only (R2): a shown cue with unsure edges is still tracked', () => {
  it('tracks the region over where Jev saw it and keeps the cue unrefined', async () => {
    const r = await refiner(gateway({ present: (n) => n >= 2400 && n <= 2640 })).refine(cue());
    expect(r.status).toBe('region');
    expect(r).toMatchObject({ kind: 'visual', edges: 'coarse' });
    expect(r.reason).toMatch(/unsure|bracketed/);   // why the edges were not settled
    const track = r.segments[0].region.track;
    expect(track.length).toBeGreaterThanOrEqual(2);   // a static subject simplifies to one keyframe + the closing key
    expect(track.at(-1).cells).toEqual([]);          // closing empty key
    expect(track[0]).toMatchObject({ grid: 6 });
    expect(r.frameIn).toBeGreaterThanOrEqual(2400 - 24);
    expect(r.frameOut).toBeLessThanOrEqual(2640 + 24);
  });

  it('writes no track when Jev sees the subject nowhere', async () => {
    const r = await refiner(gateway({ present: () => false })).refine(cue());
    expect(r.status).not.toBe('region');
    expect(r.status).not.toBe('refined');
  });

  it('writes no track with --no-region', async () => {
    const r = await refiner(gateway({ present: (n) => n >= 2400 && n <= 2640 }), { options: { region: false } }).refine(cue());
    expect(r.status).toBe('unknown');
  });
});

describe('CueRefiner decision timeout', () => {
  it('a timed-out request abstains: unknown / jev-timeout, with a warn line', async () => {
    const log = [];
    const timedOut = { async evaluate() { throw Object.assign(new Error('no answer'), { code: 'JEV_TIMEOUT', timeoutMs: 90000 }); } };
    const r = await refiner(timedOut, { log: (e) => log.push(e) }).refine(cue());
    expect(r).toMatchObject({ status: 'unknown', reason: 'jev-timeout' });
    expect(log.some((e) => e.level === 'warn' && e.event === 'refine.jev.timeout' && e.timeoutMs === 90000)).toBe(true);
  });
});

describe('CueRefiner without a transcript', () => {
  it('a skip cue Jev routes to speech-line ends unknown (no-transcript), without throwing', async () => {
    const routed = { async evaluate() { return { model: 'fake', answers: { route: { choice: 'said', confidence: 0.95 } } }; } };
    const r = await refiner(routed).refine(cue({ category: 'language/language_sexual/other_sexual', label: 'Titles are shown on a billboard and he says what he thinks about them' }));
    expect(r).toMatchObject({ status: 'unknown', kind: 'speech-line', reason: 'no-transcript' });
  });
});
