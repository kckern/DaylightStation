/**
 * SceneBuilder - turn a refined EDL's tags into scenes with edges and levels,
 * asking only the decision model (IDecisionGateway) for judgements.
 *
 *   candidates (groupScenes)  ->  same scene (Jev, optional)  ->  edges (shot cuts)
 *   ->  situation per group (Jev, text)  ->  picture per group (Jev, frames)
 *
 * Scenes are on the refined EDL's clock (VidAngel); media is read on the
 * copy's own clock through its sync. Design:
 * ops:docs/superpowers/specs/2026-11-06-content-filter-scenes-design.md
 */

import { groupScenes } from '../../../domain/content-filter/refine/sceneGroups.mjs';
import {
  sceneId, sceneGroupsOf, sceneEdges, probeTimes, pictureLevel, nextBoundary, EDGE_REACH_SEC, TAG_LEAD_SEC,
} from '../../../domain/content-filter/refine/scenes.mjs';
import { mapTime, unmapTime } from '../../../../../../../shared/contracts/content-filter/syncMap.mjs';
import { SCENE_QUESTION_VERSION, sameSceneQuestion, situationQuestion, pictureQuestion } from './sceneQuestions.mjs';

export const SCENE_DEFAULTS = Object.freeze({
  sameScene: false,     // Jev merge/split; on only where calibration showed it beats the gap rule
  sameYes: 0.65,
  sameNo: 0.35,
  maxMergeGapSec: 60,
  splitGapSec: 10,      // ask about neighbouring tags inside a candidate this far apart
  contextSec: 15,       // dialogue either side of the scene for the situation question
  probeWidth: 640,
  growMaxSec: 60,       // an edge grows outward at most this far while the picture next to it is graphic
  growAt: 2,            // picture level (any scene group) that counts as graphic next to an edge
});

const r3 = (x) => Math.round(x * 1000) / 1000;

export class SceneBuilder {
  /**
   * @param {object} deps
   * @param {object} deps.media - FfmpegRefineMedia-like: shotCuts(src,t0,t1), frames(src,pts,count,{width})
   * @param {object} deps.decisions - IDecisionGateway
   * @param {string} deps.src
   * @param {object} deps.sync - the copy's sync (refined clock -> file time)
   * @param {Array<{ s: number, e: number, text: string }>} [deps.segments] - transcript lines, file time
   * @param {string} [deps.title]
   * @param {(entry: object) => void} [deps.log]
   * @param {object} [deps.options]
   */
  constructor({ media, decisions, src, sync, segments = [], title = '', log = () => {}, options = {} }) {
    Object.assign(this, { media, decisions, src, sync, segments, title, log });
    this.opt = { ...SCENE_DEFAULTS, ...options };
  }

  toFile(t) { return mapTime(t, this.sync) ?? t; }
  toRef(t) { return unmapTime(t, this.sync) ?? t; }

  /** @returns {Promise<Array<object>>} scenes, sorted by time */
  async build(cues) {
    const byId = new Map();
    for (const c of cues) if (!byId.has(c.id)) byId.set(c.id, c);
    // Jev needs >= 280 px per side: widen probe frames for wide pictures (height >= 300).
    const probe = this.media.probe ? await this.media.probe(this.src) : null;
    if (probe?.width && probe?.height) {
      this.opt.probeWidth = Math.max(this.opt.probeWidth, 2 * Math.ceil((300 * probe.width) / probe.height / 2));
    }
    let groups = groupScenes(cues).map((g) => g.cues.map((id) => byId.get(id)));
    if (this.opt.sameScene) groups = await this.#sameScene(groups);
    const scenes = [];
    for (const members of groups) {
      const s = await this.#scene(members);
      if (s) scenes.push(s);
    }
    return scenes.sort((a, b) => a.in - b.in);
  }

