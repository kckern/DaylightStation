/**
 * Seeded household backend for the acceptance server (tech doc §2.4–2.9).
 *
 * Mounts the REAL household services — HouseholdMediaMemoryService,
 * MediaSuggestionsService, the play ledger, the favourites/removed YAML store,
 * MarkContentWatched and the media router's `/household/*` routes — over a
 * throwaway data directory created per server start (`fs.mkdtemp`) from the
 * committed seed in `tests/_fixtures/media-household-seed/`. The seed holds
 * the same YAML the real datastores read; relative-time tokens in it
 * (`${local:D,M}`, `${iso:D,M}`) are expanded against "now" so spots, plays
 * and time-of-day history are always recent. Writes (favourite, remove /
 * restore, watched) land in the temporary directory only; nothing here reads
 * or writes household data.
 *
 * The catalog is the caller's real gateway, confined to an allowlist: a
 * lookup of any other id answers "not found" (items) or an empty list.
 */
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { createMediaRouter } from '../../backend/src/4_api/v1/routers/media.mjs';
import { errorHandlerMiddleware } from '../../backend/src/0_system/http/middleware/index.mjs';
import { HouseholdMediaMemoryService } from '../../backend/src/3_applications/media/HouseholdMediaMemoryService.mjs';
import { MediaSuggestionsService } from '../../backend/src/3_applications/media/MediaSuggestionsService.mjs';
import { PlayLedgerRecorder } from '../../backend/src/3_applications/media/PlayLedgerRecorder.mjs';
import { LivenessNowPlayingReader } from '../../backend/src/3_applications/media/LivenessNowPlayingReader.mjs';
import { LoadOriginHints } from '../../backend/src/3_applications/media/LoadOriginHints.mjs';
import { MarkContentWatched } from '../../backend/src/3_applications/content/usecases/MarkContentWatched.mjs';
import { YamlHouseholdMediaListsDatastore } from '../../backend/src/1_adapters/persistence/yaml/YamlHouseholdMediaListsDatastore.mjs';
import { YamlMediaProgressMemory } from '../../backend/src/1_adapters/persistence/yaml/YamlMediaProgressMemory.mjs';
import { YamlPlayLedgerDatastore } from '../../backend/src/1_adapters/persistence/yaml/YamlPlayLedgerDatastore.mjs';
import { ProgressWriteRuntime } from '../../backend/src/1_adapters/content/ProgressWriteRuntime.mjs';
import { PLAY_LEDGER_RETENTION_DAYS } from '../../backend/src/2_domains/media/playLedger.mjs';
import { formatLocalTimestamp } from '../../backend/src/0_system/utils/time.mjs';

export const DEFAULT_SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_fixtures', 'media-household-seed');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TOKEN = /\$\{(iso|local):(-?\d+),(-?\d+)\}/g;
const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } };

/** Items the seed (and therefore the catalog allowlist) is built on. */
export const HOUSEHOLD_SEED_IDS = Object.freeze({
  ARRIVAL: 'plex:55854',          // one screen, 26 %, open
  DISCLOSURE: 'plex:697368',      // two screens, two different spots
  FAITH: 'plex:584614',           // finished track; time-of-day candidate
  HOSPITAL: 'plex:266151',        // finished episode -> next is KEEPY
  KEEPY: 'plex:266152',           // the next episode (never played)
  COUNTDOWN: 'plex:665638',       // 200 s / 6 %: open by percent, under 5 min
  RED_COAST: 'plex:665639',       // 170 s / 4 %: NOT unfinished; a favourite item
  ANATOMY: 'plex:703558',         // 310 s / 3.6 %: open by seconds; legacy spot; REMOVED
  MARIO_KART: 'plex:675677',      // the "New" addition
  BLUEY: 'plex:59493',            // favourite collection (show)
  BLUEY_SEASON: 'plex:59494',
});
export const SEED_SCREEN_ID = 'fleet:acceptance-media';
export const SEED_KID_TABLET = 'browser:kidtablet';
export const SEED_OLD_TABLET = 'browser:oldtablet';

