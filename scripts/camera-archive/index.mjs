#!/usr/bin/env node
/**
 * Camera Cold Archive — CLI entry point.
 *
 *   ledger            Pipeline C: detection metadata only. No downloads.
 *   archive           Pipeline A: scored session selection + day/night timelapse.
 *   backfill-untagged Pipeline B: hard timelapse + comprehensive 24/7 audio.
 *
 * Every mode supports --dry-run, which plans and reports projected sizes
 * without fetching anything. Given a real Pipeline B run is a ~7-hour, ~500 GB
 * operation, inspecting the plan first is a requirement, not a convenience.
 *
 * Design: docs/superpowers/specs/2026-07-18-camera-cold-archive-design.md
 */

import { readFile } from 'fs/promises';
import { mkdir, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

import { ReolinkClient, makeSource } from './reolink.lib.mjs';
import { toClip, sessionize, labelSessions, selectSessions } from './select.lib.mjs';
import { sunTimes, phaseAt } from './sun.lib.mjs';
import { buildLedgerRecords, writeLedger, readLedger } from './ledger.lib.mjs';
import { encodeSession, encodeTimelapse, extractAudio } from './encode.lib.mjs';
import { readManifest, writeManifest, buildManifest, isComplete, markInProgress } from './manifest.lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

// ---------------------------------------------------------------------------
// Args & config
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [first, ...rest] = argv;
  // A leading flag means no mode was given — treat it as a help request rather
  // than trying to load config for a mode called "--help".
  const mode = first && !first.startsWith('-') ? first : null;
  const opts = {
    mode,
    help: !mode,
    dryRun: false,
    camera: null,
    day: null,
    range: null,
    config: null,
  };
  if (!mode && first) rest.unshift(first);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--camera') opts.camera = rest[++i];
    else if (arg === '--day') opts.day = rest[++i];
    else if (arg === '--range') opts.range = rest[++i];
    else if (arg === '--config') opts.config = rest[++i];
    else if (arg === '--help' || arg === '-h') opts.help = true;
  }
  return opts;
}

async function loadConfig(configPath) {
  const file = configPath ?? path.join(HERE, 'config.yml');
  return yaml.load(await readFile(file, 'utf8'));
}

/**
 * Resolve a data-volume-relative path.
 *
 * `data/` is a bind mount, not part of the repo — on this host the real tree
 * lives at DAYLIGHT_BASE_PATH. Resolving against the repo root silently finds
 * nothing, so the base path is honoured first and the repo is only a fallback.
 */
function resolveDataPath(relative) {
  // Pick up DAYLIGHT_BASE_PATH from the project .env if the caller did not
  // export it, so the script works when invoked directly.
  if (!process.env.DAYLIGHT_BASE_PATH && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(path.join(REPO_ROOT, '.env'));
    } catch {
      /* no .env — fall through to the repo-relative default */
    }
  }
  const base = process.env.DAYLIGHT_BASE_PATH;
  return base ? path.resolve(base, relative) : path.resolve(REPO_ROOT, relative);
}

async function loadAuth(config) {
  const file = resolveDataPath(config.auth.file);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `Reolink credentials not found at ${file}. ` +
          'Set DAYLIGHT_BASE_PATH (see .env) or adjust auth.file in config.yml.',
      );
    }
    if (err.code === 'EACCES') {
      throw new Error(`Cannot read ${file} — run as a user with access to the data volume.`);
    }
    throw err;
  }
  const auth = yaml.load(raw);
  if (!auth?.username || !auth?.password) {
    throw new Error(`Reolink credentials missing username/password in ${file}`);
  }
  return auth;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

function expandRange(range) {
  const [from, to] = range.split('..');
  const days = [];
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function resolveDays(opts) {
  if (opts.range) return expandRange(opts.range);
  const day = opts.day === 'today' || !opts.day ? today() : opts.day;
  return [day];
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function buildSources(config, auth, cameraCfg, logger) {
  const streamType = config.sources.streamType;
  const cameraClient = new ReolinkClient({ host: cameraCfg.host, ...auth, logger });
  const nvrClient = new ReolinkClient({ host: config.nvr.host, ...auth, logger });
  return {
    camera: makeSource({ kind: 'camera', client: cameraClient, channel: 0, streamType }),
    nvr: makeSource({ kind: 'nvr', client: nvrClient, channel: cameraCfg.nvrChannel, streamType }),
  };
}

function resolveLedgerDests(config) {
  return config.storage.ledgerPaths.map((p) => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p)));
}