  async #ask(scene, step, built, extra = {}) {
    const t0 = Date.now();
    let res;
    try {
      res = await this.decisions.evaluate(built.state, built.questions, { timeout: 120000 });
    } catch (err) {
      this.log({ scene, step, v: SCENE_QUESTION_VERSION, error: err.message, ...extra });
      throw err;
    }
    const value = built.read(res.answers);
    this.log({ scene, step, v: SCENE_QUESTION_VERSION, model: res.model, ms: Date.now() - t0, value, ...extra });
    return value;
  }

  dialogue(t0, t1) {
    const a = this.toFile(t0); const b = this.toFile(t1);
    return this.segments.filter((s) => s.e >= a && s.s <= b).map((s) => String(s.text).trim()).filter(Boolean).join('\n');
  }

  /** Merge neighbouring candidates Jev calls one scene; split a candidate where it says the story moved on. */
  async #sameScene(groups) {
    const { sameYes, sameNo, maxMergeGapSec, splitGapSec } = this.opt;
    const ask = async (a, b) => {
      const gap = b.in - a.out;
      const { p } = await this.#ask(`${a.id}|${b.id}`, 'scene-same', sameSceneQuestion({
        title: this.title, a: a.label, b: b.label, gapSec: gap, dialogue: this.dialogue(a.out, b.in),
      }));
      return p;
    };
    const split = [];
    for (const g of groups) {
      let cur = [g[0]];
      for (let i = 1; i < g.length; i++) {
        const a = cur[cur.length - 1]; const b = g[i];
        if (b.in - a.out >= splitGapSec && (await ask(a, b)) <= sameNo) { split.push(cur); cur = [b]; } else cur.push(b);
      }
      split.push(cur);
    }
    const merged = [split[0]];
    for (let i = 1; i < split.length; i++) {
      const prev = merged[merged.length - 1]; const next = split[i];
      const a = prev[prev.length - 1]; const b = next[0];
      if (b.in - a.out <= maxMergeGapSec && (await ask(a, b)) >= sameYes) prev.push(...next); else merged.push(next);
    }
    return merged.filter((g) => g.length);
  }

  /**
   * Grow each edge outward, a shot at a time, while the picture just past it is
   * still graphic (Jev, any scene group at growAt or above), up to growMaxSec.
   * VidAngel tags mark moments; a fight keeps going between them.
   * @returns {{ in: number, out: number }|null} seconds grown on each side
   */
  async #grow(id, span, cuts, groups, hint) {
    const grown = { in: 0, out: 0 };
    for (const dir of [-1, 1]) {
      const side = dir < 0 ? 'in' : 'out';
      while (grown[side] < this.opt.growMaxSec) {
        const edge = span[side];
        const next = nextBoundary(edge, cuts, dir);
        const t = r3(edge + dir * Math.min(2, Math.abs(next - edge) / 2));
        if (t <= 0) break;
        const [fr] = await this.media.frames(this.src, this.toFile(t), 1, { width: this.opt.probeWidth });
        if (!fr) break;
        const score = await this.#ask(id, 'scene-grow', pictureQuestion({ png: fr.png, groups, hint }), { t, side });
        if (!groups.some((g) => Math.round(score[g]) >= this.opt.growAt)) break;
        grown[side] = r3(grown[side] + Math.abs(next - edge));
        span[side] = r3(Math.max(0, next));
      }
    }
    return grown.in || grown.out ? grown : null;
  }

  async #scene(members) {
    const groups = sceneGroupsOf(members.map((m) => m.category));
    if (!groups.length) return null;
    const id = sceneId(members.map((m) => m.id));
    const reach = TAG_LEAD_SEC + EDGE_REACH_SEC + this.opt.growMaxSec + 1;
    const lo = Math.min(...members.map((m) => m.in)) - reach;
    const hi = Math.max(...members.map((m) => m.out)) + reach;
    const cuts = (await this.media.shotCuts(this.src, this.toFile(Math.max(0, lo)), this.toFile(hi)))
      .map((c) => r3(this.toRef(c.pts)));
    const edges = sceneEdges({ members, cuts });
    const span = { in: edges.in, out: edges.out };
    const hint = [...new Set(members.map((m) => m.label))].slice(0, 3).join('; ');
    const grown = await this.#grow(id, span, cuts, groups, hint);
    const uncovered = members.filter((m) => m.in < span.in || m.out > span.out).map((m) => m.id);
    if (uncovered.length) this.log({ scene: id, step: 'scene-edge-uncovered', cues: uncovered, ...span });

    const situation = await this.#ask(id, 'scene-situation', situationQuestion({
      title: this.title,
      tags: members.map((m) => `${m.label} (${m.category})`),
      dialogue: this.dialogue(span.in - this.opt.contextSec, span.out + this.opt.contextSec),
      groups,
    }));

    const perFrame = [];
    for (const t of probeTimes(span, cuts)) {
      const [fr] = await this.media.frames(this.src, this.toFile(t), 1, { width: this.opt.probeWidth });
      if (!fr) continue;
      perFrame.push(await this.#ask(id, 'scene-picture', pictureQuestion({ png: fr.png, groups, hint }), { t }));
    }

    const level = {};
    for (const g of groups) {
      const pic = pictureLevel(perFrame.map((f) => f[g]));
      if (pic.outlier) this.log({ scene: id, step: 'scene-picture-outlier', group: g, max: pic.max, level: pic.level });
      level[g] = { situation: situation[g].level, picture: pic.level, confidence: r3(situation[g].confidence ?? 0) };
    }
    return { id, ...span, edges: edges.edges, ...(grown ? { grown } : {}), cues: members.map((m) => m.id), groups, level, probes: perFrame.length };
  }
}
