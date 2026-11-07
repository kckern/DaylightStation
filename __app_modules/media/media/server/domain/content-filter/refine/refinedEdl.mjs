/**
 * The shareable refined EDL: every cue of a VidAngel tag set on VidAngel's
 * clock, refined ones at ms/frame precision, with anchors any copy can use to
 * fit its own sync. No Plex ids, frame numbers or part ids: those belong to one
 * household's copy and stay in its override.
 */
import { mapTime, unmapTime } from '../../../../../../../shared/contracts/content-filter/syncMap.mjs';
import { certify } from './certification.mjs';
import { applySafeWindows } from './safeWindow.mjs';

const ms = (t) => Math.round(t * 1000) / 1000;
const COPY_KEYS = ['frameIn', 'frameOut'];

/** File name for a tag set's refined EDL. */
export function refinedEdlName(edl) {
  const { workId, tagSetId } = edl?.sourceRef || {};
  if (workId == null || tagSetId == null) throw new Error('refined EDL needs sourceRef.workId and sourceRef.tagSetId');
  return `${workId}-${tagSetId}.edl.yml`;
}

/**
 * @param {object} p
 * @param {object} p.edl - the coarse VidAngel EDL
 * @param {Record<string, object>} p.cueOverrides - override entries; those with a `refine` stamp are used
 * @param {object} p.sync - the copy's sync (VidAngel -> file time)
 * @param {Array<object>} [p.anchors]
 * @param {object} [p.refinedFrom] - the reference copy: { runtimeSec, fps, startTime }
 * @param {string} p.at - date stamp for the certification (callers own the clock)
 * @param {object} [p.previous] - the refined EDL being replaced. R7: its scenes, sceneCalibration,
 *   parent sign-off and any key refine does not produce survive; a cue it holds refined that this
 *   run did not (re)measure keeps its refined data.
 * @param {boolean} [p.partial] - a filtered run: anchors add to previous's instead of replacing them
 * @param {Record<string, string|null>} [p.subjects] - R6: cue id -> subject id (null removes one); cues not named keep
 *   the subject previous gave them
 */
export function buildRefinedEdl({ edl, cueOverrides = {}, sync, anchors = [], refinedFrom = {}, at = null, previous = null, partial = false, subjects = {} }) {
  const prevCue = new Map((previous?.cues || []).map((c) => [c.id, c]));
  const toVa = (t) => {
    const v = unmapTime(t, sync);
    if (v == null) throw new Error(`time ${t} is outside the copy's sync`);
    return ms(v);
  };
  const measured = (edl.cues || []).map((cue) => {
    const o = cueOverrides[cue.id];
    // Coarse edges, measured region track (refine could not settle the edges): the cue keeps its
    // VidAngel times and gains the track; it never replaces a cue refined at ms/frame.
    if (o?.refine && o.in == null && o.regions?.length) {
      const was = prevCue.get(cue.id);
      if (was?.refine && was.refine.edges !== 'coarse') return was;
      const { part, ...stamp } = o.refine;
      return { ...cue, precision: cue.precision || edl.precision || 'second-approx', regions: o.regions.map((k) => ({ ...k, in: toVa(k.in) })), refine: stamp };
    }
    if ((!o?.refine || o.in == null) && prevCue.get(cue.id)?.refine) return prevCue.get(cue.id);
    if (!o?.refine || o.in == null) return { ...cue, precision: cue.precision || edl.precision || 'second-approx' };
    const out = { ...cue, in: toVa(o.in), out: toVa(o.out), precision: o.precision };
    for (const k of COPY_KEYS) delete out[k];
    if (o.segments?.length) out.segments = o.segments.map((s) => ({ in: toVa(s.in), out: toVa(s.out) }));
    if (o.regions?.length) out.regions = o.regions.map((k) => ({ ...k, in: toVa(k.in) }));
    const { part, ...stamp } = o.refine;
    out.refine = stamp;
    delete out.approx;
    return out;
  });
  const refinedCount = measured.filter((c) => c.refine && c.refine.edges !== 'coarse').length;
  // Mutes refine could not pin get a window wide enough for the tag's drift.
  const cues = applySafeWindows(measured).map((c) => {
    const subject = c.id in subjects ? subjects[c.id] : (prevCue.get(c.id)?.subject ?? c.subject);
    const { subject: _old, ...rest } = c;
    return subject ? { ...rest, subject } : rest;
  });
  const { contentId, cues: _c, precision: _p, certification: _x, ...head } = edl;
  // Certification is recomputed on every build; a person's sign-off carries over
  // from the previous file while the bar still holds.
  if (!at) throw new Error('buildRefinedEdl needs `at` (the date to stamp the certification with)');
  const certification = certify({ cues, certification: previous?.certification }, { at });
  // Keys refine does not produce (scenes, sceneCalibration, anything later) ride along from previous.
  const { contentId: _i, cues: _pc, certification: _pk, timebase: _pt, precision: _pp, ...carried } = previous || {};
  // Fresh head fields win; only keys the head lacks (scenes, calibration, later additions) carry over.
  const fromPrevious = Object.fromEntries(Object.entries(carried).filter(([k]) => !(k in head) || k === 'scenes' || k === 'sceneCalibration'));
  const prevAnchors = partial ? previous?.timebase?.anchors || [] : [];
  const seen = new Set(anchors.map((a) => `${a.t}|${a.text}`));
  const allAnchors = [...prevAnchors.filter((a) => !seen.has(`${a.t}|${a.text}`)), ...anchors].sort((a, b) => a.t - b.t);
  const built = {
    ...head,
    ...fromPrevious,
    certification,
    timebase: {
      ...(previous?.timebase || {}),
      clock: 'vidangel',
      runtimeSec: edl.runtimeUnalteredSec ?? null,
      refinedCount,
      anchors: allAnchors,
      refinedFrom: { ...refinedFrom, sync: plainSync(sync) },
    },
    cues,
  };
  // Same key order as the file being replaced (yaml.dump keeps insertion order), new keys last.
  const order = Object.keys(previous || {});
  const rank = (k) => { const n = order.indexOf(k); return n < 0 ? order.length : n; };
  return Object.fromEntries(Object.entries(built).sort(([a], [b]) => rank(a) - rank(b)));
}

