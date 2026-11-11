/**
 * VidAngel work <-> Plex film matching (the match index, `plex-vidangel-map.yml`).
 *
 * A Plex film matches a VidAngel work only when the normalized title AND the release year
 * (within YEAR_TOLERANCE) agree. Title alone is not enough: a shared title ("Cinderella",
 * "Robin Hood") names several films, and VidAngel's catalog dump carries no year, so the work's
 * year comes from its EDL (or the VidAngel API). One work maps to at most one Plex film; when
 * several Plex films fit, or several works claim one film, nothing is guessed.
 *
 * Pure: no I/O. The CLI (`map`) feeds it the catalog, the EDL headers and the Plex movies; the
 * Admin library uses `filmMatch` to verify each film against live Plex.
 */

export const YEAR_TOLERANCE = 1;
/** A runtime further apart than this is noted, never hidden: VidAngel's figure can differ from the file. */
export const RUNTIME_WARN_SEC = 300;
/** Runtimes further apart than this share of the longer are different films (a 29-min documentary is not the 100-min feature). */
export const RUNTIME_MISMATCH_RATIO = 0.25;

/** Normalize a title for collision-tolerant matching. */
export function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const yearsAgree = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= YEAR_TOLERANCE;
const known = (s) => Number.isFinite(s) && s > 0;
/** Two runtimes too far apart to be one film; unknown runtimes never disagree. */
const runtimesDisagree = (a, b) => known(a) && known(b) && Math.abs(a - b) / Math.max(a, b) > RUNTIME_MISMATCH_RATIO;
const workTitles = (w) => new Set([w.title, ...(w.titles || [])].map(normTitle));
/** Is this Plex item the work's film (title, year and runtime agree)? */
const isFilm = (item, w) => workTitles(w).has(normTitle(item.title)) && yearsAgree(item.year, w.year) && !runtimesDisagree(item.runtimeSec, w.runtimeSec);
const byKey = (a, b) => Number(a) - Number(b) || String(a).localeCompare(String(b));

const listYears = (ys) => (ys.length < 2 ? String(ys[0]) : `${ys.slice(0, -1).join(', ')} and ${ys.at(-1)}`);

/** One line for a person: why this film is not matched to Plex. */
export function reasonText(reason, { plexYears = [], plexRuntimeMin = [] } = {}) {
  switch (reason) {
    case 'runtime-mismatch': return plexRuntimeMin.length ? `Plex film is ${listYears(plexRuntimeMin)} min` : 'Plex film is a different length';
    case 'year-mismatch': return plexYears.length ? `Plex has the ${listYears(plexYears)} film${plexYears.length > 1 ? 's' : ''}` : 'Plex has a different year';
    case 'ambiguous': return 'several Plex films';
    case 'contested': return 'several VidAngel films claim one Plex film';
    case 'year-unknown': return 'VidAngel year unknown';
    case 'duplicate': return 'another entry has this film';
    case 'not-in-plex':
    default: return 'no Plex film';
  }
}

function vaRef(w) {
  return { id: w.workId, slug: w.slug ?? null, type: w.type ?? 'movie', tagCount: w.tagCount ?? 0, year: w.year ?? null, runtimeSec: w.runtimeSec ?? null };
}

/** Title + year (+ runtime) match for one work against a title index of Plex movies. */
function matchOne(w, index) {
  const seen = new Map();
  for (const t of [w.title, ...(w.titles || [])]) for (const p of index.get(normTitle(t)) || []) seen.set(p.ratingKey, p);
  const cands = [...seen.values()];
  if (!cands.length) return { status: 'unmatched', reason: 'not-in-plex' };
  if (!Number.isFinite(w.year)) return { status: 'unmatched', reason: 'year-unknown', plexYears: [...new Set(cands.map((c) => c.year).filter(Number.isFinite))].sort() };
  const byYear = cands.filter((c) => yearsAgree(c.year, w.year));
  const fit = byYear.filter((c) => !runtimesDisagree(c.runtimeSec, w.runtimeSec));
  if (!fit.length && byYear.length) return { status: 'unmatched', reason: 'runtime-mismatch', plexRuntimeMin: [...new Set(byYear.map((c) => Math.round(c.runtimeSec / 60)))].sort((a, b) => a - b) };
  if (fit.length === 1) return { status: 'matched', plex: fit[0] };
  if (fit.length > 1) return { status: 'unmatched', reason: 'ambiguous', plexKeys: fit.map((c) => c.ratingKey).sort(byKey) };
  return { status: 'unmatched', reason: 'year-mismatch', plexYears: [...new Set(cands.map((c) => c.year).filter(Number.isFinite))].sort() };
}

