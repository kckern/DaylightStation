#!/usr/bin/env node
// Usage: node cli/curriculum/build-index.mjs <nfo-root-dir> <show-id> <out.json>
// Reads Season */*.nfo under <nfo-root-dir>, writes the merged index JSON.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseEpisodeNfo, parseSeasonNfo, buildIndex } from './nfoIndex.mjs';

// Authored season → category map (see spec). Adjust here if categories change.
const SEASON_META = {
  0: { title: 'Reference', category: 'reference', pinned: true },
  1: { category: 'lesson', sequential: true }, 2: { category: 'lesson', sequential: true },
  3: { category: 'lesson', sequential: true }, 4: { category: 'lesson', sequential: true },
  5: { category: 'lesson', sequential: true }, 6: { category: 'lesson', sequential: true },
  7: { category: 'lesson', sequential: true }, 8: { category: 'lesson', sequential: true },
  9: { category: 'lesson', sequential: true },
  10: { category: 'repertoire', kind: 'tutorial', facets: ['difficulty', 'instructor', 'style'] },
  11: { category: 'repertoire', kind: 'challenge', facets: ['difficulty', 'instructor', 'style'] },
  12: { category: 'repertoire', kind: 'accompaniment', facets: ['difficulty', 'instructor', 'style'] },
};

const [root, showId, out] = process.argv.slice(2);
if (!root || !showId || !out) { console.error('Usage: build-index.mjs <nfo-root> <show-id> <out.json>'); process.exit(1); }

const episodes = [];
const seasonTitles = {};
for (const dir of readdirSync(root)) {
  const p = join(root, dir);
  if (!statSync(p).isDirectory() || !/^Season /.test(dir)) continue;
  for (const f of readdirSync(p)) {
    if (!f.endsWith('.nfo')) continue;
    const xml = readFileSync(join(p, f), 'utf8');
    if (f === 'season.nfo') { const s = parseSeasonNfo(xml); if (s.season != null) seasonTitles[s.season] = s.title; continue; }
    const ep = parseEpisodeNfo(xml); if (ep) episodes.push(ep);
  }
}
// Merge scanned season titles into the authored meta.
const seasonMeta = {};
for (const [sn, meta] of Object.entries(SEASON_META)) seasonMeta[sn] = { title: seasonTitles[sn] ?? meta.title, ...meta };

const idx = buildIndex({ show: Number(showId), seasonMeta, episodes });
writeFileSync(out, JSON.stringify(idx, null, 1));
console.log(`wrote ${out}: ${Object.keys(idx.seasons).length} seasons, ${Object.keys(idx.episodes).length} episodes`);
