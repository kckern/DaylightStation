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

export const PARKED_DIR = '_rekeyed';

function readHeadsIn(dir, extra) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((n) => /^\d+\.edl\.yml$/.test(n))) {
    let doc;
    try { doc = yaml.load(readFileSync(path.join(dir, f), 'utf8')) || {}; } catch { continue; }
    const workId = toNum(doc.sourceRef?.workId);
    if (workId == null) continue;
    out.push({ ratingKey: f.split('.')[0], workId, slug: doc.sourceRef?.slug ?? null, title: doc.title ?? null, year: toNum(doc.year), runtimeSec: toNum(doc.runtimeUnalteredSec), cueCount: (doc.cues || []).length, ...extra });
  }
  return out;
}

/**
 * Each `<rk>.edl.yml`: which work it is and VidAngel's title, year and runtime. EDLs set aside in
 * edl/_rekeyed/ come back with `parked: true`: they keep an unmatched work listed, nothing more.
 */
export function readEdlHeads(edlDir) {
  return [...readHeadsIn(edlDir, {}), ...readHeadsIn(path.join(edlDir, PARKED_DIR), { parked: true })];
}

/**
 * Keys that carry household data, with what each holds: never moved or parked. Every per-key store:
 * overrides/<rk>.yml, jobs/<rk>.yml (run record), review/<rk>.yml + <rk>.refine.yml (review marks,
 * refine review), review-history/<rk>.yml, and media refine/<rk>/ (transcripts). Refined EDLs are
 * keyed by work, not by key, so they follow the work.
 */
export function householdKeysIn(dataFilterDir, mediaFilterDir = null) {
  const keys = new Map();
  const add = (rk, kind) => { const k = keys.get(rk) || []; if (!k.includes(kind)) k.push(kind); keys.set(rk, k); };
  for (const [sub, kind] of [['overrides', 'override'], ['jobs', 'job'], ['review', 'review'], ['review-history', 'review history']]) {
    const dir = path.join(dataFilterDir, sub);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir)) { const m = /^(\d+)(\.refine)?\.yml$/.exec(n); if (m) add(m[1], kind); }
  }
  const refine = mediaFilterDir ? path.join(mediaFilterDir, 'refine') : null;
  if (refine && existsSync(refine)) for (const n of readdirSync(refine)) if (/^\d+$/.test(n)) add(n, 'transcripts');
  return keys;
}

/** Stop before writing when the Plex read looks wrong (empty, or verified films would drop by over 20%). */
export function guardMap({ plexCount, oldIndex, plan, force = false }) {
  if (force) return null;
  if (!plexCount) return 'Plex returned 0 movies; refusing to rebuild the index from that (use --force to override).';
  const before = Object.values(oldIndex?.map || {}).filter((v) => v?.plexType === 'movie' && (v.vidangel?.tagCount ?? 0) > 0).length;
  if (before && plan.counts.verified < before * 0.8) {
    return `Verified films would drop from ${before} to ${plan.counts.verified} (${plan.counts.verified} < 80% of ${before}); refusing (use --force to override).`;
  }
  return null;
}

