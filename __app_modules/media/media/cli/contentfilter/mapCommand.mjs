/**
 * contentfilter map [--dry-run] [--offline] [--json]
 *
 * Build the match index (`plex-vidangel-map.yml`) from the cached VidAngel catalog, the exported
 * EDLs and the live Plex movies, by TITLE AND YEAR (±1; see domain/content-filter/plexMatch.mjs),
 * and repair stale EDL keys: an EDL whose ratingKey no longer names its film in Plex moves to the
 * key that does. `--dry-run` prints the plan and writes nothing. Idempotent: a second run on its
 * own output changes nothing (the index is not rewritten when it would be identical).
 *
 * Years: the catalog dump has none. A work's year comes from its EDL, else from the old index,
 * else (unless --offline) from the VidAngel API, asked only for works whose title Plex has.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { normTitle, planMap, diffPlan } from '../../server/domain/content-filter/plexMatch.mjs';

export const MAP_USAGE = 'Usage: contentfilter map [--dry-run] [--offline] [--json]\n\n'
  + 'Match VidAngel works to Plex movies by title AND year (±1), write the match index and move\n'
  + 'stale EDL keys to the Plex film that matches. --dry-run prints the plan and writes nothing;\n'
  + '--offline asks VidAngel for no years (works without one stay unmatched).';

const toNum = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Each `<rk>.edl.yml`: which work it is and VidAngel's title, year and runtime. */
export function readEdlHeads(edlDir) {
  if (!existsSync(edlDir)) return [];
  const out = [];
  for (const f of readdirSync(edlDir).filter((n) => /^\d+\.edl\.yml$/.test(n))) {
    let doc;
    try { doc = yaml.load(readFileSync(path.join(edlDir, f), 'utf8')) || {}; } catch { continue; }
    const workId = toNum(doc.sourceRef?.workId);
    if (workId == null) continue;
    out.push({ ratingKey: f.split('.')[0], workId, slug: doc.sourceRef?.slug ?? null, title: doc.title ?? null, year: toNum(doc.year), runtimeSec: toNum(doc.runtimeUnalteredSec), cueCount: (doc.cues || []).length });
  }
  return out;
}

/** Keys that carry household data (override, review, review history, run record): never moved. */
export function householdKeysIn(dataFilterDir) {
  const keys = new Set();
  for (const sub of ['overrides', 'review', 'review-history', 'jobs']) {
    const dir = path.join(dataFilterDir, sub);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir)) { const m = /^(\d+)(\.refine)?\.yml$/.exec(n); if (m) keys.add(m[1]); }
  }
  return keys;
}

/** VidAngel movie works with filter data that are library films (have an EDL) or that Plex has a title for. */
export async function collectWorks({ catalog = [], edlHeads = [], oldIndex = null, plexMovies = [], resolveYear = null, onProgress = () => {} }) {
  const plexTitles = new Set(plexMovies.map((p) => normTitle(p.title)));
  const oldById = new Map();
  for (const v of Object.values(oldIndex?.map || {})) if (v?.vidangel?.id != null) oldById.set(Number(v.vidangel.id), v.vidangel);
  for (const v of Object.values(oldIndex?.unmatched || {})) if (v?.vidangel?.id != null && !oldById.has(Number(v.vidangel.id))) oldById.set(Number(v.vidangel.id), v.vidangel);
  const works = new Map();
  for (const h of edlHeads) {
    const w = works.get(h.workId) || { workId: h.workId, slug: h.slug, type: 'movie', tagCount: 0, title: h.title, titles: [], year: null, runtimeSec: null, edlKeys: [] };
    w.edlKeys.push(h.ratingKey);
    if (w.year == null && h.year != null) w.year = h.year;
    if (w.runtimeSec == null && h.runtimeSec != null) w.runtimeSec = h.runtimeSec;
    if (!w.tagCount) w.tagCount = h.cueCount;
    works.set(h.workId, w);
  }
  for (const c of catalog) {
    if (c.type !== 'movie' || !(c.tagCount > 0)) continue;
    const w = works.get(c.id);
    if (w) { w.tagCount = c.tagCount; w.slug = w.slug || c.slug; if (c.title && c.title !== w.title) w.titles.push(c.title); continue; }
    if (!plexTitles.has(normTitle(c.title))) continue;
    works.set(c.id, { workId: c.id, slug: c.slug, type: 'movie', tagCount: c.tagCount, title: c.title, titles: [], year: null, runtimeSec: null, edlKeys: [] });
  }
  for (const w of works.values()) {
    if (w.year != null) continue;
    const old = oldById.get(w.workId);
    if (old?.year != null) { w.year = toNum(old.year); w.runtimeSec = w.runtimeSec ?? toNum(old.runtimeSec); continue; }
    if (resolveYear && w.slug) {
      try { w.year = toNum(await resolveYear(w.slug)); } catch { w.year = null; }
      onProgress(`  year ${w.slug} -> ${w.year ?? '?'}`);
    }
  }
  for (const w of works.values()) w.edlKeys.sort((a, b) => Number(a) - Number(b));
  return [...works.values()].sort((a, b) => a.workId - b.workId);
}

