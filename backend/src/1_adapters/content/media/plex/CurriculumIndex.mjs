// CurriculumIndex.mjs — loads a per-show curriculum index and merges it onto items.
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'curriculum');
const cache = new Map(); // showRatingKey -> index | null

export function getCurriculumIndex(showRatingKey) {
  const key = String(showRatingKey);
  if (cache.has(key)) return cache.get(key);
  const path = join(DIR, `${key}.json`);
  let index = null;
  try { if (existsSync(path)) index = JSON.parse(readFileSync(path, 'utf8')); } catch { index = null; }
  cache.set(key, index);
  return index;
}

const EP_PIANO = ['course', 'part', 'lane', 'group', 'song', 'treatment', 'skillChallenge', 'styles', 'skill', 'instructor', 'focus', 'type'];
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