/**
 * Plan the match index and the EDL re-keys.
 *
 * @param {object} p
 * @param {Array<{workId, slug, type, tagCount, title, titles?, year, runtimeSec, edlKeys: string[]}>} p.works
 *   VidAngel movie works with filter data; `edlKeys` are the ratingKeys whose EDL file is this work.
 * @param {Array<{ratingKey, title, year, runtimeSec}>} p.plexMovies  live Plex movies
 * @param {Set<string>|Map<string, string[]>} [p.householdKeys]  keys with household data (override,
 *   review, review history, run record, transcripts): never moved or parked
 * @returns {{ map, unmatched, rekeys, duplicates, blocked, skipped, park, counts }}
 *   `map`: 'plex:<rk>' -> verified entry; `unmatched`: 'plex:<rk>' -> one entry per EDL'd work that
 *   does not match (keyed by one of its EDL keys); `rekeys`: EDL files to move to the matched key;
 *   `skipped`: unmatched works with no EDL (not library films; reported only); `park`: EDL files to
 *   move aside (edl/_rekeyed/) because the key is ANOTHER film in Plex ('wrong-film': the player
 *   would filter that film with this one's cues) or is gone and only duplicates a kept key
 *   ('stale-duplicate', e.g. a re-key interrupted after writing its new file).
 */
export function planMap({ works = [], plexMovies = [], householdKeys = new Set() } = {}) {
  const index = new Map();
  for (const p of plexMovies) {
    const k = normTitle(p.title);
    if (!k) continue;
    if (!index.has(k)) index.set(k, []);
    index.get(k).push({ ...p, ratingKey: String(p.ratingKey) });
  }
  const plexAt = new Map(plexMovies.map((p) => [String(p.ratingKey), p]));
  const edlOwner = new Map(); // ratingKey -> workId of the EDL file there
  for (const w of works) for (const k of w.edlKeys || []) edlOwner.set(String(k), w.workId);

  const results = works.map((w) => ({ w, r: matchOne(w, index) }));
  // One Plex film claimed by several works: none of them gets it.
  const claims = new Map();
  for (const x of results) if (x.r.status === 'matched') claims.set(x.r.plex.ratingKey, (claims.get(x.r.plex.ratingKey) || 0) + 1);
  for (const x of results) {
    if (x.r.status === 'matched' && claims.get(x.r.plex.ratingKey) > 1) x.r = { status: 'unmatched', reason: 'contested', plexKeys: [x.r.plex.ratingKey] };
  }

  const map = {}; const unmatched = {}; const rekeys = []; const duplicates = []; const blocked = []; const skipped = []; const park = [];
  // An EDL left at a key that is not its film: move it aside unless the key has household data.
  const parkIfWrong = (w, k, { stale = false } = {}) => {
    if (householdKeys.has(k)) return;
    const item = plexAt.get(k);
    if (item && !isFilm(item, w)) park.push({ ratingKey: k, workId: w.workId, title: w.title, why: 'wrong-film' });
    else if (!item && stale) park.push({ ratingKey: k, workId: w.workId, title: w.title, why: 'stale-duplicate' });
  };
  for (const { w, r } of results) {
    const keys = [...new Set((w.edlKeys || []).map(String))].sort(byKey);
    if (r.status === 'matched') {
      const t = r.plex.ratingKey;
      map[`plex:${t}`] = { title: r.plex.title, plexType: 'movie', year: r.plex.year ?? null, runtimeSec: r.plex.runtimeSec ?? null, vidangel: vaRef(w), confidence: 'title-year' };
      if (!keys.length) continue;
      let holder = keys.includes(t) ? t : null;
      if (!holder) {
        const occupant = edlOwner.get(t);
        const clean = keys.filter((k) => !householdKeys.has(k));
        if (occupant != null && occupant !== w.workId) {
          blocked.push({ workId: w.workId, title: w.title, from: clean[0] ?? keys[0], to: t, why: 'another film\'s EDL holds the new key' });
        } else if (!clean.length) {
          blocked.push({ workId: w.workId, title: w.title, from: keys[0], to: t, why: 'household data at the old key' });
        } else {
          rekeys.push({ workId: w.workId, title: w.title, from: clean[0], to: t });
          holder = clean[0];
        }
      }
      for (const k of keys) {
        if (k === holder || k === t) continue;
        duplicates.push({ workId: w.workId, title: w.title, ratingKey: k, of: t });
        parkIfWrong(w, k, { stale: true });
      }
      continue;
    }
    // An unmatched work whose EDLs were all set aside earlier stays listed from a parked one.
    const listed = keys.length ? keys : [...new Set((w.parkedKeys || []).map(String))].sort(byKey);
    if (!listed.length) { skipped.push({ workId: w.workId, title: w.title, reason: r.reason }); continue; } // never exported: not a library film
    const shown = listed.find((k) => householdKeys.has(k)) ?? listed[0];
    unmatched[`plex:${shown}`] = {
      title: w.title, plexType: 'movie', year: w.year ?? null, reason: r.reason,
      ...(r.plexYears ? { plexYears: r.plexYears } : {}), ...(r.plexKeys ? { plexKeys: r.plexKeys } : {}),
      ...(r.plexRuntimeMin ? { plexRuntimeMin: r.plexRuntimeMin } : {}),
      vidangel: vaRef(w),
    };
    if (keys.length) parkIfWrong(w, shown);
    for (const k of keys) {
      if (k === shown) continue;
      duplicates.push({ workId: w.workId, title: w.title, ratingKey: k, of: shown });
      parkIfWrong(w, k, { stale: true });
    }
  }
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => byKey(a.slice(5), b.slice(5))));
  const reasons = {};
  for (const u of Object.values(unmatched)) reasons[u.reason] = (reasons[u.reason] || 0) + 1;
  return {
    map: sortObj(map), unmatched: sortObj(unmatched), rekeys, duplicates, blocked, skipped,
    park: park.sort((a, b) => byKey(a.ratingKey, b.ratingKey)),
    counts: { verified: Object.keys(map).length, unmatched: Object.keys(unmatched).length, rekeyed: rekeys.length, duplicates: duplicates.length, blocked: blocked.length, parked: park.length, reasons },
  };
}

