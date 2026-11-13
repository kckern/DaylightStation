/**
 * `contentfilter refine <ratingKey>`: coarse EDL -> frame/ms-precise observations,
 * with the decision model (Jev) as the only judge.
 *
 * Steps: resolve the Plex part -> probe -> transcript (cached) -> clock sync
 * -> refine each cue -> merge into the override (--write) -> review list.
 *
 * Files (paths from the caller):
 *   <mediaDir>/content-filter/refine/<rk>/words-<part>.json   transcript cache
 *   <mediaDir>/content-filter/refine/<rk>/log.jsonl           one line per model call
 *   <mediaDir>/content-filter/refine/<rk>/art/                images the model saw
 *   <mediaDir>/content-filter/refined/<workId>-<tagSetId>.edl.yml shareable refined EDL (VidAngel clock)
 *   <mediaDir>/content-filter/refine/<rk>/results-<part>.json raw results (.partial.json for a filtered run)
 *   <dataDir>/household/content-filter/overrides/<rk>.yml     merged (--write)
 *   <dataDir>/household/content-filter/review/<rk>.refine.yml unknowns, give-ups, kept-manual
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { prepareCopy } from './copySetup.mjs';
import { ensureVideoProxy } from './videoProxy.mjs';
import { FrameChunkCache, ProxiedRefineMedia } from '../../server/adapters/content-filter/CachedRefineMedia.mjs';
import { MagickRefineRenderer } from '../../server/adapters/content-filter/MagickRefineRenderer.mjs';
import { TimeoutDecisionGateway } from '../../server/adapters/content-filter/TimeoutDecisionGateway.mjs';
import { PythonWordAligner } from '../../server/adapters/content-filter/PythonWordAligner.mjs';
import { makeTimebase } from '../../server/domain/content-filter/refine/timebase.mjs';
import { wordMatcher } from '../../server/domain/content-filter/refine/cueKinds.mjs';
import { fitSync, wordPairs } from '../../server/domain/content-filter/refine/syncFit.mjs';
import { mergeRefine } from '../../server/domain/content-filter/refine/refineOutput.mjs';
import { buildRefinedEdl, anchorsFrom, refinedEdlName } from '../../server/domain/content-filter/refine/refinedEdl.mjs';
import { groupSubjects, jevSameSubject } from '../../server/application/content-filter/refine/subjectGroups.mjs';
import { CueRefiner } from '../../server/application/content-filter/refine/CueRefiner.mjs';
import { QUESTION_VERSION } from '../../server/application/content-filter/refine/refineQuestions.mjs';

/** This many tagged words with none found in the transcript means the EDL is for other media. */
const MISMATCH_MIN_TAGS = 6;

export const REFINE_USAGE = `Usage: contentfilter refine <ratingKey> [options]
  --part <id>          Plex media part to refine (default: the first part)
  --src <path|url>     Read media from here instead of the Plex part URL (same file, e.g. a local copy)
  --cues a,b,c         Only these cue ids
  --limit <n>          Only the first n cues
  --kinds speech,visual  Only cues of these kinds (speech, speech-line, visual, credits)
  --concurrency <n>    Cues in flight (default 6)
  --no-proxy           Read frames from the original, not the low-res copy (CONTENT_FILTER_PROXY=0 too)
  --no-region          Skip region tracks
  --snap <sec>         Speech edge snap window (default 0.07; wider measured worse)
  --transcript <file>  Use this word transcript (JSON from transcribe.py) instead of making one
                       (hosts without uv: set CONTENT_FILTER_TRANSCRIBE_PY=python3 so transcription runs python3 transcribe.py,
                       and CONTENT_FILTER_ALIGN_PY=<python with torch+torchaudio> for the word alignment of speech cues)
  --kinds visual       Needs no transcript. A shown cue whose edges stay unsure is still region-tracked over where it was seen (coarse edges kept)
  --no-subjects        Skip same-subject grouping of overlapping shown tags (R6)
  --resubject          Ask every overlapping shown pair again (default: keep the subjects already in the refined EDL)
  --write              Merge results into the override and write the review list (default: dry run)`;