const stripSource = (id) => String(id ?? '').replace(/^[a-z]+:/, '');

/** Expand `${iso:D,M}` / `${local:D,M}` (D days ago, M minutes offset) in a text. */
export function expandSeedTokens(text, nowMs) {
  return String(text).replace(TOKEN, (_all, kind, days, minutes) => {
    const at = new Date(nowMs - Number(days) * DAY + Number(minutes) * MINUTE);
    return kind === 'iso' ? at.toISOString() : formatLocalTimestamp(at);
  });
}

const readSeedYaml = (file, nowMs) => yaml.load(expandSeedTokens(fs.readFileSync(file, 'utf8'), nowMs));

function copyTree(from, to, nowMs) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target, nowMs);
    else fs.writeFileSync(target, expandSeedTokens(fs.readFileSync(source, 'utf8'), nowMs));
  }
}

/**
 * Materialize the seed into `dataDir`: the data tree (progress, lists), the
 * play ledger day files, and the in-memory states (registry, routines, new).
 * @returns {{registry: Object, routines: Object[], recentAdditions: Object[]}}
 */
export function materializeSeed({ seedDir = DEFAULT_SEED_DIR, dataDir, nowMs = Date.now() }) {
  copyTree(path.join(seedDir, 'data'), dataDir, nowMs);
  const ledgerRoot = path.join(dataDir, 'household', 'history', 'media-plays');
  fs.mkdirSync(ledgerRoot, { recursive: true });
  const rows = readSeedYaml(path.join(seedDir, 'plays.yml'), nowMs) || [];
  const byDay = new Map();
  for (const row of rows) {
    const day = String(row.localTime).slice(0, 10);
    byDay.set(day, [...(byDay.get(day) || []), row]);
  }
  for (const [day, dayRows] of byDay) {
    fs.writeFileSync(path.join(ledgerRoot, `${day}.yml`), yaml.dump(dayRows.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))));
  }
  return {
    registry: readSeedYaml(path.join(seedDir, 'state', 'registry.yml'), nowMs),
    routines: readSeedYaml(path.join(seedDir, 'state', 'routines.yml'), nowMs),
    recentAdditions: readSeedYaml(path.join(seedDir, 'state', 'recent-additions.yml'), nowMs),
  };
}

/**
 * The real catalog gateway, confined to the allowlist. Items outside it are
 * "not found"; lists only for the show/season the next-episode climb reads.
 */
export function createAllowlistedCatalog(gateway, { itemIds, listIds }) {
  const items = new Set([...itemIds].map(stripSource));
  const lists = new Set([...listIds].map(stripSource));
  return {
    resolveSource: (source, localId) => gateway.resolveSource(source, localId),
    progressNamespace: (resolution, ref) => gateway.progressNamespace(resolution, ref),
    getItem: async (resolution, ref) => (items.has(stripSource(ref)) ? gateway.getItem(resolution, ref) : null),
    getList: async (resolution, ref) => (lists.has(stripSource(ref)) ? gateway.getList(resolution, ref) : []),
  };
}

/** Default allowlist: the seed's items, plus the Bluey show/season for the climb. */
export function seedAllowlist(extraItemIds = []) {
  const ids = Object.values(HOUSEHOLD_SEED_IDS);
  return { itemIds: [...ids, ...extraItemIds], listIds: [HOUSEHOLD_SEED_IDS.BLUEY, HOUSEHOLD_SEED_IDS.BLUEY_SEASON] };
}

/**
 * @param {Object} deps
 * @param {Object} deps.catalog - a content catalog gateway (real, or a stub in unit tests)
 * @param {Object} [deps.livenessService] - DeviceLivenessService, for "now on"
 * @param {string} [deps.seedDir]
 * @param {() => number} [deps.nowMs]
 */
