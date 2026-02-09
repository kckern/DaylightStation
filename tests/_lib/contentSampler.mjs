// tests/_lib/contentSampler.mjs
/**
 * Content Sampler Test Utility
 *
 * Reads real list configs from the data path and samples content IDs
 * for dynamic regression testing.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import { getDataPath } from './configHelper.mjs';

const DATA_PATH = getDataPath();
const LISTS_PATH = DATA_PATH ? `${DATA_PATH}/household/config/lists` : null;

/**
 * Sample content IDs from real list config files.
 * @param {number} maxPerFile - Max items to sample per file (default 3)
 * @returns {{ menus: Array, programs: Array, watchlists: Array }}
 */
export function sampleContentIds(maxPerFile = 3) {
  const samples = { menus: [], programs: [], watchlists: [] };

  if (!LISTS_PATH || !existsSync(LISTS_PATH)) return samples;

  const readYamlDir = (subdir) => {
    const dir = `${LISTS_PATH}/${subdir}`;
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => {
        try {
          return { file: f, data: load(readFileSync(`${dir}/${f}`, 'utf8')) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  };

  for (const { file, data } of readYamlDir('menus')) {
    const items = (data?.items || (Array.isArray(data) ? data : []))
      .filter(i => i.input);
    const picked = items.sort(() => Math.random() - 0.5).slice(0, maxPerFile);
    samples.menus.push(...picked.map(i => ({
      file, label: i.label, input: i.input?.trim(), action: i.action
    })));
  }

  for (const { file, data } of readYamlDir('watchlists')) {
    if (!Array.isArray(data)) continue;
    const picked = data.filter(i => i.src && i.media_key)
      .sort(() => Math.random() - 0.5).slice(0, maxPerFile);
    samples.watchlists.push(...picked.map(i => ({
      file, title: i.title, src: i.src, media_key: String(i.media_key)
    })));
  }

  for (const { file, data } of readYamlDir('programs')) {
    if (!Array.isArray(data)) continue;
    const picked = data.filter(i => i.input)
      .sort(() => Math.random() - 0.5).slice(0, maxPerFile);
    samples.programs.push(...picked.map(i => ({
      file, label: i.label, input: i.input?.trim(), action: i.action
    })));
  }

  return samples;
}

/**
 * Build a TV URL for a given content input and action.
 * @param {string} baseUrl - Base URL (e.g., http://localhost:3111)
 * @param {string} input - Content input (e.g., "plex:457385", "singalong: hymn/166")
 * @param {string} [action] - Action type (Play, List, Open, Display, Queue)
 * @returns {string|null} - Full URL, or null if action is Open (apps need special handling)
 */
export function buildTestUrl(baseUrl, input, action) {
  // Normalize space-after-colon YAML quirk
  const normalized = input.replace(/^(\w+):\s+/, '$1:');
  const act = (action || 'Play').toLowerCase();

  switch (act) {
    case 'list': return `${baseUrl}/tv?list=${normalized}`;
    case 'open': return null; // Apps need special handling
    case 'display': return `${baseUrl}/tv?display=${normalized}`;
    case 'queue': return `${baseUrl}/tv?queue=${normalized}`;
    default: return `${baseUrl}/tv?play=${normalized}`;
  }
}