/** The library films (tagged movie entries + household keys) of an index. */
function libraryKeys(doc, householdKeys) {
  const keys = new Set();
  for (const [k, v] of Object.entries(doc?.map || {})) if (v?.plexType === 'movie' && (v.vidangel?.tagCount ?? 0) > 0) keys.add(k.replace(/^plex:/, ''));
  for (const k of Object.keys(doc?.unmatched || {})) keys.add(k.replace(/^plex:/, ''));
  for (const k of householdKeys) keys.add(k);
  return keys;
}

/** Plan: no writes. Returns { plan, doc, diff, library }. */
export async function runMap({ catalog, edlHeads, oldIndex, plexMovies, householdKeys = new Set(), resolveYear = null, onProgress }) {
  const works = await collectWorks({ catalog, edlHeads, oldIndex, plexMovies, resolveYear, onProgress });
  const plan = planMap({ works, plexMovies, householdKeys });
  // Shows are not matched by year here (no EDLs; nothing reads them): carried over unchanged.
  const shows = Object.fromEntries(Object.entries(oldIndex?.map || {}).filter(([, v]) => v?.plexType && v.plexType !== 'movie'));
  const doc = {
    source: 'vidangel-catalog + EDL years (title and year ±1)',
    counts: { verified: plan.counts.verified, unmatched: plan.counts.unmatched, shows: Object.keys(shows).length },
    map: { ...plan.map, ...shows },
    unmatched: plan.unmatched,
  };
  const diff = diffPlan(oldIndex, plan);
  // Why each dropped entry left: a duplicate key, no filter data, or its work's own reason.
  const dupOf = new Map(plan.duplicates.map((d) => [d.ratingKey, d.of]));
  const skippedWhy = new Map(plan.skipped.map((s) => [s.workId, s.reason]));
  for (const d of diff.dropped) {
    if (d.reason) continue;
    const old = oldIndex?.map?.[`plex:${d.ratingKey}`];
    if (dupOf.has(d.ratingKey)) d.reason = `duplicate of ${dupOf.get(d.ratingKey)}`;
    else if (!((old?.vidangel?.tagCount ?? 0) > 0)) d.reason = 'no filter data';
    else d.reason = skippedWhy.get(Number(old?.vidangel?.id)) || 'no matching work';
  }

  const before = libraryKeys(oldIndex, householdKeys);
  const fate = { verified: 0, rekeyed: 0, duplicate: 0, unmatched: 0, blocked: 0, dropped: 0 };
  const rekeyFrom = new Set(plan.rekeys.map((r) => r.from));
  const dup = new Set(plan.duplicates.map((d) => d.ratingKey));
  const blockedFrom = new Set(plan.blocked.map((b) => b.from));
  for (const k of before) {
    if (plan.map[`plex:${k}`]) fate.verified++;
    else if (rekeyFrom.has(k)) fate.rekeyed++;
    else if (plan.unmatched[`plex:${k}`]) fate.unmatched++;
    else if (blockedFrom.has(k)) fate.blocked++;
    else if (dup.has(k)) fate.duplicate++;
    else fate.dropped++;
  }
  // The library lists only films with an EDL (after the re-keys move them).
  const withEdl = new Set(edlHeads.map((h) => h.ratingKey));
  for (const r of plan.rekeys) { withEdl.delete(r.from); withEdl.add(r.to); }
  const afterKeys = new Set([...libraryKeys(doc, householdKeys)].filter((k) => withEdl.has(k)));
  const verifiedAfter = [...afterKeys].filter((k) => plan.map[`plex:${k}`]).length;
  return { plan, doc, diff, library: { before: before.size, fate, after: { total: afterKeys.size, verified: verifiedAfter, unmatched: afterKeys.size - verifiedAfter } } };
}

