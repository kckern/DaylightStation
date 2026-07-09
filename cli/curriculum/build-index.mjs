#!/usr/bin/env node
// Usage: node cli/curriculum/build-index.mjs <nfo-root-dir> <show-id> <out.json>
// Reads Season */*.nfo under <nfo-root-dir>, writes the merged index JSON.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseEpisodeNfo, parseSeasonNfo, buildIndex } from './nfoIndex.mjs';

// Authored season → title/lane/groups map for the 9-season model.
const SEASON_META = {
  0: { title: 'Practice', lane: 'practice', groups: ['How to Practice', 'Scales', 'Chord & Voicing Exercises', 'Rhythm Exercises', 'Two-Hand Coordination'] },
  1: { title: 'Soloing', lane: 'lessons', sequential: true, groups: ['Pop Soloing', '2-5-1 Soloing'] },
  2: { title: 'Improvisation', lane: 'lessons', sequential: true },
  3: { title: 'Chord Voicings', lane: 'lessons', sequential: true, groups: ['Rootless Voicings', 'Drop 2 Voicings', 'Quartal Voicings', 'Block Chords'] },
  4: { title: 'Chord Theory & Color', lane: 'lessons', sequential: true },
  5: { title: 'Lead Sheet Application', lane: 'lessons', sequential: true },
  6: { title: 'Comping & Rhythm', lane: 'lessons', sequential: true, groups: ['Comping', 'Rhythm Essentials'] },
  7: { title: 'Intros, Endings & Fills', lane: 'lessons', sequential: true },
  8: { title: 'Song Library', lane: 'repertoire', facets: ['difficulty', 'instructor', 'style'] },
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