/**
 * @param {object} ctx
 * @param {string} ctx.rk
 * @param {object} ctx.flags - parsed --flags
 * @param {string[]} ctx.args - raw argv (for boolean flags)
 * @param {string} ctx.dataFilterDir - <dataDir>/household/content-filter
 * @param {string} ctx.mediaFilterDir - <mediaDir>/content-filter
 * @param {() => { token: string, host: string }} ctx.loadPlexConfig
 * @param {(opts: object) => Promise<object|null>} ctx.getDecisionGateway
 * @param {(url: string) => Promise<object>} ctx.getJson
 */
export async function runRefine({ rk, flags, args, dataFilterDir, mediaFilterDir, loadPlexConfig, getDecisionGateway, getJson }) {
  const edlPath = path.join(mediaFilterDir, 'edl', `${rk}.edl.yml`);
  if (!existsSync(edlPath)) throw new Error(`No EDL for ${rk} (${edlPath})`);
  const edl = yaml.load(readFileSync(edlPath, 'utf8'));
  const overridePath = path.join(dataFilterDir, 'overrides', `${rk}.yml`);
  const override = existsSync(overridePath) ? yaml.load(readFileSync(overridePath, 'utf8')) || {} : {};

  // A visual-only run (--kinds visual) region-tracks `shown` cues; it needs no transcript,
  // so it neither transcribes nor re-fits the clock (the override's sync, if any, is used).
  const visualOnly = Boolean(flags.kinds) && String(flags.kinds).split(',').every((k) => k === 'visual');

  // 1-2. Media part, source, probe and transcript (cached per part)
  // The low-res picture copy (videoProxy.mjs) starts building as soon as the source is known, so it
  // runs alongside the transcription; frames then come from it through a chunk cache.
  let proxyBuild = null;
  const onSource = process.env.CONTENT_FILTER_PROXY === '0' || args.includes('--no-proxy') ? null : ({ src: from, partId: pid, size }) => {
    const t = Date.now();
    const dir = process.env.CONTENT_FILTER_PROXY_DIR || path.join(os.tmpdir(), 'daylight-cf-proxy');
    proxyBuild = ensureVideoProxy({ src: from, dir, partId: pid, size }).then((p) => {
      console.error(JSON.stringify({ at: new Date().toISOString(), event: 'content-filter.proxy.ready', rk, path: p, ms: Date.now() - t }));
      return p;
    }, (e) => {
      console.error(JSON.stringify({ at: new Date().toISOString(), event: 'content-filter.proxy.failed', rk, error: String(e.message).slice(-300) }));
      return null;
    });
  };
  const { meta, partId, src, workDir, media: original, probe, transcript } = await prepareCopy({ rk, flags, mediaFilterDir, loadPlexConfig, getJson, verb: 'Refining', skipTranscript: visualOnly, onSource });
  const proxy = proxyBuild ? await proxyBuild : null;
  const media = new FrameChunkCache({ inner: proxy ? new ProxiedRefineMedia({ inner: original, videoSrc: proxy }) : original });
  const timebase = makeTimebase({ fps: probe.fps, startTime: probe.startTime });

  // 3. Clock sync from tagged words vs transcript
  const tags = (edl.cues || []).filter((c) => c.type === 'mute').map((c) => ({ t: c.in, id: c.id, match: wordMatcher(c) })).filter((t) => t.match);
  const { coarse, pairs } = transcript ? wordPairs(tags, transcript.words) : { coarse: null, pairs: [] };
  const fit = transcript ? fitSync(pairs) : null;
  const manual = override.sync && (!override.sync.part || String(override.sync.part) === String(partId)) ? override.sync : null;
  if (transcript && !fit && !manual && tags.length >= MISMATCH_MIN_TAGS) {
    // Enough tagged words that a matching file would pair them; none paired, so the
    // EDL most likely describes different media (same title, other cut or other work).
    throw new Error(`EDL does not match this media: ${pairs.length} of ${tags.length} tagged words found in the transcript `
      + `(coarse offset ${coarse ?? 'none'} s). Check the Plex mapping, or set sync.offsetSec in the override to proceed.`);
  }
  const sync = fit ? { scale: fit.scale, offset: fit.offset }
    : { scale: manual?.scale || 1, offset: manual?.offsetSec || 0 };
  if (!transcript && !manual) {
    throw new Error('A visual-only refine needs a clock sync and there is no transcript: run `contentfilter sync` or set sync in the override first.');
  }
  console.error(!transcript ? `Sync (visual-only, no transcript): local = va x ${sync.scale} + ${sync.offset} s from the override`
    : fit
    ? `Sync: local = va x ${fit.scale} + ${fit.offset} s (${fit.used}/${fit.total} word pairs, median residual ${fit.medResid} s)`
    : `⚠ No transcript sync (${pairs.length} of ${tags.length} tagged words paired); using ${manual ? 'the override' : 'no'} offset: ${sync.offset} s`);

  // 4. Decision model
  const gateway = await getDecisionGateway({ logger: { debug() {}, info() {}, warn: console.warn, error: console.error } });
  if (!gateway) throw new Error('No decision model configured (system auth jev.api_key). refine asks no other model.');
  const decisions = new TimeoutDecisionGateway(gateway); // a lost request abstains instead of hanging the run

  // 5. Cues
  let cues = edl.cues || [];
  if (flags.cues) { const want = new Set(String(flags.cues).split(',')); cues = cues.filter((c) => want.has(c.id)); }
  const refiner = new CueRefiner({
    media, renderer: new MagickRefineRenderer(), decisions,
    aligner: new PythonWordAligner({ src }), transcript, timebase, src, sync,
    duration: probe.duration, aspect: probe.width / probe.height,
    log: (e) => appendFileSync(path.join(workDir, 'log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), part: partId, ...e })}\n`),
    saveArtifact: (name, png) => { const p = path.join(workDir, 'art', name); writeFileSync(p, png); return path.relative(workDir, p); },
    options: { region: !args.includes('--no-region'), ...(flags.snap ? { edgeSnapSec: Number(flags.snap) } : {}) },
  });
  if (flags.kinds) {
    const { cueMatchesKinds } = await import('../../server/domain/content-filter/refine/cueKinds.mjs');
    const want = new Set(String(flags.kinds).split(','));
    cues = cues.filter((c) => cueMatchesKinds(c, want));
  }
  if (args.includes('--limit')) cues = cues.slice(0, Number(flags.limit)); // the CLI's global limit has a default; only an explicit one applies

  refiner.planWords(edl.cues || []);
  const results = [];
  let next = 0;
  const conc = Math.max(1, Number(flags.concurrency) || 6);
  const t0 = Date.now();
  async function worker() {
    while (next < cues.length) {
      const cue = cues[next++];
      const r = await refiner.refine(cue);
      results.push(r);
      const what = r.status === 'refined' ? `${r.in}–${r.out}` : r.reason;
      console.error(`  [${results.length}/${cues.length}] ${cue.id} ${r.kind} ${r.status} ${what}`);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  // A filtered run (--cues/--kinds/--limit) must not replace the full run's results.
  const partial = Boolean(flags.cues || flags.kinds || args.includes('--limit'));
  const resultsName = partial ? `results-${partId}.partial.json` : `results-${partId}.json`;
  writeFileSync(path.join(workDir, resultsName), JSON.stringify({ sync, version: QUESTION_VERSION, partial, results }, null, 1));

  // 6. Merge and review list
  const at = new Date().toISOString().slice(0, 10);
  const { override: merged, review, counts } = mergeRefine(override, results, { part: partId, at, version: QUESTION_VERSION });
  console.error(`\n${results.length} cues in ${Math.round((Date.now() - t0) / 1000)} s: ${counts.written} refined, ${counts.unknown} unknown, ${counts.giveup} not found, ${counts.keptManual} kept (manual), ${counts.region} region-only (coarse edges)`);
  if (!args.includes('--write')) {
    console.error('(dry run: pass --write to merge into the override and write the review list)');
    return { results, counts };
  }
  merged.contentId = merged.contentId || `plex:${rk}`;
  const frames = { fps: String(probe.fps), startTime: probe.startTime || 0 };
  if (!merged.sync && fit) merged.sync = { offsetSec: fit.offset, scale: fit.scale, method: 'transcript', samples: fit.used, medAbsResidSec: fit.medResid, part: partId };
  if (merged.sync && String(merged.sync.part ?? partId) === String(partId) && !merged.sync.frames) merged.sync.frames = frames;
  mkdirSync(path.dirname(overridePath), { recursive: true });
  writeFileSync(overridePath, yaml.dump(merged, { lineWidth: 140 }));

  // Shareable refined EDL: every cue on VidAngel's clock, plus anchors for other copies.
  // The player still reads this household's refined times from the override until it
  // learns to read refined EDLs, so the override keeps them for now.
  const vaSync = { scale: sync.scale, offsetSec: sync.offset };
  const refinedById = Object.fromEntries(results.filter((r) => r.status === 'refined' && r.kind === 'speech').map((r) => [r.id, r]));
  const anchors = anchorsFrom({ pairs, words: transcript?.words || [], segments: transcript?.segments || [], sync: vaSync, refinedById });
  const refinedPath = path.join(mediaFilterDir, 'refined', refinedEdlName(edl));
  const previous = existsSync(refinedPath) ? yaml.load(readFileSync(refinedPath, 'utf8')) : null;
  // R6: shown tags overlapping in time that Jev says are one thing on screen share a subject.
  let subjects = {};
  let subjectsUnsure = [];
  if (!args.includes('--no-subjects')) {
    const kindOf = Object.fromEntries(results.map((r) => [r.id, r.kind]));
    const prevCues = new Map((previous?.cues || []).map((c) => [c.id, c]));
    const local = (t) => t * sync.scale + sync.offset;
    const spanned = cues.map((c) => {
      const o = merged.cueOverrides?.[c.id];
      const measured = o?.refine && o.in != null;
      return { ...c, kind: kindOf[c.id] ?? c.refine?.kind ?? prevCues.get(c.id)?.refine?.kind,
        in: measured ? o.in : local(c.in), out: measured ? o.out : local(c.out) };
    });
    const existing = Object.fromEntries((previous?.cues || []).filter((c) => c.subject).map((c) => [c.id, c.subject]));
    const log = (e) => appendFileSync(path.join(workDir, 'log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), part: partId, ...e })}\n`);
    const ask = jevSameSubject({ decisions, media, src, timebase, aspect: probe.width / probe.height, log });
    const g = await groupSubjects({ cues: spanned, existing, reask: args.includes('--resubject'), ask, log });
    subjects = g.subjects;
    subjectsUnsure = g.unsure;
    console.error(`Subjects: ${g.asked} pairs asked, ${g.yes} same; ${g.groups.length} group(s)${g.groups.length ? ` (${g.groups.map((x) => x.join('+')).join(', ')})` : ''}`);
  }
  const refined = buildRefinedEdl({
    edl, cueOverrides: merged.cueOverrides, sync: vaSync, anchors, at, previous, partial, subjects,
    refinedFrom: { runtimeSec: Math.round(probe.duration * 1000) / 1000, ...frames },
  });
  mkdirSync(path.dirname(refinedPath), { recursive: true });
  writeFileSync(refinedPath, yaml.dump(refined, { lineWidth: 140 }));
  const cert = refined.certification;
  console.error(`✓ refined EDL (${refined.timebase.refinedCount} refined, ${anchors.length} anchors; certification ${cert.level}`
    + `${cert.blocking ? `, ${cert.blocking.length} mutes still approximate` : ''}) -> ${refinedPath}`);
  const reviewPath = path.join(dataFilterDir, 'review', `${rk}.refine.yml`);
  mkdirSync(path.dirname(reviewPath), { recursive: true });
  writeFileSync(reviewPath, yaml.dump({ contentId: `plex:${rk}`, part: partId, generatedAt: new Date().toISOString(), counts, items: review, subjectsUnsure }, { lineWidth: 140 }));
  console.error(`✓ override -> ${overridePath}\n✓ review (${review.length}) -> ${reviewPath}`);
  return { results, counts };
}