function resolveArchiveRoots(config) {
  const hot = path.isAbsolute(config.storage.hotPath)
    ? config.storage.hotPath
    : path.join(REPO_ROOT, config.storage.hotPath);
  return { hot, nas: config.storage.nasPath };
}

// ---------------------------------------------------------------------------
// Pipeline C — detection ledger
// ---------------------------------------------------------------------------

async function runLedger({ config, auth, days, opts, logger }) {
  const dests = resolveLedgerDests(config);
  const results = [];

  for (const cameraCfg of selectCameras(config, opts)) {
    const sources = buildSources(config, auth, cameraCfg, logger);
    const bitMap = config.classification.filenameBits?.[cameraCfg.id] ?? {};

    for (const day of days) {
      const records = await buildLedgerRecords({
        camera: cameraCfg.id,
        day,
        cameraSource: sources.camera,
        nvrSource: sources.nvr,
        haHistory: [], // HA join is wired in when the adapter is available offline
        bitMap,
      });

      const bySource = records.reduce((acc, r) => {
        acc[r.source] = (acc[r.source] ?? 0) + 1;
        return acc;
      }, {});

      if (opts.dryRun) {
        logger.info(`[dry-run] ${cameraCfg.id} ${day}: ${records.length} records`, bySource);
      } else {
        const written = await writeLedger({ records, camera: cameraCfg.id, day, destinations: dests });
        logger.info(`${cameraCfg.id} ${day}: ${records.length} records -> ${written.length} destinations`);
      }
      results.push({ camera: cameraCfg.id, day, count: records.length, bySource });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Pipeline A — tagged archive
// ---------------------------------------------------------------------------

async function runArchive({ config, auth, days, opts, logger }) {
  const { hot } = resolveArchiveRoots(config);
  const ledgerDests = resolveLedgerDests(config);
  const results = [];

  for (const cameraCfg of selectCameras(config, opts)) {
    const sources = buildSources(config, auth, cameraCfg, logger);
    const metaSource = sources[config.sources.metadataFrom];
    const footageSource = sources[config.sources.footageFrom];

    for (const day of days) {
      const existing = await readManifest(hot, cameraCfg.id, day);
      if (isComplete(existing) && !opts.dryRun) {
        logger.info(`${cameraCfg.id} ${day}: already complete, skipping`);
        continue;
      }

      const clips = (await metaSource.search(day)).map((r) => toClip(r, { date: day }));
      if (!clips.length) {
        logger.warn(`${cameraCfg.id} ${day}: no recordings found`);
        continue;
      }

      const ledgerRecords = await readLedger(ledgerDests[0], cameraCfg.id, day);
      const sessions = labelSessions(
        sessionize(clips, config.sessionize),
        ledgerRecords,
        { toleranceSeconds: config.classification.matchToleranceSeconds },
      );

      const plan = selectSessions(sessions, {
        ...config.scoring,
        budgetMB: config.budget.fullClipsMB,
        compressionRatio: config.budget.compressionRatio,
      });

      const sun = sunTimes(day, config.sun.latitude, config.sun.longitude);

      if (opts.dryRun) {
        reportPlan({ camera: cameraCfg.id, day, plan, sun, logger });
        results.push({ camera: cameraCfg.id, day, plan });
        continue;
      }

      await markInProgress(hot, cameraCfg.id, day, 'A');
      const outputs = await materialize({
        config, cameraCfg, day, plan, sun, footageSource, root: hot, logger,
      });

      const manifest = buildManifest({
        camera: cameraCfg.id,
        day,
        pipeline: 'A',
        sessions: [...plan.selected, ...plan.rejected],
        outputs,
        sun,
        config,
        stats: { projectedMB: Math.round(plan.projectedMB), clipCount: clips.length },
      });
      await writeManifest(hot, cameraCfg.id, day, manifest);
      results.push({ camera: cameraCfg.id, day, outputs });
    }
  }
  return results;
}

/**
 * Download, encode, and write a day's outputs.
 *
 * Source segments are deleted as soon as they are consumed, so peak local disk
 * stays near one segment rather than the full day.
 */
async function materialize({ config, cameraCfg, day, plan, sun, footageSource, root, logger }) {
  const workDir = path.join(config.storage.workDir, cameraCfg.id, day);
  const outDir = path.join(root, cameraCfg.id, day);
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(outDir, 'audio'), { recursive: true });

  const outputs = { sessions: [], timelapse: {}, audio: [] };
  const phaseFiles = { day: [], night: [] };

  for (const [i, session] of plan.selected.entries()) {
    const localPath = path.join(workDir, `session-${i}.mp4`);
    await footageSource.fetch({ clip: session.clips[0], start: session.start, end: session.end, destPath: localPath });

    const label = (session.labels[0] ?? 'motion').replace(/[^a-z0-9]/gi, '');
    const stamp = `${String(session.start.getHours()).padStart(2, '0')}${String(session.start.getMinutes()).padStart(2, '0')}`;
    const outPath = path.join(outDir, `s${String(i + 1).padStart(2, '0')}-${stamp}-${label}.mp4`);

    await encodeSession({ files: [localPath], outPath, profile: config.encoding.fullClip, logger });
    session.output = path.basename(outPath);
    outputs.sessions.push(session.output);

    phaseFiles[phaseAt(session.start, sun, config.sun.offsetMinutes)].push(localPath);
    await pauseBetween(config);
  }

  for (const [phase, profile] of Object.entries(config.timelapse.phases)) {
    if (!profile.enabled || !phaseFiles[phase]?.length) continue;
    const outPath = path.join(outDir, `timelapse-${phase}.mp4`);
    await encodeTimelapse({
      files: phaseFiles[phase],
      outPath,
      profile: { ...profile, videoCodec: config.timelapse.videoCodec },
      logger,
    });
    outputs.timelapse[phase] = path.basename(outPath);
  }

  if (config.sources.deleteSourceAfterExtract) {
    await rm(workDir, { recursive: true, force: true });
  }
  return outputs;
}

// ---------------------------------------------------------------------------
// Pipeline B — untagged backfill
// ---------------------------------------------------------------------------

async function runUntagged({ config, auth, days, opts, logger }) {
  const { hot } = resolveArchiveRoots(config);
  const bcfg = config.backfill.untagged;
  const results = [];

  for (const cameraCfg of selectCameras(config, opts)) {
    const sources = buildSources(config, auth, cameraCfg, logger);
    const footageSource = sources[config.sources.footageFrom];

    for (const day of days) {
      const existing = await readManifest(hot, cameraCfg.id, day);
      if (isComplete(existing) && !opts.dryRun) {
        logger.info(`${cameraCfg.id} ${day}: already complete, skipping`);
        continue;
      }

      const segments = (await footageSource.search(day)).map((r) => toClip(r, { date: day }));
      if (!segments.length) {
        logger.warn(`${cameraCfg.id} ${day}: no recordings found`);
        continue;
      }

      const sun = sunTimes(day, config.sun.latitude, config.sun.longitude);
      const totalGB = segments.reduce((a, s) => a + s.sizeBytes, 0) / 1e9;

      if (opts.dryRun) {
        const byPhase = segments.reduce((acc, s) => {
          const p = phaseAt(s.start, sun, config.sun.offsetMinutes);
          acc[p] = (acc[p] ?? 0) + 1;
          return acc;
        }, {});
        logger.info(
          `[dry-run] ${cameraCfg.id} ${day}: ${segments.length} segments, ` +
            `${totalGB.toFixed(2)} GB to download`,
          byPhase,
        );
        results.push({ camera: cameraCfg.id, day, segments: segments.length, totalGB });
        continue;
      }

      await markInProgress(hot, cameraCfg.id, day, 'B');
      const outputs = await materializeUntagged({
        config, bcfg, cameraCfg, day, segments, sun, footageSource, root: hot, logger,
      });

      await writeManifest(
        hot,
        cameraCfg.id,
        day,
        buildManifest({
          camera: cameraCfg.id,
          day,
          pipeline: 'B',
          sessions: [],
          outputs,
          sun,
          config,
          stats: { segments: segments.length, downloadedGB: Math.round(totalGB * 100) / 100 },
        }),
      );
      results.push({ camera: cameraCfg.id, day, outputs });
    }
  }
  return results;
}

/**
 * Pipeline B is a streaming loop: fetch one segment, extract its audio, keep it
 * for the timelapse pass, delete the source. Audio is kept for all 24 hours
 * because it stays valuable without trigger tags — it can become searchable
 * text later — while the video does not.
 */
async function materializeUntagged({ config, bcfg, cameraCfg, day, segments, sun, footageSource, root, logger }) {
  const workDir = path.join(config.storage.workDir, cameraCfg.id, day);
  const outDir = path.join(root, cameraCfg.id, day);
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(outDir, 'audio'), { recursive: true });

  const outputs = { timelapse: {}, audio: [] };
  const phaseFiles = { day: [], night: [] };

  for (const [i, seg] of segments.entries()) {
    const localPath = path.join(workDir, `seg-${String(i).padStart(3, '0')}.mp4`);
    await footageSource.fetch({ clip: seg, start: seg.start, end: seg.end, destPath: localPath });

    const stamp = `${String(seg.start.getHours()).padStart(2, '0')}${String(seg.start.getMinutes()).padStart(2, '0')}`;
    const audioPath = path.join(outDir, 'audio', `${stamp}.${config.encoding.audioSidecar.container}`);
    await extractAudio({ inputPath: localPath, outPath: audioPath, profile: bcfg.audio, logger });
    outputs.audio.push(path.basename(audioPath));

    phaseFiles[phaseAt(seg.start, sun, config.sun.offsetMinutes)].push(localPath);
    logger.info(`  ${cameraCfg.id} ${day} segment ${i + 1}/${segments.length}`);
    await pauseBetween(config);
  }

  for (const [phase, profile] of Object.entries(bcfg.timelapse.phases)) {
    if (!profile.enabled || !phaseFiles[phase]?.length) continue;
    const outPath = path.join(outDir, `timelapse-${phase}.mp4`);
    await encodeTimelapse({
      files: phaseFiles[phase],
      outPath,
      profile: { ...profile, videoCodec: config.timelapse.videoCodec },
      logger,
    });
    outputs.timelapse[phase] = path.basename(outPath);
  }

  if (config.sources.deleteSourceAfterExtract) {
    await rm(workDir, { recursive: true, force: true });
  }
  return outputs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectCameras(config, opts) {
  const all = config.cameras;
  if (!opts.camera) return all;
  const found = all.filter((c) => c.id === opts.camera);
  if (!found.length) throw new Error(`Unknown camera: ${opts.camera}`);
  return found;
}

function pauseBetween(config) {
  const ms = config.backfill?.interSegmentPauseMs ?? 0;
  return ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

function reportPlan({ camera, day, plan, sun, logger }) {
  logger.info(
    `[dry-run] ${camera} ${day} — sunrise ${fmt(sun.sunrise)} sunset ${fmt(sun.sunset)}, ` +
      `budget ${plan.budgetMB} MB, projected ${plan.projectedMB.toFixed(1)} MB`,
  );
  for (const s of plan.selected) {
    logger.info(
      `  KEEP  ${fmt(s.start)} ${(s.durationSec / 60).toFixed(1).padStart(5)}min ` +
        `${s.densityMBPerMin.toFixed(2)}MB/min score=${Math.round(s.score).toString().padStart(6)} ` +
        `[${s.labels.join(',') || 'motion'}]`,
    );
  }
  for (const s of plan.rejected.slice(0, 5)) {
    logger.info(
      `  drop  ${fmt(s.start)} ${(s.durationSec / 60).toFixed(1).padStart(5)}min ` +
        `${s.densityMBPerMin.toFixed(2)}MB/min score=${Math.round(s.score).toString().padStart(6)}`,
    );
  }
  if (plan.rejected.length > 5) logger.info(`  ... and ${plan.rejected.length - 5} more dropped`);
}

function fmt(date) {
  if (!date) return '--:--';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const USAGE = `
camera-archive — Reolink cold archive

  ledger             Pipeline C: detection metadata only (no downloads)
  archive            Pipeline A: scored sessions + day/night timelapse
  backfill-untagged  Pipeline B: hard timelapse + full 24/7 audio

Options
  --day <YYYY-MM-DD|today>
  --range <YYYY-MM-DD..YYYY-MM-DD>
  --camera <id>
  --config <path>
  --dry-run          plan and report sizes without fetching

Design: docs/superpowers/specs/2026-07-18-camera-cold-archive-design.md
`;

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const logger = console;

  if (opts.help || !opts.mode) {
    console.log(USAGE);
    process.exit(opts.mode ? 0 : 1);
  }

  const config = await loadConfig(opts.config);
  const auth = await loadAuth(config);
  const days = resolveDays(opts);

  const modes = {
    ledger: runLedger,
    archive: runArchive,
    'backfill-untagged': runUntagged,
  };
  const run = modes[opts.mode];
  if (!run) {
    console.error(`Unknown mode: ${opts.mode}`);
    console.log(USAGE);
    process.exit(1);
  }

  if (opts.mode !== 'ledger' && !opts.dryRun && config.backfill?.enabled === false && opts.range) {
    throw new Error('Range runs require backfill.enabled: true in config (safety interlock)');
  }

  await run({ config, auth, days, opts, logger });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`camera-archive failed: ${err.message}`);
    process.exitCode = 1;
  });
}
