/**
 * contentfilter worker --app <url> [--data-dir <dir>] — the filter worker. Runs anywhere with Node
 * and refine's Python stack; talks to the app over HTTP and never writes the app's data folders:
 * claim the next queued run, stage its inputs in a scratch folder, run the pipeline steps there
 * (heartbeat every 20 s), and hand the results back. The app saves them, drafts the cards and
 * audits. `--data-dir` (read-only) lends the worker the app's auth and Plex config; without it,
 * set PLEX_HOST/PLEX_TOKEN and the Jev key in the environment.
 * ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { refinedEdlName } from '../../server/domain/content-filter/refine/refinedEdl.mjs';

export const WORKER_POLL_MS = 5000;
export const WORKER_HEARTBEAT_MS = 20000;
export const STEP_TIMEOUT_MS = { preflight: 60e3, export: 5 * 60e3, refine: 6 * 3600e3, scenes: 2 * 3600e3 };
const TAIL = 500;
const writeYaml = (p, v) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, yaml.dump(v, { lineWidth: 140 })); };
const readYaml = (p) => (existsSync(p) ? yaml.load(readFileSync(p, 'utf8')) : null);

/**
 * Lay a claimed run's inputs out the way the CLI reads them, in `root/<rk>-<runId>`.
 * @returns {{ dir, dataDir, mediaDir, overridePath, collect: ({ exported }) => object }}
 */
export function stageRun(claimed, { root, realDataDir = null }) {
  const { ratingKey: rk, run, inputs } = claimed;
  const dir = path.join(root, `${rk}-${run.id}`);
  rmSync(dir, { recursive: true, force: true });
  const dataDir = path.join(dir, 'data'); const mediaDir = path.join(dir, 'media');
  const cfData = path.join(dataDir, 'household', 'content-filter');
  const cfMedia = path.join(mediaDir, 'content-filter');
  mkdirSync(cfData, { recursive: true }); mkdirSync(cfMedia, { recursive: true });
  // Auth and config are read from the app's data dir, never written.
  // Every top-level folder is linked (the CLI's bootstrap loads the whole config: system, users,
  // household…), except the household content-filter folder, which is the staged copy.
  if (realDataDir) {
    for (const name of readdirSync(realDataDir)) {
      if (name !== 'household') symlinkSync(path.join(realDataDir, name), path.join(dataDir, name));
    }
    for (const name of existsSync(path.join(realDataDir, 'household')) ? readdirSync(path.join(realDataDir, 'household')) : []) {
      if (name !== 'content-filter') symlinkSync(path.join(realDataDir, 'household', name), path.join(dataDir, 'household', name));
    }
  }
  const overridePath = path.join(cfData, 'overrides', `${rk}.yml`);
  writeYaml(overridePath, inputs.override || { contentId: `plex:${rk}` });
  for (const [name, profile] of Object.entries(inputs.profiles || {})) if (profile) writeYaml(path.join(cfData, 'profiles', `${name}.yml`), profile);
  if (inputs.refineReview) writeYaml(path.join(cfData, 'review', `${rk}.refine.yml`), inputs.refineReview);
  if (inputs.edl) writeYaml(path.join(cfMedia, 'edl', `${rk}.edl.yml`), inputs.edl);
  if (inputs.edl && inputs.refined) writeYaml(path.join(cfMedia, 'refined', refinedEdlName(inputs.edl)), inputs.refined);
  for (const [part, words] of Object.entries(inputs.transcripts || {})) {
    mkdirSync(path.join(cfMedia, 'refine', rk), { recursive: true });
    writeFileSync(path.join(cfMedia, 'refine', rk, `words-${part}.json`), JSON.stringify(words));
  }
  const collect = ({ exported }) => {
    const edl = readYaml(path.join(cfMedia, 'edl', `${rk}.edl.yml`));
    const refined = edl ? readYaml(path.join(cfMedia, 'refined', refinedEdlName(edl))) : null;
    const transcripts = {};
    const wordsDir = path.join(cfMedia, 'refine', rk);
    for (const name of existsSync(wordsDir) ? readdirSync(wordsDir) : []) {
      const m = /^words-(\d+)\.json$/.exec(name);
      if (m) transcripts[m[1]] = JSON.parse(readFileSync(path.join(wordsDir, name), 'utf8'));
    }
    return {
      ...(exported && edl ? { edl } : {}),
      ...(refined ? { refined } : {}),
      override: readYaml(overridePath),
      ...(readYaml(path.join(cfData, 'review', `${rk}.refine.yml`)) ? { refineReview: readYaml(path.join(cfData, 'review', `${rk}.refine.yml`)) } : {}),
      transcripts,
    };
  };
  return { dir, dataDir, mediaDir, overridePath, collect };
}