const dumpIndex = (doc) => yaml.dump(doc, { lineWidth: 140 });

/**
 * Apply a plan: move each re-keyed EDL to its new key (contentId rewritten; the old file is kept
 * in edl/_rekeyed/), then write the index (skipped when unchanged). Checks every target first and
 * writes nothing when one is taken.
 */
export function applyPlan({ plan, doc, edlDir, mapPath }) {
  for (const r of plan.rekeys) {
    if (existsSync(path.join(edlDir, `${r.to}.edl.yml`))) throw new Error(`EDL ${r.to}.edl.yml already exists; not re-keying ${r.from} onto it`);
    if (!existsSync(path.join(edlDir, `${r.from}.edl.yml`))) throw new Error(`EDL ${r.from}.edl.yml is missing`);
  }
  let moved = 0;
  if (plan.rekeys.length) mkdirSync(path.join(edlDir, '_rekeyed'), { recursive: true });
  for (const r of plan.rekeys) {
    const from = path.join(edlDir, `${r.from}.edl.yml`);
    const edl = yaml.load(readFileSync(from, 'utf8'));
    edl.contentId = `plex:${r.to}`;
    const to = path.join(edlDir, `${r.to}.edl.yml`);
    writeFileSync(`${to}.tmp`, yaml.dump(edl, { lineWidth: 140 }));
    renameSync(`${to}.tmp`, to);
    renameSync(from, path.join(edlDir, '_rekeyed', `${r.from}.edl.yml`));
    moved++;
  }
  const text = dumpIndex(doc);
  const prior = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : null;
  let wroteIndex = false;
  if (prior !== text) {
    writeFileSync(`${mapPath}.tmp`, text);
    renameSync(`${mapPath}.tmp`, mapPath);
    wroteIndex = true;
  }
  return { wroteIndex, moved };
}

/** The human report (dry-run and apply). */
export function formatMapReport({ plan, diff, library }, { dryRun = false } = {}) {
  const L = [];
  const reasons = Object.entries(plan.counts.reasons).map(([k, v]) => `${k}=${v}`).join(' ');
  L.push(`${dryRun ? 'DRY RUN (nothing written)' : 'map'}: rule = title AND year within 1`);
  L.push(`index: verified ${plan.counts.verified}, unmatched ${plan.counts.unmatched} (${reasons || 'none'}), re-keys ${plan.rekeys.length}, duplicates ${plan.duplicates.length}, blocked ${plan.blocked.length}`);
  L.push(`index movie entries vs before: kept ${diff.kept.length}, re-keyed ${diff.rekeyed.length}, added ${diff.added.length}, dropped ${diff.dropped.length}`);
  const f = library.fate;
  L.push(`library films before: ${library.before} -> verified ${f.verified}, re-keyed ${f.rekeyed}, unmatched ${f.unmatched}, duplicate ${f.duplicate}, blocked ${f.blocked}, dropped ${f.dropped}`);
  L.push(`library after: ${library.after.total} films, ${library.after.verified} verified, ${library.after.unmatched} not matched to Plex`);
  if (plan.rekeys.length) { L.push('', 'Re-keys:'); for (const r of plan.rekeys) L.push(`  re-key ${r.from} -> ${r.to}  ${r.title}`); }
  if (plan.blocked.length) { L.push('', 'Blocked:'); for (const b of plan.blocked) L.push(`  ${b.from} -> ${b.to}  ${b.title}: ${b.why}`); }
  if (diff.dropped.length) { L.push('', 'Dropped from the index:'); for (const d of diff.dropped) L.push(`  ${d.ratingKey} ${d.title ?? ''}${d.reason ? ` (${d.reason})` : ''}`); }
  const un = Object.entries(plan.unmatched);
  if (un.length) {
    L.push('', 'Not matched to Plex:');
    for (const [k, u] of un) {
      const detail = u.reason === 'year-mismatch' ? `Plex has the ${u.plexYears.join(', ')} film${u.plexYears.length > 1 ? 's' : ''}`
        : u.reason === 'ambiguous' ? `several Plex films (${(u.plexKeys || []).join(', ')})` : u.reason;
      L.push(`  ${k.replace(/^plex:/, '')} ${u.title} (${u.year ?? '?'}): ${detail}`);
    }
  }
  return L.join('\n');
}
