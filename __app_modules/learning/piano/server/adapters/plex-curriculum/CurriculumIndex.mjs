// CurriculumIndex.mjs — loads a per-show curriculum index and merges it onto items.
import { join } from 'path';
import { fileExists, readTextFromPath } from '#system/utils/FileIO.mjs';
import { createLogger } from '#system/logging/logger.mjs';

const logger = createLogger({ source: 'backend', app: 'piano', context: { component: 'plex-curriculum' } });

// Household data, not code: <dataDir>/content/piano/curriculum/<showRatingKey>.json.
// Composition injects the directory (configureCurriculumDir) from the config data path.
let DIR = null;
const cache = new Map(); // showRatingKey -> index | null

/** Directory of per-show curriculum files, relative to a config data dir. */
export const curriculumDirFor = (dataDir) => join(dataDir, 'content', 'piano', 'curriculum');

export function configureCurriculumDir(dir) {
  DIR = dir || null;
  cache.clear();
}

export function getCurriculumIndex(showRatingKey) {
  const key = String(showRatingKey);
  if (cache.has(key)) return cache.get(key);
  const path = DIR ? join(DIR, `${key}.json`) : null;
  let index = null;
  let reason = null;
  if (!path) reason = 'curriculum-dir-not-configured';
  else {
    try {
      if (fileExists(path)) index = JSON.parse(readTextFromPath(path));
      else reason = 'file-missing';
    } catch (err) { reason = `unreadable: ${err.message}`; }
  }
  // Cached below, so this logs once per show key. Most Plex shows have no curriculum,
  // so a missing per-show file is routine (debug); only a misconfigured or unreadable
  // directory/file is worth a warn.
  if (!index) {
    const level = reason === 'file-missing' ? 'debug' : 'warn';
    logger[level]('piano.curriculum.unavailable', { show: key, dir: DIR, reason });
  }
  cache.set(key, index);
  return index;
}

const EP_PIANO = ['course', 'part', 'lane', 'group', 'song', 'treatment', 'skillChallenge', 'checkpoint', 'styles', 'skill', 'instructor', 'focus', 'type'];
const SEASON_PIANO = ['lane', 'groups', 'facets', 'sequential', 'pinned'];
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = obj[k];
  return out;
};

export function mergeEpisode(index, { season, episode }) {
  const e = index?.episodes?.[`${season}:${episode}`];
  if (!e) return null;
  return { title: e.title ?? undefined, piano: pick(e, EP_PIANO) };
}

export function mergeSeason(index, season) {
  const s = index?.seasons?.[String(season)];
  if (!s) return null;
  return { title: s.title ?? undefined, piano: pick(s, SEASON_PIANO) };
}

export function _resetCacheForTests() { cache.clear(); }
