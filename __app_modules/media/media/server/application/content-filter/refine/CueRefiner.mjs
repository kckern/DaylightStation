/**
 * CueRefiner - turn one coarse cue into a precise observation, asking only
 * the decision model (IDecisionGateway) for judgements.
 *
 * Tools (injected, deterministic): media (frames, audio, shot cuts), renderer
 * (contact sheets, crops, spectrograms), aligner (forced alignment of known
 * words), transcript (word timestamps). They render and measure; the decision
 * model answers small questions about what they render; this class turns the
 * answers into times, frames and regions.
 *
 * Every model call goes through #ask(), which logs the step, the question
 * version and the answers.
 *
 * Result statuses:
 *   refined  times (and region) are ready to write
 *   unknown  could not settle; `reason` and `path` say where it stopped
 *   giveup   searched the whole range and never saw the content (not-found)
 */

import { createSheetSearch, nextMove, viewFrames } from '../../../domain/content-filter/refine/sheetNavigator.mjs';
import { boundaryCandidates } from '../../../domain/content-filter/refine/audioCandidates.mjs';
import { initialKind, wordMatcher } from '../../../domain/content-filter/refine/cueKinds.mjs';
import { assessTrack, simplifyTrack, subCells, boundingRect } from '../../../domain/content-filter/refine/regionTrack.mjs';
import { ms } from '../../../domain/content-filter/refine/timebase.mjs';
import {
  QUESTION_VERSION, routeQuestion, linePickQuestion, tilesPresentQuestion,
  cellsPresentQuestion,
} from './refineQuestions.mjs';


export const DEFAULTS = Object.freeze({
  speechWindowSec: 8,       // search for the tagged word within ±this of the synced time
  speechWidenSec: 15,       // second, wider search
  visualPadSec: 8,          // visual window = [in - pad, out + pad] (synced; VidAngel visual tags drift)
  sweepSec: 20,             // navigator range beyond the window
  probeEverySec: 1,         // window probes: every shot's middle plus one frame per this many seconds
  minContrast: 0.25,        // peak - floor below this: the model cannot tell present from absent here
  absoluteYes: 0.65,        // fixed bands, used when a cue's own scale is unusable
  absoluteNo: 0.35,
  tiles: 12,
  sheetWidth: 640,          // px per probe frame sent to the model (raised to keep the height >= 300)
  minChoiceConfidence: 0.7,
  wordAmbiguitySec: 2,      // two free occurrences closer than this in distance: ask which line
  edgeSnapSec: 0.07,        // snap aligned word edges to the strongest energy edge within ±this
  keyframeFrames: 12,       // region-track keyframe spacing
  maxKeyframes: 40,         // per segment
  coarseGrid: 3,
  fineGrid: 6,
  region: true,
});

/**
 * Yes/no thresholds on this cue's own scale. The model's probabilities rank
 * frames well even when it is unsure in absolute terms, so "present" is set
 * relative to the window's floor (25th percentile) and peak.
 */
export function thresholdsFor(floor, peak, { minContrast = 0.25 } = {}) {
  const contrast = peak - floor;
  if (contrast < minContrast) return { yes: 0.65, no: 0.35, ok: false, contrast: r2(contrast) };
  return { yes: r2(Math.max(0.4, floor + 0.6 * contrast)), no: r2(Math.min(0.5, floor + 0.3 * contrast)), ok: true, contrast: r2(contrast) };
}

function r2(x) {
  return Math.round(x * 100) / 100;
}

export class CueRefiner {
  /**
   * @param {object} deps
   * @param {object} deps.media - FfmpegRefineMedia-like
   * @param {object} deps.renderer - MagickRefineRenderer-like
   * @param {object} deps.decisions - IDecisionGateway
   * @param {{ align(items): Promise<Array> }} [deps.aligner]
   * @param {{ words: Array, segments: Array }} [deps.transcript]
   * @param {object} deps.timebase - makeTimebase()
   * @param {string} deps.src - media path or URL
   * @param {{ scale: number, offset: number }} deps.sync - source -> local clock
   * @param {number} [deps.aspect] - picture width / height (probe frames are sized from it)
 * @param {(entry: object) => void} [deps.log]
   * @param {(name: string, png: Buffer) => string|null} [deps.saveArtifact] - returns a reference for the log
   * @param {object} [deps.options]
   */
  constructor({ media, renderer, decisions, aligner = null, transcript = null, timebase, src, sync, duration = null, aspect = 16 / 9, log = () => {}, saveArtifact = () => null, options = {} }) {
    Object.assign(this, { media, renderer, decisions, aligner, transcript, tb: timebase, src, sync, log, saveArtifact });
    this.duration = duration;
    this.o = { ...DEFAULTS, ...options };
    this.maxFrame = duration ? timebase.frameAt(duration) - 1 : Number.MAX_SAFE_INTEGER;
    // The model needs >= 280 px on the short side; scope frames have a short height
    this.probeWidth = Math.max(this.o.sheetWidth, 2 * Math.ceil((300 * aspect) / 2));
  }