/** A VidAngel year lookup that pauses after every call, backs off after a failure and gives up. */
export function politeResolver(fn, { pauseMs = 400, tries = 3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return async (slug) => {
    for (let i = 0; i < tries; i++) {
      try { const y = await fn(slug); await sleep(pauseMs); return y; } catch { await sleep(1000 * 2 ** i); }
    }
    return null;
  };
}

/** VidAngel movie works with filter data that are library films (have an EDL) or that Plex has a title for. */
export async function collectWorks({ catalog = [], edlHeads = [], oldIndex = null, plexMovies = [], resolveYear = null, onProgress = () => {} }) {
  const plexTitles = new Set(plexMovies.map((p) => normTitle(p.title)));
  const oldById = new Map();
  for (const v of Object.values(oldIndex?.map || {})) if (v?.vidangel?.id != null) oldById.set(Number(v.vidangel.id), v.vidangel);
  for (const v of Object.values(oldIndex?.unmatched || {})) if (v?.vidangel?.id != null && !oldById.has(Number(v.vidangel.id))) oldById.set(Number(v.vidangel.id), v.vidangel);
  const works = new Map();
  for (const h of edlHeads) {
    const w = works.get(h.workId) || { workId: h.workId, slug: h.slug, type: 'movie', tagCount: 0, title: h.title, titles: [], year: null, runtimeSec: null, edlKeys: [], parkedKeys: [] };
    (h.parked ? w.parkedKeys : w.edlKeys).push(h.ratingKey);
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
    works.set(c.id, { workId: c.id, slug: c.slug, type: 'movie', tagCount: c.tagCount, title: c.title, titles: [], year: null, runtimeSec: null, edlKeys: [], parkedKeys: [] });
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
  for (const w of works.values()) { w.edlKeys.sort((a, b) => Number(a) - Number(b)); w.parkedKeys.sort((a, b) => Number(a) - Number(b)); }
  return [...works.values()].sort((a, b) => a.workId - b.workId);
}

/** The library films (tagged movie entries + household keys) of an index. */
function libraryKeys(doc, householdKeys) {
  const keys = new Set();
  for (const [k, v] of Object.entries(doc?.map || {})) if (v?.plexType === 'movie' && (v.vidangel?.tagCount ?? 0) > 0) keys.add(k.replace(/^plex:/, ''));
  for (const k of Object.keys(doc?.unmatched || {})) keys.add(k.replace(/^plex:/, ''));
  // The library also lists every key with an override (a Set of keys counts each one).
  for (const e of householdKeys) { const [k, kinds] = Array.isArray(e) ? e : [e, null]; if (!kinds || kinds.includes('override')) keys.add(k); }
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
  // The library lists only films with an EDL (after the re-keys and parking move them); an
  // unmatched film is also listed from its parked EDL.
  const withEdl = new Set(edlHeads.filter((h) => !h.parked).map((h) => h.ratingKey));
  for (const r of plan.rekeys) { withEdl.delete(r.from); withEdl.add(r.to); }
  for (const x of plan.park) withEdl.delete(x.ratingKey);
  const anyEdl = new Set(edlHeads.map((h) => h.ratingKey));
  for (const x of plan.park) anyEdl.add(x.ratingKey);
  const afterKeys = new Set([...libraryKeys(doc, householdKeys)].filter((k) => withEdl.has(k) || (doc.unmatched[`plex:${k}`] && anyEdl.has(k))));
  const verifiedAfter = [...afterKeys].filter((k) => plan.map[`plex:${k}`]).length;
  return { plan, doc, diff, household: householdKeys, library: { before: before.size, fate, after: { total: afterKeys.size, verified: verifiedAfter, unmatched: afterKeys.size - verifiedAfter } } };
}

const dumpIndex = (doc) => yaml.dump(doc, { lineWidth: 140 });

/** Move an EDL aside into edl/_rekeyed/, never over one already there (suffix .1, .2 ...). */
function parkFile(edlDir, rk) {
  const src = path.join(edlDir, `${rk}.edl.yml`);
  if (!existsSync(src)) return false;
  const dir = path.join(edlDir, PARKED_DIR);
  mkdirSync(dir, { recursive: true });
  let dest = path.join(dir, `${rk}.edl.yml`);
  for (let n = 1; existsSync(dest); n++) dest = path.join(dir, `${rk}.edl.yml.${n}`);
  renameSync(src, dest);
  return true;
}

/**
 * Apply a plan. Re-keys: write the EDL at its new key (contentId rewritten), then move the old file
 * aside; a crash between the two leaves a source the next run parks as a stale duplicate. Parks:
 * move each wrong-film or stale-duplicate EDL aside. Then write the index (skipped when unchanged).
 * Checks every re-key target first and writes nothing when one is taken.
 */
export function applyPlan({ plan, doc, edlDir, mapPath }) {
  for (const r of plan.rekeys) {
    if (existsSync(path.join(edlDir, `${r.to}.edl.yml`))) throw new Error(`EDL ${r.to}.edl.yml already exists; not re-keying ${r.from} onto it`);
    if (!existsSync(path.join(edlDir, `${r.from}.edl.yml`))) throw new Error(`EDL ${r.from}.edl.yml is missing`);
  }
  let moved = 0; let parked = 0;
  for (const r of plan.rekeys) {
    const edl = yaml.load(readFileSync(path.join(edlDir, `${r.from}.edl.yml`), 'utf8'));
    edl.contentId = `plex:${r.to}`;
    const to = path.join(edlDir, `${r.to}.edl.yml`);
    writeFileSync(`${to}.tmp`, yaml.dump(edl, { lineWidth: 140 }));
    renameSync(`${to}.tmp`, to);
    parkFile(edlDir, r.from);
    moved++;
  }
  for (const x of plan.park || []) if (parkFile(edlDir, x.ratingKey)) parked++;
  const text = dumpIndex(doc);
  const prior = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : null;
  let wroteIndex = false;
  if (prior !== text) {
    writeFileSync(`${mapPath}.tmp`, text);
    renameSync(`${mapPath}.tmp`, mapPath);
    wroteIndex = true;
  }
  return { wroteIndex, moved, parked };
}

/** The human report (dry-run and apply). */
export function formatMapReport({ plan, diff, library, household = new Map() }, { dryRun = false } = {}) {
  const L = [];
  const hh = (k) => (household.get?.(k)?.length ? `  [has household data: ${household.get(k).join(', ')}]` : '');
  const reasons = Object.entries(plan.counts.reasons).map(([k, v]) => `${k}=${v}`).join(' ');
  L.push(`${dryRun ? 'DRY RUN (nothing written)' : 'map'}: rule = title AND year within 1, runtimes within 25%`);
  L.push(`index: verified ${plan.counts.verified}, unmatched ${plan.counts.unmatched} (${reasons || 'none'}), re-keys ${plan.rekeys.length}, duplicates ${plan.duplicates.length}, parked ${plan.park.length}, blocked ${plan.blocked.length}`);
  L.push(`index movie entries vs before: kept ${diff.kept.length}, re-keyed ${diff.rekeyed.length}, added ${diff.added.length}, dropped ${diff.dropped.length}`);
  const f = library.fate;
  L.push(`library films before: ${library.before} -> verified ${f.verified}, re-keyed ${f.rekeyed}, unmatched ${f.unmatched}, duplicate ${f.duplicate}, blocked ${f.blocked}, dropped ${f.dropped}`);
  L.push(`library after: ${library.after.total} films, ${library.after.verified} verified, ${library.after.unmatched} not matched to Plex`);
  if (plan.rekeys.length) { L.push('', 'Re-keys:'); for (const r of plan.rekeys) L.push(`  re-key ${r.from} -> ${r.to}  ${r.title}`); }
  if (plan.blocked.length) { L.push('', 'Blocked:'); for (const b of plan.blocked) L.push(`  ${b.from} -> ${b.to}  ${b.title}: ${b.why}${hh(b.from)}`); }
  if (plan.park.length) {
    const wrong = plan.park.filter((x) => x.why === 'wrong-film').length;
    L.push('', `EDLs set aside to edl/${PARKED_DIR}/ (${wrong} at another film's live key, ${plan.park.length - wrong} stale duplicates):`);
    for (const x of plan.park) L.push(`  park ${x.ratingKey} ${x.title}: ${x.why === 'wrong-film' ? "another film's live key" : 'stale duplicate'}`);
  }
  const hhKeys = [...plan.duplicates.map((d) => [d.ratingKey, `${d.title} (duplicate of ${d.of})`]), ...Object.entries(plan.unmatched).map(([k, u]) => [k.replace(/^plex:/, ''), `${u.title} (not matched: ${u.reason})`])]
    .filter(([k]) => household.get?.(k)?.length);
  if (hhKeys.length) { L.push('', 'Keys with household data left as they are (duplicate or not matched; never moved):'); for (const [k, t] of hhKeys) L.push(`  ${k} ${t}${hh(k)}`); }
  if (diff.dropped.length) { L.push('', 'Dropped from the index:'); for (const d of diff.dropped) L.push(`  ${d.ratingKey} ${d.title ?? ''}${d.reason ? ` (${d.reason})` : ''}`); }
  const un = Object.entries(plan.unmatched);
  if (un.length) {
    L.push('', 'Not matched to Plex:');
    for (const [k, u] of un) {
      const detail = u.reason === 'year-mismatch' ? `Plex has the ${u.plexYears.join(', ')} film${u.plexYears.length > 1 ? 's' : ''}`
        : u.reason === 'ambiguous' ? `several Plex films (${(u.plexKeys || []).join(', ')})`
          : u.reason === 'runtime-mismatch' ? `Plex film is ${(u.plexRuntimeMin || []).join(', ')} min` : u.reason;
      L.push(`  ${k.replace(/^plex:/, '')} ${u.title} (${u.year ?? '?'}): ${detail}`);
    }
  }
  return L.join('\n');
}