/** The CLI arguments for one step of a claimed run. */
export function stepArgs(name, claimed) {
  const { ratingKey: rk, run } = claimed;
  if (name === 'preflight') return [rk];
  if (name === 'export') return claimed.exportArgs ? [...claimed.exportArgs.slice(0, -1), path.join('__STAGE_MEDIA__', 'content-filter', 'edl', `${rk}.edl.yml`)] : [rk];
  if (name === 'refine') return run.kind === 'send-back' ? [rk, '--cues', run.cues.join(','), '--write'] : [rk, '--write'];
  if (name === 'scenes') return [rk, '--write'];
  throw new Error(`Unknown worker step: ${name}`);
}

/** A send-back drops the cues' hand fixes in the staged override (only after preflight passed). */
function clearStagedNudges(overridePath, ids) {
  const ov = readYaml(overridePath) || {};
  for (const id of ids || []) {
    const c = ov.cueOverrides?.[id];
    if (c) { delete c.startMs; delete c.endMs; }
  }
  writeYaml(overridePath, ov);
}

/**
 * @param {{ api: { claim, progress, complete }, owner: string, runStep: (name, ctx) => Promise<{ code, stderrTail? }>,
 *   stageRoot: string, realDataDir?: string|null, pollMs?: number, sleep?: Function, schedule?: Function,
 *   log?: (event: string, data?: object) => void, ticks?: number }} p
 */
export async function runWorker({ api, owner, runStep, stageRoot, realDataDir = null, pollMs = WORKER_POLL_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), schedule = (fn, ms) => setTimeout(fn, ms), log = () => {}, ticks = Infinity }) {
  log('content-filter.worker.started', { owner });
  for (let i = 0; i < ticks; i++) {
    let claimed = null;
    try { claimed = await api.claim(owner); } catch (e) { log('content-filter.worker.error', { owner, error: e.message }); }
    if (!claimed) { await sleep(pollMs); continue; }
    const { ratingKey: rk, run } = claimed;
    log('content-filter.worker.claimed', { owner, ratingKey: rk, runId: run.id, kind: run.kind, steps: claimed.steps });
    let beating = true;
    const beat = () => { if (!beating) return; api.progress(rk, run.id, { owner }).catch(() => {}).finally(() => { if (beating) schedule(beat, WORKER_HEARTBEAT_MS); }); };
    schedule(beat, WORKER_HEARTBEAT_MS);
    let failure = null; let exported = false;
    try {
      const stage = stageRun(claimed, { root: stageRoot, realDataDir });
      for (const name of claimed.steps) {
        await api.progress(rk, run.id, { owner, step: { name, status: 'running' } });
        if (name === 'refine' && run.kind === 'send-back') clearStagedNudges(stage.overridePath, run.cues);
        const r = await runStep(name, { ...stage, claimed, args: stepArgs(name, claimed).map((a) => a.replace('__STAGE_MEDIA__', stage.mediaDir)) });
        if (r.code !== 0) { failure = { step: name, error: String(r.stderrTail || `exit ${r.code}`).slice(-TAIL) }; break; }
        if (name === 'export') exported = true;
        await api.progress(rk, run.id, { owner, step: { name, status: 'done' } });
      }
      beating = false;
      if (failure) await api.complete(rk, run.id, { owner, status: 'failed', ...failure });
      else await api.complete(rk, run.id, { owner, status: 'done', results: stage.collect({ exported }) });
      log(failure ? 'content-filter.worker.failed' : 'content-filter.worker.done', { owner, ratingKey: rk, runId: run.id, ...(failure || {}) });
      rmSync(stage.dir, { recursive: true, force: true });
    } catch (e) {
      beating = false;
      log('content-filter.worker.error', { owner, ratingKey: rk, runId: run.id, error: e.message });
      await api.complete(rk, run.id, { owner, status: 'failed', step: failure?.step || 'worker', error: e.message }).catch(() => {});
    }
  }
}

/** The app's worker API over HTTP. */
export function httpWorkerApi(appUrl, { fetchImpl = fetch } = {}) {
  const base = `${String(appUrl).replace(/\/$/, '')}/api/v1/content-filter`;
  const post = async (url, body) => {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  };
  return {
    claim: (owner) => post(`${base}/jobs/claim`, { owner }),
    progress: (rk, runId, body) => post(`${base}/${rk}/jobs/${encodeURIComponent(runId)}/progress`, body),
    complete: (rk, runId, body) => post(`${base}/${rk}/jobs/${encodeURIComponent(runId)}/complete`, body),
  };
}
