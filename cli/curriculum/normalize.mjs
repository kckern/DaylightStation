#!/usr/bin/env node
// Usage: node cli/curriculum/normalize.mjs <nfo-root> <report-out>
// DRY RUN ONLY (Plan 1): reads NFOs, writes a normalization manifest. No media writes.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { buildNormalizationPlan } from './normalizePlan.mjs';

const unesc = (s) => (s == null ? s : s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
const one = (xml, el) => { const m = xml.match(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`)); return m ? unesc(m[1].trim()) : null; };
const GENERIC = new Set(['Music', 'Educational']);

const [root, reportOut] = process.argv.slice(2);
if (!root || !reportOut) { console.error('Usage: normalize.mjs <nfo-root> <report-out>'); process.exit(1); }

const records = [];
for (const dir of readdirSync(root)) {
  const p = join(root, dir);
  if (!statSync(p).isDirectory() || !/^Season /.test(dir)) continue;
  const oldSeasonMatch = dir.match(/^Season (\d+)/);
  const oldSeason = oldSeasonMatch ? Number(oldSeasonMatch[1]) : null;
  for (const f of readdirSync(p)) {
    if (!f.endsWith('.nfo') || f === 'season.nfo') continue;
    const xml = readFileSync(join(p, f), 'utf8');
    const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/g)].map((m) => unesc(m[1].trim()));
    const wistiaM = xml.match(/<uniqueid[^>]*type="wistia"[^>]*>([^<]+)<\/uniqueid>/);
    records.push({
      file: join(dir, f),
      oldSeason: oldSeason ?? Number(one(xml, 'season')),
      oldEpisode: Number(one(xml, 'episode')),
      course: (xml.match(/<tag>Course:\s*([^<]+)<\/tag>/) || [, null])[1]?.trim() ? unesc(xml.match(/<tag>Course:\s*([^<]+)<\/tag>/)[1].trim()) : null,
      styles: genres.filter((g) => !GENERIC.has(g)),
      title: one(xml, 'title'),
      wistia: wistiaM ? wistiaM[1].trim() : null,
    });
  }
}

// ---- fail-loud validation: manifest determinism depends on every ----
// ---- (oldSeason, oldEpisode) being finite and unique ----
const badRecords = records.filter((r) => !Number.isFinite(r.oldSeason) || !Number.isFinite(r.oldEpisode));
if (badRecords.length) {
  console.error(`FATAL: ${badRecords.length} episodes have a non-numeric season/episode:`);
  for (const r of badRecords) console.error(`  ${r.file}  season=${r.oldSeason} episode=${r.oldEpisode}`);
  process.exit(1);
}

const byKey = new Map();
for (const r of records) {
  const key = `${r.oldSeason}x${r.oldEpisode}`;
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(r.file);
}
const dupes = [...byKey.entries()].filter(([, files]) => files.length > 1);
if (dupes.length) {
  console.error('FATAL: duplicate (season,episode) pairs — manifest would be non-deterministic:');
  for (const [key, files] of dupes) console.error(`  ${key}:\n    ${files.join('\n    ')}`);
  process.exit(1);
}

const plan = buildNormalizationPlan(records);

// ---- machine-readable ----
writeFileSync(`${reportOut}.json`, JSON.stringify(plan, null, 1));

// ---- human-readable manifest ----
const L = [];
L.push(`# Normalization dry run — ${plan.episodes.length} episodes\n`);
L.push('## Season summary');
for (const s of plan.seasons) {
  L.push(`- S${String(s.newSeason).padStart(2, '0')} ${s.seasonName} [${s.lane}] — ${s.count} eps`);
  for (const g of s.groups) if (g.name !== '—') L.push(`    · ${g.name} (${g.count})`);
}
L.push(`\n## Song-merge list (${plan.songMerge.length} songs) — REVIEW THESE`);
for (const r of plan.songMerge) {
  L.push(`- ${r.song}  [${r.treatments.sort().join(', ')}]  ×${r.count}`);
  if (r.courses.length > 1) L.push(`    variants: ${r.courses.join(' | ')}`);
}
L.push(`\n## Skill-challenge items (${new Set(plan.episodes.filter((e)=>e.skillChallenge).map((e)=>e.base)).size} distinct) — REVIEW: should any of these actually be songs?`);
for (const b of [...new Set(plan.episodes.filter((e)=>e.skillChallenge).map((e)=>e.base))].sort()) L.push(`- ${b}`);
L.push('\n## File moves');
for (const e of plan.episodes.sort((a, b) => (a.newSeason - b.newSeason) || (a.newEpisode - b.newEpisode))) {
  L.push(`  ${e.file}  →  ${e.newDir}/${e.newBasename}.{mp4,nfo}`);
}
writeFileSync(reportOut, L.join('\n'));

// ---- console guardrails ----
console.log(`episodes: ${plan.episodes.length} (expect 2434)`);
console.log(`seasons:  ${plan.seasons.map((s) => `${s.newSeason}:${s.count}`).join('  ')}`);
console.log(`songs:    ${plan.songMerge.length}`);
const skill = plan.episodes.filter((e) => e.skillChallenge).length;
console.log(`skillChallenge eps: ${skill}`);
const noCourse = plan.episodes.filter((e) => !e.course).length;
if (noCourse) console.warn(`WARN: ${noCourse} episodes have no Course tag`);
console.log(`wrote ${reportOut} and ${reportOut}.json`);
