/**
 * contentfilter sync <ratingKey> - fit this copy's sync from a refined EDL's anchors.
 *
 * No decision model. Steps: find the tag set's refined EDL -> resolve the Plex
 * part, probe, transcript (cached) -> match anchors by word and line -> re-time
 * matched words the way refine timed the anchors (forced alignment + energy
 * snap) -> fit one speed with one offset per segment (a different cut gives
 * several segments) -> with --write, store it as the override's `sync`.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { prepareCopy } from './copySetup.mjs';
import { PythonWordAligner } from '../../server/adapters/content-filter/PythonWordAligner.mjs';
import { boundaryCandidates } from '../../server/domain/content-filter/refine/audioCandidates.mjs';
import { refinedEdlName } from '../../server/domain/content-filter/refine/refinedEdl.mjs';
import { matchAnchors, fitSegments } from '../../server/domain/content-filter/refine/anchorSync.mjs';

const SNAP_SEC = 0.07;

export const SYNC_USAGE = `Usage: contentfilter sync <ratingKey> [--part <id>] [--src <path|url>] [--transcript <file>] [--write]

Fits this copy's sync from the anchors in the tag set's refined EDL
(<mediaDir>/content-filter/refined/<workId>-<tagSetId>.edl.yml). Prints the fit;
--write stores it as the override's sync for this part.`;

export async function runSync({ rk, flags, args, dataFilterDir, mediaFilterDir, loadPlexConfig, getJson }) {
  const edlPath = path.join(mediaFilterDir, 'edl', `${rk}.edl.yml`);
  if (!existsSync(edlPath)) throw new Error(`No EDL for ${rk} (${edlPath})`);
  const edl = yaml.load(readFileSync(edlPath, 'utf8'));
  const refinedPath = path.join(mediaFilterDir, 'refined', refinedEdlName(edl));
  if (!existsSync(refinedPath)) throw new Error(`No refined EDL for this tag set (${refinedPath}); run refine on a copy first`);
  const refined = yaml.load(readFileSync(refinedPath, 'utf8'));
  const anchors = refined?.timebase?.anchors || [];
  if (anchors.length < 3) throw new Error(`Refined EDL has ${anchors.length} anchors; need at least 3`);

  const { partId, src, media, probe, transcript } = await prepareCopy({ rk, flags, mediaFilterDir, loadPlexConfig, getJson, verb: 'Syncing' });

  // 1. Match
  const m = matchAnchors(anchors, transcript.words, transcript.segments);
  console.error(`Anchors: ${m.matched}/${m.total} found (coarse offset ${m.coarse ?? 'none'} s)`);
  if (m.matched < Math.max(3, Math.ceil(m.total / 3))) {
    throw new Error(`Only ${m.matched} of ${m.total} anchors found: this copy does not look like the same work. Check the Plex mapping.`);
  }

  // 2. Re-time matched words the way the anchors were timed
  const W = transcript.words;
  const items = m.pairs.map((p, k) => {
    const ctx = W.map((_, i) => i).filter((i) => W[i].seg === W[p.wi].seg);
    return { id: `a${k}`, t0: Math.max(0, W[ctx[0]].s - 0.6), t1: W[ctx[ctx.length - 1]].e + 0.6, words: ctx.map((i) => W[i].w), target: ctx.indexOf(p.wi) };
  });
  const aligned = await new PythonWordAligner({ src }).align(items);
  const pairs = [];
  for (const [k, p] of m.pairs.entries()) {
    const a = aligned[k];
    let t = a && !a.error && Math.abs(a.start - p.y) < 1 ? a.start : p.y;
    const clip = await media.audio(src, t - 0.45, t + 0.45);
    const cands = boundaryCandidates(clip, { kind: 'onset', near: t, within: SNAP_SEC, max: 6 });
    if (cands.length) t = cands.reduce((x, y) => (y.strength > x.strength ? y : x)).t;
    pairs.push({ x: p.x, y: t });
  }

  // 3. Fit
  const fit = fitSegments(pairs, { runtimeSec: refined.timebase.runtimeSec || probe.duration });
  if (!fit) throw new Error('Could not fit a sync from the matched anchors');
  const frames = { fps: String(probe.fps), startTime: probe.startTime || 0 };
  const sync = fit.segments.length === 1
    ? { scale: fit.segments[0].scale, offsetSec: fit.segments[0].offsetSec }
    : { segments: fit.segments };
  Object.assign(sync, { part: partId, method: 'anchors', frames, samples: fit.used, of: fit.total, medAbsResidSec: fit.medAbsResidSec });
  for (const s of fit.segments) {
    console.error(`  VidAngel ${s.fromVa}–${s.toVa} s: local = va x ${s.scale} + ${s.offsetSec} s`);
  }
  console.error(`Sync from ${fit.used}/${fit.total} anchors, median residual ${Math.round(fit.medAbsResidSec * 1000)} ms`);

  if (!args.includes('--write')) {
    console.error('(dry run: pass --write to store it as the override sync)');
    return { sync };
  }
  const overridePath = path.join(dataFilterDir, 'overrides', `${rk}.yml`);
  const override = existsSync(overridePath) ? yaml.load(readFileSync(overridePath, 'utf8')) || {} : {};
  override.contentId = override.contentId || `plex:${rk}`;
  override.sync = sync;
  mkdirSync(path.dirname(overridePath), { recursive: true });
  writeFileSync(overridePath, yaml.dump(override, { lineWidth: 140 }));
  console.error(`✓ sync -> ${overridePath}`);
  return { sync };
}