export function createMediaHouseholdFixture({ catalog, livenessService = null, seedDir = DEFAULT_SEED_DIR, nowMs = () => Date.now(), logger = quiet }) {
  if (!catalog) throw new TypeError('createMediaHouseholdFixture requires catalog');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylight-media-household-'));
  const configService = { getHouseholdPath: (sub) => path.join(dataDir, 'household', sub) };
  const originHints = new LoadOriginHints();
  const progress = new YamlMediaProgressMemory({ basePath: path.join(dataDir, 'household', 'history', 'media_memory') });
  const nowLocal = () => formatLocalTimestamp(new Date(nowMs()));
  const playLedger = new PlayLedgerRecorder({
    store: new YamlPlayLedgerDatastore({
      root: path.join(dataDir, 'household', 'history', 'media-plays'),
      retentionDays: PLAY_LEDGER_RETENTION_DAYS,
      today: () => nowLocal().slice(0, 10),
      logger,
    }),
    originHints,
    logger,
  });
  const markContentWatched = new MarkContentWatched({
    contentCatalog: catalog, mediaProgressMemory: progress, nowTimestamp: nowLocal, logger,
  });
  const nowPlaying = livenessService?.knownDeviceIds && livenessService?.getLastSnapshot
    ? new LivenessNowPlayingReader({ livenessService }) : null;
  const memory = new HouseholdMediaMemoryService({
    progressMemory: progress,
    listsStore: new YamlHouseholdMediaListsDatastore({ configService }),
    contentCatalog: catalog,
    markContentWatched,
    nowPlaying,
    nowTimestamp: nowLocal,
    runtime: new ProgressWriteRuntime(),
    playLedger,
    logger,
  });
  let seeded = null;
  const recentAdditions = { list: async () => (seeded?.recentAdditions || []).map((item) => ({ ...item })) };
  // The screen registry is built after this fixture (it needs our progress
  // memory for spot folds); suggestions only asks it for merged-screen aliases.
  let boundScreens = null;
  const lateScreens = { aliasesOf: (...args) => boundScreens?.aliasesOf?.(...args) };
  const suggestions = new MediaSuggestionsService({
    memory, playLedger, recentAdditions, screens: lateScreens, nowLocal, logger,
  });
  memory.onListChanged?.(({ householdId }) => (householdId == null ? suggestions.invalidateAll() : suggestions.invalidate(householdId)));

  const router = createMediaRouter({
    mediaQueueService: {},
    mediaSurfaceConfig: { get: () => ({}) },
    mediaQueueEvents: { changed() {} },
    createMediaQueue: (props) => props,
    householdMediaMemory: memory,
    logger,
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandlerMiddleware({ logger: quiet }));

  function seed() {
    for (const entry of fs.readdirSync(dataDir)) fs.rmSync(path.join(dataDir, entry), { recursive: true, force: true });
    seeded = materializeSeed({ seedDir, dataDir, nowMs: nowMs() });
    suggestions.invalidateAll();
    return seeded;
  }
  seed();

  const HOUSEHOLD_PATH = /^\/api\/v1\/media\/(household|suggestions)(\/|\?|$)/;
  return {
    dataDir,
    memory,
    playLedger,
    suggestions,
    progress,
    originHints,
    app,
    /** The seeded registry-only screens, routine snapshot and "New" list. */
    get seeded() { return seeded; },
    bindScreens(screens) { boundScreens = screens; },
    /** Put the household back to its seeded state (a journey that mutated it). */
    reset: seed,
    /** Served by the house fixture's router: suggestions. Here: household routes. */
    handles: (p) => /^\/api\/v1\/media\/household(\/|$)/.test(p),
    handlesSuggestions: (p) => HOUSEHOLD_PATH.test(p),
    async serve(req, res) {
      req.url = req.url.replace(/^\/api\/v1\/media/, '') || '/';
      await new Promise((resolve) => {
        res.once('finish', resolve);
        app(req, res, () => { res.statusCode = 404; res.end(); });
      });
    },
    cleanup() { fs.rmSync(dataDir, { recursive: true, force: true }); },
  };
}
