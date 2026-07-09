#!/usr/bin/env node
// cli/curriculum/applyPlan.mjs — apply the normalization plan to the NAS.
// Backup-first, idempotent, --confirm-gated, reversible (writes an undo script).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { buildNormalizationPlan } from './normalizePlan.mjs';
import { parseNfoFull, renderNfo } from './nfoRender.mjs';

const unesc = (s) => (s == null ? s : s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
const one = (xml, el) => { const m = xml.match(new RegExp(`<${el}>([\\s\\S]*?)</${el}>`)); return m ? unesc(m[1].trim()) : null; };
const GENERIC = new Set(['Music', 'Educational']);

export function planToApplyOps(plan, records) {
  const byWistia = new Map(records.map((r) => [r.wistia, r]));
  return plan.episodes.map((e) => {
    const r = byWistia.get(e.wistia) || {};
    const full = r._full || {};
    const nfo = renderNfo({
      title: e.newTitle, showtitle: full.showtitle || 'Piano With Jonny',
      season: e.newSeason, episode: e.newEpisode, plot: full.plot, genres: full.genres || [],
      course: e.base, part: e.part, lane: e.lane, group: e.group,
      song: e.song, treatment: e.treatment, skillChallenge: e.skillChallenge,
      skill: full.skill, focus: full.focus || [], type: full.type,
      credits: full.credits, studio: full.studio, wistia: full.wistia, wistiaDefault: full.wistiaDefault,
    });
    const fromDir = r.file ? r.file.split('/')[0] : null;
    const fromBase = r.file ? r.file.split('/')[1].replace(/\.nfo$/, '') : null;
    return { wistia: e.wistia, from: { dir: fromDir, base: fromBase }, to: { dir: e.newDir, base: e.newBasename }, nfo };
  });
}

export function applyOps(root, ops) {
  const undo = ['#!/bin/sh', '# undo — restores original nfo bytes + reverses moves', `cd "${root}" || exit 1`];
  const STASH = '_undo_nfo';
  for (const op of ops) {
    const toDir = join(root, op.to.dir);
    if (!existsSync(toDir)) mkdirSync(toDir, { recursive: true });
    // mp4: move if present
    const mp4src = join(root, op.from.dir, `${op.from.base}.mp4`);
    const mp4dst = join(toDir, `${op.to.base}.mp4`);
    if (existsSync(mp4src) && mp4src !== mp4dst) renameSync(mp4src, mp4dst);
    // nfo: stash the original (preserve bytes), then write the new one
    const nfosrc = join(root, op.from.dir, `${op.from.base}.nfo`);
    const nfodst = join(toDir, `${op.to.base}.nfo`);
    if (existsSync(nfosrc)) {
      const stash = join(root, STASH, op.from.dir, `${op.from.base}.nfo`);
      mkdirSync(dirname(stash), { recursive: true });
      renameSync(nfosrc, stash);
    }
    writeFileSync(nfodst, op.nfo);
    undo.push(`rm -f "${op.to.dir}/${op.to.base}.nfo"`);
    undo.push(`[ -f "${STASH}/${op.from.dir}/${op.from.base}.nfo" ] && mkdir -p "${op.from.dir}" && mv "${STASH}/${op.from.dir}/${op.from.base}.nfo" "${op.from.dir}/${op.from.base}.nfo"`);
    undo.push(`mv "${op.to.dir}/${op.to.base}.mp4" "${op.from.dir}/${op.from.base}.mp4" 2>/dev/null`);
  }
  return undo.join('\n') + '\n';
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  const seasonArg = process.argv.includes('--season') ? Number(process.argv[process.argv.indexOf('--season') + 1]) : null;
  const confirm = process.argv.includes('--confirm');
  if (!root) { console.error('Usage: applyPlan.mjs <nfo-root> [--season <oldN>] [--confirm]'); process.exit(1); }

  const records = [];
  for (const dir of readdirSync(root)) {
    const p = join(root, dir);
    if (!statSync(p).isDirectory() || !/^Season /.test(dir)) continue;
    const os = Number((dir.match(/^Season (\d+)/) || [])[1]);
    for (const f of readdirSync(p)) {
      if (!f.endsWith('.nfo') || f === 'season.nfo') continue;
      const xml = readFileSync(join(p, f), 'utf8');
      const genres = [...xml.matchAll(/<genre>([^<]+)<\/genre>/g)].map((m) => unesc(m[1].trim()));
      const full = parseNfoFull(xml);
      records.push({
        file: `${dir}/${f}`, oldSeason: os, oldEpisode: Number(one(xml, 'episode')),
        course: (xml.match(/<tag>Course:\s*([^<]+)<\/tag>/) ? unesc(xml.match(/<tag>Course:\s*([^<]+)<\/tag>/)[1].trim()) : null),
        styles: genres.filter((g) => !GENERIC.has(g)), title: one(xml, 'title'), wistia: full.wistia, _full: full,
        hasLane: /<tag>Lane:/.test(xml),
      });
    }
  }
  // Idempotency: refuse if any source NFO already carries a Lane tag (already normalized).
  const already = records.filter((r) => r.hasLane).length;
  if (already > 0) {
    console.error(`FATAL: ${already} NFOs already carry a <tag>Lane:> (already normalized). Restore from backup before re-running.`);
    process.exit(1);
  }
  // Pre-flight: every record must have a present, unique wistia id (the join key).
  const seenW = new Map(); const badW = [];
  for (const r of records) {
    if (!r.wistia) badW.push(`${r.file} (no wistia)`);
    else if (seenW.has(r.wistia)) badW.push(`${r.file} (dup wistia ${r.wistia} shared with ${seenW.get(r.wistia)})`);
    else seenW.set(r.wistia, r.file);
  }
  if (badW.length) {
    console.error(`FATAL: ${badW.length} records with missing/duplicate wistia id:`);
    badW.slice(0, 20).forEach((x) => console.error('  ' + x));
    process.exit(1);
  }

  const plan = buildNormalizationPlan(records);
  let ops = planToApplyOps(plan, records);
  if (seasonArg != null) {
    const wByOldSeason = new Set(records.filter((r) => r.oldSeason === seasonArg).map((r) => r.wistia));
    ops = ops.filter((o) => wByOldSeason.has(o.wistia));
  }
  console.log(`ops: ${ops.length}${seasonArg != null ? ` (old season ${seasonArg} only)` : ''}`);
  for (const o of ops.slice(0, 10)) console.log(`  ${o.from.dir}/${o.from.base}  ->  ${o.to.dir}/${o.to.base}`);
  const missingMp4 = ops.filter((o) => !existsSync(join(root, o.from.dir, `${o.from.base}.mp4`)));
  if (missingMp4.length) {
    console.warn(`WARN: ${missingMp4.length} ops have NO source .mp4 (nfo-only, would orphan):`);
    missingMp4.slice(0, 20).forEach((o) => console.warn('  ' + o.from.dir + '/' + o.from.base));
  }
  if (!confirm) { console.log('DRY (no --confirm): nothing written.'); process.exit(0); }

  const undo = applyOps(root, ops);
  const undoPath = join(root, `_undo-${seasonArg != null ? `s${seasonArg}` : 'all'}.sh`);
  writeFileSync(undoPath, undo);
  console.log(`APPLIED ${ops.length} ops. Undo script: ${undoPath}`);
}