/** What a plan changes in an existing index's MOVIE entries (shows are not planned here). */
export function diffPlan(before, plan) {
  const old = Object.entries(before?.map || {}).filter(([, v]) => v?.plexType === 'movie').map(([k]) => k.replace(/^plex:/, ''));
  const next = new Set(Object.keys(plan.map).map((k) => k.replace(/^plex:/, '')));
  const rekeyedTo = new Set(plan.rekeys.map((r) => r.to));
  const rekeyedFrom = new Set(plan.rekeys.map((r) => r.from));
  const oldSet = new Set(old);
  return {
    kept: old.filter((k) => next.has(k)).sort(byKey),
    rekeyed: plan.rekeys,
    added: [...next].filter((k) => !oldSet.has(k) && !rekeyedTo.has(k)).sort(byKey),
    dropped: old.filter((k) => !next.has(k) && !rekeyedFrom.has(k)).sort(byKey)
      .map((k) => ({ ratingKey: k, title: before.map[`plex:${k}`]?.title ?? null, ...(plan.unmatched[`plex:${k}`] ? { reason: plan.unmatched[`plex:${k}`].reason } : {}) })),
  };
}

/**
 * The library's verdict on one film.
 * @param {object} p
 * @param {{year?, runtimeSec?}|null} p.edl  the film's EDL facts (VidAngel's year and runtime)
 * @param {boolean} p.live  Plex was read (false: unreachable or no client)
 * @param {{year?, runtimeSec?}|null} p.plexItem  the live Plex film at this key, or null
 * @param {{kind: 'map'|'unmatched'|'override', reason?, plexYears?, year?}} [p.indexEntry]
 * @param {string|null} [p.duplicateOf]  another library key holds this film's work
 * @returns {{ match: 'verified'|'unmatched', unmatched: {reason, text}|null, runtimeWarning: {edlMin, plexMin}|null }}
 */
export function filmMatch({ edl = null, live, plexItem = null, indexEntry = null, duplicateOf = null }) {
  const no = (reason, detail) => ({ match: 'unmatched', unmatched: { reason, text: reasonText(reason, detail) }, runtimeWarning: null });
  if (indexEntry?.kind === 'unmatched') return no(indexEntry.reason, indexEntry);
  if (duplicateOf) return no('duplicate');
  const edlYear = Number.isFinite(edl?.year) ? edl.year : null;
  if (!live) {
    const stored = indexEntry?.year;
    if (edlYear != null && Number.isFinite(stored) && !yearsAgree(stored, edlYear)) return no('year-mismatch', { plexYears: [stored] });
    return { match: 'verified', unmatched: null, runtimeWarning: null };
  }
  if (!plexItem) return no('not-in-plex');
  if (edlYear != null && Number.isFinite(plexItem.year) && !yearsAgree(plexItem.year, edlYear)) return no('year-mismatch', { plexYears: [plexItem.year] });
  const a = edl?.runtimeSec; const b = plexItem.runtimeSec;
  if (runtimesDisagree(a, b)) return no('runtime-mismatch', { plexRuntimeMin: [Math.round(b / 60)] });
  const runtimeWarning = Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 && Math.abs(a - b) > RUNTIME_WARN_SEC
    ? { edlMin: Math.round(a / 60), plexMin: Math.round(b / 60) } : null;
  return { match: 'verified', unmatched: null, runtimeWarning };
}