/**
 * Anchors from the transcript word pairs the sync was fitted on: inliers only,
 * each with its transcript line so another copy can find the same occurrence.
 * @param {object} p
 * @param {Array<{ x: number, y: number, wi: number, id: string }>} p.pairs - tag time (VidAngel) -> word start (file)
 * @param {Array<{ w: string, s: number, seg: number }>} p.words
 * @param {Array<{ id: number, text: string }>} p.segments
 * @param {object} p.sync
 * @param {Record<string, { in: number }>} [p.refinedById] - refined speech results; only these become anchors
 * @param {number} [p.tol] - max |file time - synced tag time| for an inlier (s)
 */
export function anchorsFrom({ pairs, words, segments, sync, refinedById = {}, tol = 3 }) {
  const lineOf = new Map((segments || []).map((s) => [s.id, s.text]));
  const anchors = [];
  for (const p of pairs || []) {
    const expected = mapTime(p.x, sync);
    if (expected == null || Math.abs(p.y - expected) > tol) continue;
    const w = words[p.wi];
    if (!w) continue;
    // Only words refine timed precisely: another copy's sync re-times its matches
    // the same way, so a raw Whisper start (~80 ms early) here would bias the fit.
    const local = refinedById[p.id]?.in;
    if (local == null) continue;
    const t = unmapTime(local, sync);
    if (t == null) continue;
    anchors.push({ t: ms(t), kind: 'word', text: w.w.replace(/[^\p{L}\p{N}']/gu, '').toLowerCase(), line: lineOf.get(w.seg) || '' });
  }
  return anchors.sort((a, b) => a.t - b.t);
}

/**
 * An override without the refined timing that now lives in the refined EDL:
 * refine-stamped measurements are removed, keys a person set (disabled, effect,
 * nudgeMs, …) stay, and entries left empty are dropped.
 * @returns {{ cueOverrides: Record<string, object>, removed: number }}
 */
export function stripRefined(cueOverrides = {}) {
  const MEASURED = ['in', 'out', 'precision', 'frameIn', 'frameOut', 'segments', 'regions', 'refine'];
  const out = {}; let removed = 0;
  for (const [id, o] of Object.entries(cueOverrides)) {
    if (!o?.refine) { out[id] = o; continue; }
    removed++;
    const kept = Object.fromEntries(Object.entries(o).filter(([k]) => !MEASURED.includes(k)));
    if (Object.keys(kept).length) out[id] = kept;
  }
  return { cueOverrides: out, removed };
}

function plainSync(sync) {
  if (!sync) return null;
  if (sync.segments) return { segments: sync.segments };
  return { scale: sync.scale ?? 1, offsetSec: sync.offsetSec ?? sync.offset ?? 0 };
}
