#!/usr/bin/env node
/**
 * Camera Cold Archive — backfill CLI (host).
 *
 * The nightly pipelines (ledger, archive) run in-app as scheduler jobs; see
 * backend/src/3_applications/camera/. This CLI exists for the work that is
 * inherently a one-off host operation:
 *
 *   backfill-untagged  Pipeline B — the range where no trigger data survives.
 *                      Hard-compressed day/night timelapses plus comprehensive
 *                      24/7 audio, over a ~500 GB transient download. Runs
 *                      overnight, sequentially, resumable.
 *   plan               Dry-run Pipeline A selection for a day, to tune the
 *                      scoring weights against real metadata without encoding.
 *
 * All logic is imported from the backend layers — this is an entry point, not
 * a second implementation.
 *
 * Design: docs/superpowers/specs/2026-07-18-camera-cold-archive-design.md
 */

import { readFile, mkdir, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import axios from 'axios';

import { ReolinkClient, makeSource } from '#adapters/camera/ReolinkRecordingAdapter.mjs';
import { ArchiveEncoder } from '#adapters/camera/ArchiveEncoder.mjs';
import { ArchiveManifestStore } from '#adapters/camera/ArchiveManifestStore.mjs';
import { ArchiveCameraDay } from '#apps/camera/usecases/ArchiveCameraDay.mjs';
import { readLedger, buildLedgerRecords, writeLedger } from '#apps/camera/usecases/BuildDetectionLedger.mjs';
import { createHaDetectionSource } from '#adapters/camera/HaDetectionSource.mjs';
import { HomeAssistantAdapter } from '#adapters/home-automation/homeassistant/HomeAssistantAdapter.mjs';
import { toClip, sessionize, labelSessions } from '#domains/camera/selection.mjs';
import { sunTimes, phaseAt } from '#domains/camera/sun.mjs';
import { planContactSheets } from '#domains/camera/sheetPlan.mjs';
import { renderContactSheets } from '#apps/camera/usecases/RenderContactSheets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

// ---------------------------------------------------------------------------
// Args & config
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [first, ...rest] = argv;
  const mode = first && !first.startsWith('-') ? first : null;
  const opts = { mode, help: !mode, dryRun: false, camera: null, day: null, range: null, config: null };
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

const loadConfig = async (p) => yaml.load(await readFile(p ?? path.join(HERE, 'config.yml'), 'utf8'));

/**
 * `data/` is a bind mount, not part of the repo — on this host the real tree
 * lives at DAYLIGHT_BASE_PATH. Resolving against the repo root finds nothing.
 */
function resolveDataPath(relative) {
  if (!process.env.DAYLIGHT_BASE_PATH && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(path.join(REPO_ROOT, '.env'));
    } catch {
      /* no .env — fall back to repo-relative */
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
      throw new Error(`Reolink credentials not found at ${file}. Set DAYLIGHT_BASE_PATH (see .env).`);
    }
    if (err.code === 'EACCES') {
      throw new Error(`Cannot read ${file} — run as a user with access to the data volume.`);
    }
    throw err;
  }
  const auth = yaml.load(raw);
  if (!auth?.username || !auth?.password) throw new Error(`Missing username/password in ${file}`);
  return auth;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const localDayOf = (d) =>
  [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');

function localDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return localDayOf(d);
}

function expandRange(range) {
  const [from, to] = String(range).split('..');
  if (!from || !to) throw new Error(`Invalid range "${range}" (expected YYYY-MM-DD..YYYY-MM-DD)`);
  const days = [];
  const cursor = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cursor <= end) {
    days.push(localDayOf(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function resolveDays(opts, config) {
  if (opts.range) return expandRange(opts.range);
  if (opts.mode === 'backfill-untagged' && config.backfill?.untagged?.range) {
    return expandRange(config.backfill.untagged.range);
  }
  if (!opts.day || opts.day === 'today') return [localDay(0)];
  if (opts.day === 'yesterday') return [localDay(-1)];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.day)) {
    throw new Error(`Invalid --day "${opts.day}" (expected YYYY-MM-DD, "today", or "yesterday")`);
  }
  return [opts.day];
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

/**
 * Resolve a storage path.
 *
 * Relative paths resolve against the DATA VOLUME, not the repo — `media/` is a
 * bind mount that lives at DAYLIGHT_BASE_PATH on this host. Resolving against
 * the repo root would quietly write tens of GB of archive into the working
 * tree, which is both wrong and easy not to notice until git status explodes.
 */
const abs = (p) => (path.isAbsolute(p) ? p : resolveDataPath(p));

function buildSources(config, auth, cameraCfg, logger) {
  const streamType = config.sources.streamType;
  return {
    camera: makeSource({
      kind: 'camera',
      client: new ReolinkClient({ host: cameraCfg.host, ...auth, logger }),
      channel: 0,
      streamType,
    }),
    nvr: makeSource({
      kind: 'nvr',
      client: new ReolinkClient({ host: config.nvr.host, ...auth, logger }),
      channel: cameraCfg.nvrChannel,
      streamType,
    }),
  };
}

function selectCameras(config, opts) {
  if (!opts.camera) return config.cameras;
  const found = config.cameras.filter((c) => c.id === opts.camera);
  if (!found.length) throw new Error(`Unknown camera: ${opts.camera}`);
  return found;
}

// ---------------------------------------------------------------------------
// ledger — Pipeline C over a historical range
// ---------------------------------------------------------------------------

/**
 * The scheduled job only ever archives yesterday, so catching up a range of
 * past days belongs here.
 *
 * This is the most time-critical mode in the tool despite being the cheapest:
 * detections are the perishable half of the system. HA history holds ~10 days
 * and the driveway's trigger bits ~14, while the NVR keeps the footage for
 * years. Days that age out cannot be re-derived at any download cost.
 */
async function runLedger({ config, auth, days, opts, logger }) {
  const destinations = config.storage.ledgerPaths.map(abs);
  const ha = await buildHaSource(config, logger);

  for (const cameraCfg of selectCameras(config, opts)) {
    const sources = buildSources(config, auth, cameraCfg, logger);
    const bitMap = config.classification?.filenameBits?.[cameraCfg.id] ?? {};

    for (const day of days) {
      const haHistory = ha ? await ha.fetchDay(cameraCfg.id, day) : [];
      const records = await buildLedgerRecords({
        camera: cameraCfg.id,
        day,
        cameraSource: sources.camera,
        nvrSource: sources.nvr,
        haHistory,
        bitMap,
      });

      const bySource = records.reduce((acc, r) => {
        acc[r.source] = (acc[r.source] ?? 0) + 1;
        return acc;
      }, {});

      if (opts.dryRun) {
        logger.info(`[dry-run] ${cameraCfg.id} ${day}: ${records.length} records`, bySource);
        continue;
      }
      const written = await writeLedger({ records, camera: cameraCfg.id, day, destinations });
      logger.info(`${cameraCfg.id} ${day}: ${records.length} records -> ${written.length} dest`, bySource);
    }
  }
}

// ---------------------------------------------------------------------------
// plan — dry-run Pipeline A selection (tuning tool)
// ---------------------------------------------------------------------------

async function runPlan({ config, auth, days, opts, logger }) {
  const hotPath = abs(config.storage.hotPath);
  const manifestStore = new ArchiveManifestStore({ root: hotPath, logger });
  const ledgerRoot = abs(config.storage.ledgerPaths[0]);

  for (const cameraCfg of selectCameras(config, opts)) {
    const sources = buildSources(config, auth, cameraCfg, logger);
    const useCase = new ArchiveCameraDay({
      metaSource: sources[config.sources.metadataFrom],
      footageSource: sources[config.sources.footageFrom],
      encoder: new ArchiveEncoder({ logger }),
      manifestStore,
      readLedger: (camera, d) => readLedger(ledgerRoot, camera, d),
      config: { ...config, storage: { ...config.storage, hotPath } },
      logger,
    });

    for (const day of days) {
      const { plan, sun } = await useCase.execute({ camera: cameraCfg, day, dryRun: true });
      if (plan) report({ camera: cameraCfg.id, day, plan, sun, logger });
    }
  }
}

const hhmm = (d) =>
  d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '--:--';

function report({ camera, day, plan, sun, logger }) {
  logger.info(
    `${camera} ${day} — sunrise ${hhmm(sun.sunrise)} sunset ${hhmm(sun.sunset)}, ` +
      `budget ${plan.budgetMB} MB, projected ${plan.projectedMB.toFixed(1)} MB`,
  );
  for (const s of plan.selected) {
    logger.info(
      `  KEEP  ${hhmm(s.start)} ${(s.durationSec / 60).toFixed(1).padStart(5)}min ` +
        `${s.densityMBPerMin.toFixed(2)}MB/min score=${String(Math.round(s.score)).padStart(6)} ` +
        `[${s.labels.join(',') || 'motion'}]`,
    );
  }
  const shown = plan.rejected.slice(0, 5);
  for (const s of shown) {
    logger.info(
      `  drop  ${hhmm(s.start)} ${(s.durationSec / 60).toFixed(1).padStart(5)}min ` +
        `${s.densityMBPerMin.toFixed(2)}MB/min score=${String(Math.round(s.score)).padStart(6)} (${s.reason})`,
    );
  }
  if (plan.rejected.length > shown.length) {
    logger.info(`  ... and ${plan.rejected.length - shown.length} more dropped`);
  }
}

// ---------------------------------------------------------------------------
// backfill-untagged — Pipeline B
// ---------------------------------------------------------------------------

/**
 * The range where no trigger data survives (~14+ days old). Without labels any
 * clip selection is guesswork, so this spends almost nothing on video — hard
 * day/night timelapses — and keeps audio comprehensively, because audio stays
 * valuable without tags: it can be turned into searchable text later.
 *
 * Audio is muxed into the video, so the full source must be downloaded once
 * regardless; each segment is extracted then deleted before the next is
 * fetched, keeping peak disk near one segment rather than ~500 GB.
 */
async function runUntagged({ config, auth, days, opts, logger }) {
  const bcfg = config.backfill.untagged;
  const encoder = new ArchiveEncoder({ logger });
  const manifestStore = new ArchiveManifestStore({ root: abs(config.storage.hotPath), logger });
  let totalGB = 0;

  for (const cameraCfg of selectCameras(config, opts)) {
    const footageSource = buildSources(config, auth, cameraCfg, logger)[config.sources.footageFrom];

    for (const day of days) {
      if (manifestStore.isComplete(await manifestStore.read(cameraCfg.id, day)) && !opts.dryRun) {
        logger.info(`${cameraCfg.id} ${day}: already complete, skipping`);
        continue;
      }

      const segments = (await footageSource.search(day)).map((r) => toClip(r, { date: day }));
      if (!segments.length) {
        logger.warn(`${cameraCfg.id} ${day}: no recordings`);
        continue;
      }

      const sun = sunTimes(day, config.sun.latitude, config.sun.longitude);
      const dayGB = segments.reduce((a, s) => a + s.sizeBytes, 0) / 1e9;
      totalGB += dayGB;

      if (opts.dryRun) {
        const byPhase = segments.reduce((acc, s) => {
          const p = phaseAt(s.start, sun, config.sun.offsetMinutes);
          acc[p] = (acc[p] ?? 0) + 1;
          return acc;
        }, {});
        logger.info(`[dry-run] ${cameraCfg.id} ${day}: ${segments.length} segments, ${dayGB.toFixed(2)} GB`, byPhase);
        continue;
      }

      await manifestStore.markInProgress(cameraCfg.id, day, 'B');
      const outputs = await materializeUntagged({
        config, bcfg, cameraCfg, day, segments, sun, footageSource, encoder, logger,
      });
      await manifestStore.write(
        cameraCfg.id,
        day,
        manifestStore.build({
          camera: cameraCfg.id, day, pipeline: 'B', sessions: [], outputs, sun, config,
          stats: { segments: segments.length, downloadedGB: Math.round(dayGB * 100) / 100 },
        }),
      );
    }
  }
  logger.info(`${opts.dryRun ? '[dry-run] ' : ''}total download: ${totalGB.toFixed(1)} GB`);
}

async function materializeUntagged({ config, bcfg, cameraCfg, day, segments, sun, footageSource, encoder, logger }) {
  const workDir = path.join(config.storage.workDir, cameraCfg.id, day);
  const outDir = path.join(abs(config.storage.hotPath), cameraCfg.id, day);
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(outDir, 'audio'), { recursive: true });

  const outputs = { timelapse: {}, audio: [], sheets: [] };
  const phaseFiles = { day: [], night: [] };
  const localSegments = [];

  for (const [i, seg] of segments.entries()) {
    const localPath = path.join(workDir, `seg-${String(i).padStart(3, '0')}.mp4`);
    await footageSource.fetch({ clip: seg, start: seg.start, end: seg.end, destPath: localPath });

    const stamp = `${String(seg.start.getHours()).padStart(2, '0')}${String(seg.start.getMinutes()).padStart(2, '0')}`;
    const audioPath = path.join(outDir, 'audio', `${stamp}.${config.encoding.audioSidecar.container}`);
    await encoder.extractAudio({ inputPath: localPath, outPath: audioPath, profile: bcfg.audio });
    outputs.audio.push(path.basename(audioPath));

    phaseFiles[phaseAt(seg.start, sun, config.sun.offsetMinutes)].push(localPath);
    localSegments.push({ start: seg.start, end: seg.end, path: localPath });
    logger.info(`  ${cameraCfg.id} ${day} segment ${i + 1}/${segments.length}`);
    await pause(config.backfill?.interSegmentPauseMs);
  }

  // Contact sheets, before the source segments are deleted. The ledger is read
  // rather than assumed empty: this range was labelled retroactively, so days
  // that do have detections get event sheets instead of blanket hourly ones.
  if (config.contactSheets?.enabled !== false) {
    const ledgerRoot = abs(config.storage.ledgerPaths[0]);
    const detections = await readLedger(ledgerRoot, cameraCfg.id, day);
    const sessions = labelSessions(
      sessionize(detections.filter((d) => d.source !== 'density').map(toLedgerClip), config.sessionize),
      detections,
      { toleranceSeconds: config.classification?.matchToleranceSeconds ?? 15 },
    );
    const plan = planContactSheets(sessions, day, {
      maxSpanMs: (config.contactSheets?.maxSpanMinutes ?? 60) * 60_000,
    });
    const sheetProfile = {
      ...(config.contactSheets ?? {}),
      ...(config.contactSheets?.byCamera?.[cameraCfg.id] ?? {}),
    };
    const res = await renderContactSheets({
      segments: localSegments,
      plan,
      camera: cameraCfg.id,
      outDir: path.join(outDir, 'sheets'),
      encoder,
      detections,
      profile: sheetProfile,
      provenance: { pipeline: 'B', source: config.sources.footageFrom, channel: cameraCfg.nvrChannel },
      logger,
    });
    outputs.sheets = res.written;
  }

  for (const [phase, profile] of Object.entries(bcfg.timelapse.phases)) {
    if (!profile.enabled || !phaseFiles[phase]?.length) continue;
    const outPath = path.join(outDir, `timelapse-${phase}.mp4`);
    await encoder.encodeTimelapse({
      files: phaseFiles[phase],
      outPath,
      profile: { ...profile, videoCodec: config.timelapse.videoCodec },
    });
    outputs.timelapse[phase] = path.basename(outPath);
  }

  if (config.sources.deleteSourceAfterExtract) await rm(workDir, { recursive: true, force: true });
  return outputs;
}

const pause = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Ledger record -> the clip shape sessionize() expects. */
function toLedgerClip(rec) {
  const start = new Date(rec.ts);
  const end = new Date(rec.endTs ?? rec.ts);
  const durationSec = Math.max(1, (end - start) / 1000);
  return {
    start,
    end,
    durationSec,
    sizeBytes: rec.clip?.sizeBytes ?? 0,
    name: rec.clip?.name ?? null,
    densityMBPerMin: rec.densityMBPerMin ?? 0,
  };
}

// ---------------------------------------------------------------------------

const USAGE = `
camera-archive — backfill CLI
(nightly ledger + archive run as scheduler jobs; see Admin > Scheduler)

  ledger             Pipeline C over a past range. No downloads, fast.
                     Time-critical: detections age out (~10-14 days) while the
                     footage they describe survives for years.
  backfill-untagged  Pipeline B: hard timelapse + full 24/7 audio for the
                     pre-metadata range. NVR serves ~1 MB/s, so budget ~45 min
                     per camera-day.
  plan               Dry-run Pipeline A selection, for tuning scoring weights.

Options
  --day <YYYY-MM-DD|today|yesterday>
  --range <YYYY-MM-DD..YYYY-MM-DD>    (defaults to backfill.untagged.range)
  --camera <id>
  --config <path>
  --dry-run          plan and report sizes without fetching

Design: docs/superpowers/specs/2026-07-18-camera-cold-archive-design.md
`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const logger = console;

  if (opts.help || !opts.mode) {
    console.log(USAGE);
    process.exit(opts.mode ? 0 : 1);
  }

  const config = await loadConfig(opts.config);
  const auth = await loadAuth(config);
  const days = resolveDays(opts, config);

  const modes = { ledger: runLedger, plan: runPlan, 'backfill-untagged': runUntagged };
  const run = modes[opts.mode];
  if (!run) {
    console.error(`Unknown mode: ${opts.mode}`);
    console.log(USAGE);
    process.exit(1);
  }

  // Safety interlock: a real Pipeline B run is a multi-hour, ~500 GB operation.
  // It must be opted into in config, not started by a stray command line.
  if (opts.mode === 'backfill-untagged' && !opts.dryRun && config.backfill?.enabled !== true) {
    throw new Error('backfill-untagged requires backfill.enabled: true in config (safety interlock)');
  }

  await run({ config, auth, days, opts, logger });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`camera-archive failed: ${err.message}`);
    process.exitCode = 1;
  });
}

/**
 * Construct the Home Assistant detection source, or null if unconfigured.
 *
 * HA is the PRIMARY classifier — the only label source for the doorbell — so a
 * misconfiguration should be loud, but it must not be fatal: the filename bits
 * and density timeline still yield a usable ledger without it.
 */
async function buildHaSource(config, logger) {
  const ha = config.homeassistant;
  if (!ha?.baseUrl) {
    logger.warn('homeassistant not configured — ledger will have no HA labels');
    return null;
  }
  let token = ha.token;
  if (!token && ha.authFile) {
    token = yaml.load(await readFile(resolveDataPath(ha.authFile), 'utf8'))?.token;
  }
  if (!token) {
    logger.warn(`no Home Assistant token (${ha.authFile}) — ledger will have no HA labels`);
    return null;
  }
  const gateway = new HomeAssistantAdapter({ baseUrl: ha.baseUrl, token }, { httpClient: axios, logger });
  return createHaDetectionSource({
    haGateway: gateway,
    sensorsByCamera: config.classification?.sensorsByCamera ?? {},
    logger,
  });
}