  local(t) {
    return t * (this.sync?.scale ?? 1) + (this.sync?.offset ?? 0);
  }

  async #ask(cue, step, built, extra = {}) {
    const t0 = Date.now();
    let res;
    try {
      res = await this.decisions.evaluate(built.state, built.questions, { timeout: 120000 });
    } catch (err) {
      this.log({ cue: cue.id, step, v: QUESTION_VERSION, error: err.message, ...extra });
      throw err;
    }
    const value = built.read(res.answers);
    this.log({ cue: cue.id, step, v: QUESTION_VERSION, model: res.model, ms: Date.now() - t0, tokens: res.usage?.inputTokens ?? null, value, ...extra });
    return value;
  }

  // ------------------------------------------------------------------ entry

  async refine(cue) {
    let { kind, needsRouting } = initialKind(cue);
    const ctx = { cue, path: [] };
    try {
      if (needsRouting) {
        const r = await this.#ask(cue, 'route', routeQuestion(cue));
        ctx.path.push({ step: 'route', ...r });
        if (r.confidence < this.o.minChoiceConfidence) return this.#unknown(ctx, kind, 'route-unsure');
        kind = r.kind;
      }
      if (kind === 'speech') return await this.#speechWord(ctx);
      if (kind === 'speech-line') return await this.#speechLine(ctx);
      if (kind === 'visual') return await this.#visual(ctx, cue.label);
      if (kind === 'credits') return await this.#visual(ctx, 'Film credits: names or titles as text on screen', { region: false });
      return this.#unknown(ctx, kind, 'kind-unsupported');
    } catch (err) {
      return this.#unknown(ctx, kind, 'error', { error: err.message });
    }
  }

  #unknown(ctx, kind, reason, extra = {}) {
    return { id: ctx.cue.id, status: 'unknown', kind, reason, path: ctx.path, ...extra };
  }

  // ------------------------------------------------------------------ speech

  #wordsNear(t, sec, match) {
    const words = this.transcript?.words || [];
    const out = [];
    words.forEach((w, i) => { if (Math.abs(w.s - t) <= sec && (!match || match(w.w))) out.push(i); });
    return out;
  }

  /**
   * Assign tagged words to transcript occurrences for the whole title before
   * refining: each occurrence serves at most one tag per category leaf (a
   * compound like "goddammit" may serve a god tag and a damn tag). Tags are
   * taken in time order and each takes its nearest free occurrence. A tag with
   * two free occurrences of similar distance is marked ambiguous; the model
   * picks between them when that cue is refined.
   */
  planWords(cues) {
    this.wordPlan = new Map();
    if (!this.transcript) return this.wordPlan;
    const used = new Set();
    const W = this.transcript.words;
    const tagged = cues.map((c) => ({ c, match: wordMatcher(c), kind: initialKind(c).kind }))
      .filter((x) => x.kind === 'speech' && x.match)
      .sort((a, b) => a.c.in - b.c.in);
    for (const { c, match } of tagged) {
      const leaf = String(c.category || '').split('/').pop();
      const expected = this.local(c.in);
      let hits = this.#wordsNear(expected, this.o.speechWindowSec, match);
      if (!hits.length) hits = this.#wordsNear(expected, this.o.speechWidenSec, match);
      const free = hits.filter((i) => !used.has(`${i}|${leaf}`)).sort((i, j) => Math.abs(W[i].s - expected) - Math.abs(W[j].s - expected));
      if (!free.length) { this.wordPlan.set(c.id, { wi: null, hits: hits.length }); continue; }
      const ambiguous = free.length > 1 && Math.abs(W[free[1]].s - expected) - Math.abs(W[free[0]].s - expected) < this.o.wordAmbiguitySec;
      used.add(`${free[0]}|${leaf}`);
      this.wordPlan.set(c.id, { wi: free[0], alternatives: ambiguous ? free.slice(0, 4) : null });
    }
    return this.wordPlan;
  }

  async #speechWord(ctx) {
    const { cue } = ctx;
    if (!this.transcript) return this.#unknown(ctx, 'speech', 'no-transcript');
    if (!this.wordPlan) this.planWords([cue]);
    const plan = this.wordPlan.get(cue.id);
    const expected = this.local(cue.in);
    if (!plan || plan.wi == null) {
      return { id: cue.id, status: 'giveup', kind: 'speech', reason: plan?.hits ? 'occurrences-taken' : 'not-found', expected: ms(expected), path: ctx.path };
    }
    let wi = plan.wi;
    if (plan.alternatives) {
      // Two free occurrences at similar distances: the model picks the line that holds the tag
      const lines = plan.alternatives.map((i) => ({ text: this.#lineAround(i) }));
      const r = await this.#ask(cue, 'word-line', linePickQuestion(cue, lines));
      ctx.path.push({ step: 'word-line', ...r, options: lines.length });
      if (r.index >= 0 && r.confidence >= this.o.minChoiceConfidence) wi = plan.alternatives[r.index];
    }
    return this.#wordEdges(ctx, 'speech', wi, wi);
  }

  async #speechLine(ctx) {
    const { cue } = ctx;
    if (!this.transcript) return this.#unknown(ctx, 'speech-line', 'no-transcript');
    const expected = this.local(cue.in);
    const segs = (this.transcript.segments || []).filter((s) => s.e >= expected - this.o.speechWindowSec && s.s <= this.local(cue.out) + this.o.speechWindowSec);
    if (!segs.length) return { id: cue.id, status: 'giveup', kind: 'speech-line', reason: 'not-found', path: ctx.path };
    const r = await this.#ask(cue, 'line', linePickQuestion(cue, segs.map((s) => ({ text: s.text }))));
    ctx.path.push({ step: 'line', ...r, options: segs.length });
    if (r.index < 0) return { id: cue.id, status: 'giveup', kind: 'speech-line', reason: 'not-found', path: ctx.path };
    if (r.confidence < this.o.minChoiceConfidence) return this.#unknown(ctx, 'speech-line', 'line-unsure');
    const seg = segs[r.index];
    const idx = this.transcript.words.map((w, i) => i).filter((i) => this.transcript.words[i].seg === seg.id);
    if (!idx.length) return this.#unknown(ctx, 'speech-line', 'no-words');
    return this.#wordEdges(ctx, 'speech-line', idx[0], idx[idx.length - 1]);
  }

  #lineAround(i) {
    const w = this.transcript.words;
    return w.slice(Math.max(0, i - 6), i + 7).map((x) => x.w).join(' ');
  }

  /** Settle the start of word `first` and the end of word `last`. */
  async #wordEdges(ctx, kind, first, last) {
    const { cue } = ctx;
    const W = this.transcript.words;
    let start = W[first].s; let end = W[last].e;
    // Forced alignment over the surrounding line gives a second estimate
    if (this.aligner) {
      const ctxIdx = W.map((_, i) => i).filter((i) => W[i].seg === W[first].seg || W[i].seg === W[last].seg);
      const t0 = Math.max(0, W[ctxIdx[0]].s - 0.6); const t1 = W[ctxIdx[ctxIdx.length - 1]].e + 0.6;
      const words = ctxIdx.map((i) => W[i].w);
      const [a] = await this.aligner.align([{ id: `${cue.id}:s`, t0, t1, words, target: ctxIdx.indexOf(first) }]);
      const [b] = first === last ? [a] : await this.aligner.align([{ id: `${cue.id}:e`, t0, t1, words, target: ctxIdx.indexOf(last) }]);
      if (a && !a.error && Math.abs(a.start - start) < 1) start = a.start;
      if (b && !b.error && Math.abs(b.end - end) < 1) end = b.end;
      ctx.path.push({ step: 'align', start, end, whisper: [W[first].s, W[last].e] });
    }
    // Edges: the aligned word edge snapped to the strongest energy edge nearby.
    // Calibration (phase 2) showed the model picking lettered lines on a
    // spectrogram is worse than the aligner on word starts and no better on
    // ends, so speech edges are measured, not asked. The model's part in speech
    // is choosing the word or line (above).
    const clip = await this.media.audio(this.src, start - 0.45, end + 0.45);
    const edges = {};
    for (const edge of ['start', 'end']) {
      const est = edge === 'start' ? start : end;
      const cands = boundaryCandidates(clip, { kind: edge === 'start' ? 'onset' : 'offset', near: est, within: this.o.edgeSnapSec, max: 6 });
      const best = cands.length ? cands.reduce((x, y) => (y.strength > x.strength ? y : x)) : null;
      edges[edge] = best ? { t: best.t, how: 'snap' } : { t: ms(est), how: this.aligner ? 'aligner' : 'transcript' };
    }
    ctx.path.push({ step: 'edges', start: edges.start, end: edges.end });
    if (!edges.start || !edges.end) return this.#unknown(ctx, kind, 'edge-unsure', { estimate: { in: ms(start), out: ms(end) } });
    if (edges.end.t <= edges.start.t) return this.#unknown(ctx, kind, 'edges-reversed', { estimate: { in: ms(start), out: ms(end) } });
    const expected = this.local(cue.in);
    if (Math.abs(edges.start.t - expected) > this.o.speechWidenSec + 1) return this.#unknown(ctx, kind, 'far-from-expected');
    return {
      id: cue.id, status: 'refined', kind, precision: 'ms',
      in: ms(edges.start.t), out: ms(edges.end.t),
      how: `${edges.start.how}/${edges.end.how}`,
      path: ctx.path,
    };
  }

  // ------------------------------------------------------------------ visual

  async #tiles(cue, label, frames, step, extra = {}) {
    const imgs = [];
    for (const f of frames) {
      const [fr] = await this.media.frames(this.src, this.tb.frameStart(f), 1, { width: this.probeWidth });
      imgs.push({ png: fr.png, f });
    }
    const out = [];
    for (let b = 0; b < imgs.length; b += 12) {
      const part = imgs.slice(b, b + 12);
      const v = await this.#ask(cue, step, tilesPresentQuestion(label, part), { frames: part.map((x) => x.f), ...extra });
      out.push(...v);
    }
    return out;
  }

  async #visual(ctx, label, { region = this.o.region } = {}) {
    const { cue } = ctx;
    const tIn = this.local(cue.in) - this.o.visualPadSec;
    const tOut = this.local(cue.out) + this.o.visualPadSec;
    const f0 = Math.max(0, this.tb.frameAt(Math.max(0, tIn)));
    const f1 = Math.min(this.maxFrame, this.tb.frameAt(tOut));

    // 1. Shots in the window; probes at every shot's middle and every probeEverySec
    const cuts = (await this.media.shotCuts(this.src, this.tb.frameStart(f0), this.tb.frameEnd(f1))).map((c) => this.tb.frameAt(c.pts)).filter((f) => f > f0 && f <= f1);
    const bounds = [f0, ...cuts, f1 + 1];
    const shots = [];
    for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] - 1 >= bounds[i]) shots.push({ a: bounds[i], b: bounds[i + 1] - 1 });
    const shotOf = (f) => shots.findIndex((s) => f >= s.a && f <= s.b);
    const every = Math.max(1, Math.round(this.o.probeEverySec * this.tb.fps));
    const set = new Set(shots.map((s) => Math.round((s.a + s.b) / 2)));
    for (let f = f0; f <= f1; f += every) set.add(f);
    const probes = [...set].sort((x, y) => x - y).map((f) => ({ f, si: shotOf(f) }));
    const verdicts = await this.#tiles(cue, label, probes.map((p) => p.f), 'probes');
    probes.forEach((p, i) => { p.p = verdicts[i].p; });

    // 2. This cue's own scale: the model's confidence varies by content, its ranking does not
    const ps = probes.map((p) => p.p).sort((x, y) => x - y);
    const floor = ps[Math.floor(ps.length * 0.25)];
    const peak = ps[ps.length - 1];
    const th = thresholdsFor(floor, peak, this.o);
    ctx.th = th;
    ctx.path.push({ step: 'probes', shots: shots.length, floor: r2(floor), peak: r2(peak), th, probes: probes.map((p) => [p.f, r2(p.p)]) });
    for (const p of probes) p.v = p.p >= th.yes ? true : p.p <= th.no ? false : null;

    const present = probes.filter((p) => p.v === true);
    if (!th.ok || !present.length) {
      // Nothing stands out in the window: sweep outward before giving up
      const mid = this.tb.frameAt(this.local((cue.in + cue.out) / 2));
      ctx.th = th.ok ? th : { yes: Math.max(0.5, this.o.absoluteYes), no: this.o.absoluteNo, ok: true };
      const found = await this.#navigate(ctx, label, 'start', mid, { sweepOnly: true });
      if (found.action === 'giveup') return { id: cue.id, status: 'giveup', kind: 'visual', reason: th.ok ? 'not-found' : 'low-contrast', path: ctx.path };
      if (found.action !== 'done') return this.#unknown(ctx, 'visual', th.ok ? `search-${found.reason || found.action}` : 'low-contrast');
      const end = await this.#navigate(ctx, label, 'end', found.frame + Math.round(this.tb.fps));
      if (end.action !== 'done') return this.#unknown(ctx, 'visual', `end-${end.reason || end.action}`);
      if ([found, end].some((x) => String(x.reason || '').startsWith('bracketed'))) {
        return this.#unknown(ctx, 'visual', 'bracketed-edge', { estimate: { frameIn: found.frame, frameOut: end.frame, ...this.tb.spanToTimes(found.frame, Math.max(found.frame, end.frame)) } });
      }
      return this.#finishVisual(ctx, label, [{ frameIn: found.frame, frameOut: end.frame }], region);
    }

    // 3. Runs of present probes; a confident no between two yeses splits them
    const runs = [];
    let cur = null;
    for (const p of probes) {
      if (p.v === true) {
        if (cur) { cur.lastF = p.f; cur.lastSi = p.si; } else { cur = { firstF: p.f, firstSi: p.si, lastF: p.f, lastSi: p.si }; runs.push(cur); }
      } else if (p.v === false) {
        cur = null;
      }
    }
    // Neighbouring absent probes bound each edge search
    const before = (f) => [...probes].reverse().find((p) => p.f < f && p.v === false)?.f ?? null;
    const after = (f) => probes.find((p) => p.f > f && p.v === false)?.f ?? null;

    // 4. Each run's edges: at a shot cut when the cut frame still shows it, else a contact-sheet search
    const segments = [];
    for (const run of runs) {
      const startF = await this.#edge(ctx, label, 'start', shots[run.firstSi], run.firstF, before(run.firstF));
      const endF = await this.#edge(ctx, label, 'end', shots[run.lastSi], run.lastF, after(run.lastF));
      if (startF.frame == null || endF.frame == null) return this.#unknown(ctx, 'visual', `edge-${startF.reason || endF.reason}`);
      if (endF.frame < startF.frame) return this.#unknown(ctx, 'visual', 'edges-reversed');
      const prev = segments[segments.length - 1];
      if (prev && startF.frame <= prev.frameOut + 1) { prev.frameOut = Math.max(prev.frameOut, endF.frame); continue; }
      segments.push({ frameIn: startF.frame, frameOut: endF.frame, uncertainty: Math.max(startF.uncertainty || 0, endF.uncertainty || 0), bracketed: !!(startF.bracketed || endF.bracketed) });
    }
    // Edges settled only by the bracket fallback were wrong on 11 of 16 in phase 9
    // calibration: propose them for review instead of writing them.
    if (segments.some((x) => x.bracketed)) {
      const t = this.tb.spanToTimes(segments[0].frameIn, segments[segments.length - 1].frameOut);
      return this.#unknown(ctx, 'visual', 'bracketed-edge', { estimate: { frameIn: segments[0].frameIn, frameOut: segments[segments.length - 1].frameOut, ...t } });
    }
    return this.#finishVisual(ctx, label, segments, region);
  }

  /** One edge of a present run, between the present probe and the nearest absent probe outside it. */
  async #edge(ctx, label, kind, shot, presentF, absentF) {
    const th = ctx.th;
    // If the shot's cut lies between the present probe and the absent one, the cut is the first thing to check
    const cutF = shot ? (kind === 'start' ? shot.a : shot.b) : null;
    const cutInside = cutF != null && (absentF == null || (kind === 'start' ? cutF > absentF : cutF < absentF));
    if (cutInside && cutF !== presentF) {
      const [v] = await this.#tiles(ctx.cue, label, [cutF], `edge-${kind}-cut`);
      if (v.p >= th.yes) {
        // Present at the cut frame: the boundary is the cut, unless the frame across it also shows it
        const across = kind === 'start' ? cutF - 1 : cutF + 1;
        const [w] = across >= 0 ? await this.#tiles(ctx.cue, label, [across], `edge-${kind}-across`) : [{ p: 0 }];
        if (w.p <= th.no || absentF == null || across === absentF) {
          ctx.path.push({ step: `edge-${kind}`, at: 'cut', frame: cutF, p: r2(v.p) });
          return { frame: cutF };
        }
      }
    }
    // First sheet: the present frame sits one tile in from the inner end, and the
    // tiles reach back (start) or forward (end) to the absent probe, or a sweep's
    // length when no absent probe is known. Bounds stay wide so the search can pan.
    const sweepF = Math.round(this.o.sweepSec * this.tb.fps);
    const T = this.o.tiles;
    const reach = Math.max(1, Math.abs(presentF - (absentF ?? (kind === 'start' ? presentF - sweepF : presentF + sweepF))));
    const step = Math.max(1, Math.ceil(reach / (T - 2)));
    const f0 = kind === 'start' ? presentF - (T - 2) * step : presentF - step;
    const r = await this.#navigate(ctx, label, kind, presentF, {
      minFrame: Math.max(0, f0 - sweepF), maxFrame: Math.min(this.maxFrame, f0 + (T - 1) * step + sweepF), initialStep: step, f0: Math.max(0, f0),
    });
    if (r.action === 'done') return { frame: r.frame, soft: r.soft, uncertainty: r.uncertainty ?? 0, bracketed: String(r.reason || '').startsWith('bracketed') };
    return { frame: null, reason: r.reason || r.action };
  }

  /** Run a contact-sheet search to completion. */
  async #navigate(ctx, label, kind, expectedFrame, { minFrame, maxFrame, initialStep = 12, sweepOnly = false, f0 = null } = {}) {
    const span = Math.round(this.o.sweepSec * this.tb.fps);
    const th = ctx.th || { yes: this.o.absoluteYes, no: this.o.absoluteNo };
    let search = createSheetSearch({
      kind, expectedFrame, tiles: this.o.tiles, initialStep, yes: th.yes, no: th.no, f0,
      minFrame: minFrame ?? Math.max(0, expectedFrame - span), maxFrame: maxFrame ?? Math.min(this.maxFrame, expectedFrame + span),
      maxMoves: sweepOnly ? 24 : 16,
    });
    for (let look = 0; look < 40; look++) {
      const frames = viewFrames(search);
      const vs = await this.#tiles(ctx.cue, label, frames, `nav-${kind}`, { view: search.view });
      const r = nextMove(search, vs.map((x) => x.p));
      search = r.search;
      if (['done', 'unknown', 'giveup'].includes(r.action)) {
        ctx.path.push({ step: `nav-${kind}`, action: r.action, frame: r.frame, soft: r.soft, reason: r.reason, looks: look + 1, moves: search.path.map((p) => p.action) });
        return r;
      }
    }
    return { action: 'unknown', reason: 'looks' };
  }

  async #finishVisual(ctx, label, segments, region) {
    const { cue } = ctx;
    const out = [];
    for (const s of segments) {
      const t = this.tb.spanToTimes(s.frameIn, s.frameOut);
      const seg = { ...s, ...t };
      if (region) seg.region = await this.#region(ctx, label, s);
      out.push(seg);
    }
    const first = out[0]; const last = out[out.length - 1];
    return {
      id: cue.id, status: 'refined', kind: ctx.cue.category?.startsWith('credits/') ? 'credits' : 'visual', precision: 'frame',
      frameIn: first.frameIn, frameOut: last.frameOut, in: first.in, out: last.out,
      uncertaintyFrames: Math.max(0, ...out.map((s) => s.uncertainty || 0)),
      segments: out, path: ctx.path,
    };
  }

  // ------------------------------------------------------------------ region

  /** Region track for a known segment (frames), outside a full refine. */
  async regionFor(cue, segment, label = cue.label) {
    return this.#region({ cue, path: [] }, label, segment);
  }

  async #region(ctx, label, seg) {
    const { cue } = ctx;
    // No "does it fill the frame?" question: calibration showed it does not
    // separate whole-frame from localized content, while per-cell answers rank
    // cells well. Cells decide, on each keyframe's own scale.
    const G = this.o.coarseGrid; const g = this.o.fineGrid;
    const k = this.o.keyframeFrames;
    const frames = [];
    for (let f = seg.frameIn; f <= seg.frameOut; f += k) frames.push(f);
    if (frames[frames.length - 1] !== seg.frameOut) frames.push(seg.frameOut);
    const keys = [];
    let wholeVotes = 0;
    for (const f of frames.slice(0, this.o.maxKeyframes)) {
      const [img] = await this.media.frames(this.src, this.tb.frameStart(f), 1, { width: 1280 });
      const crops = [];
      for (let c = 0; c < G * G; c++) crops.push({ cell: c, png: await this.renderer.cellCrop(img.png, { grid: G, cell: c }) });
      const coarse = await this.#ask(cue, 'region-coarse', cellsPresentQuestion(label, crops), { frame: f });
      const pick = presentCells(coarse, this.o);
      if (pick.whole) { wholeVotes++; keys.push({ in: f, grid: g, cells: allCells(g), whole: true }); continue; }
      if (pick.cells == null) { keys.push({ in: f, grid: g, cells: null }); continue; }
      let fine = [];
      if (pick.cells.length) {
        const sub = [];
        for (const c of pick.cells) for (const fc of subCells(G, c, g)) sub.push({ cell: fc, png: await this.renderer.cellCrop(img.png, { grid: g, cell: fc, pad: 0.1 }) });
        const subAns = [];
        for (let b = 0; b < sub.length; b += 12) subAns.push(...await this.#ask(cue, 'region-fine', cellsPresentQuestion(label, sub.slice(b, b + 12)), { frame: f }));
        // Fine cells on the coarse frame's scale: keep those reaching its midpoint
        const cut = pick.floor + 0.5 * (pick.peak - pick.floor);
        fine = subAns.filter((x) => x.p >= cut).map((x) => x.cell);
        if (!fine.length) fine = pick.cells.flatMap((c) => subCells(G, c, g));
      }
      keys.push({ in: f, grid: g, cells: fine });
    }
    if (wholeVotes > keys.length / 2) return { whole: true };
    const verdict = assessTrack(keys.filter((x) => !x.whole), { minOverlap: 0.34, maxCoverage: 0.6 });
    if (!verdict.trackable) return { whole: true, track: 'untrackable', reason: verdict.reason };
    const track = simplifyTrack(keys).map((kf) => (kf.whole
      ? { in: ms(this.tb.frameStart(kf.in)), whole: true }
      : { in: ms(this.tb.frameStart(kf.in)), grid: kf.grid, cells: kf.cells ?? [], box: boundingRect(kf.grid, kf.cells ?? []) }));
    track.push({ in: ms(this.tb.frameEnd(seg.frameOut)), cells: [] });
    return { whole: false, track };
  }
}

/**
 * Which coarse cells hold the content, on this keyframe's own scale.
 * @returns {{ cells: number[]|null, whole?: boolean, floor: number, peak: number }}
 *   cells null = cannot tell (flat and middling); whole = content fills the frame
 */
export function presentCells(answers, { minCellContrast = 0.2, wholeCells = 6 } = {}) {
  const ps = answers.map((x) => x.p);
  const sorted = [...ps].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.25)];
  const peak = sorted[sorted.length - 1];
  if (peak - floor < minCellContrast) {
    if (peak >= 0.65) return { cells: answers.map((x) => x.cell), whole: true, floor, peak };
    if (peak <= 0.35) return { cells: [], floor, peak };
    return { cells: null, floor, peak };
  }
  const cut = floor + 0.5 * (peak - floor);
  const cells = answers.filter((x) => x.p >= cut).map((x) => x.cell);
  if (cells.length >= wholeCells) return { cells, whole: true, floor, peak };
  return { cells, floor, peak };
}

function allCells(g) {
  return Array.from({ length: g * g }, (_, i) => i);
}

export default CueRefiner;
