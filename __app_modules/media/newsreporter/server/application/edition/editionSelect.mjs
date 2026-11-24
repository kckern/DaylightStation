/**
 * Select (pure): turns gathered headlines into the candidate list the picker
 * sees, and decides which "your day" modules this edition carries.
 *
 *   buildCandidates → age filter, de-duplication against the feed's own
 *     repeats and against the previous editions (canonical URL, then
 *     normalized title), newest first, capped.
 *   candidatesFor(category) → the category's `sources` / `exclude` limits.
 *   planModules → show policies for the day, plus the rotation draw (seeded
 *     by the date, so a recompose draws the same; a module the previous
 *     edition carried is out of the draw).
 *   finalizeModules → `when_notable` modules survive only when flagged.
 */
import { DAY_MODULES } from './editionConfig.mjs';
import { isWeekend, seededRandom } from './editionTime.mjs';

export const CANDIDATE_CAP = 250;

const TRACKING_PARAM = /^(utm_|at_|fbclid$|gclid$|mc_|ref$|cmpid$|ocid$|smid$|taid$)/i;

/** Lower-cased host+path without tracking params, fragment or trailing slash. */
export function canonicalUrl(raw) {
  if (!raw) return null;
  try {
    const url = new URL(String(raw));
    const kept = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k));
    const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '')}${query}`;
  } catch {
    return String(raw).trim().toLowerCase() || null;
  }
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'from', 'by', 'as']);

export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .join(' ');
}

const publishedOf = (item) => item.publishedAt || item.timestamp || item.published || null;

/**
 * @param {object} args
 * @param {Array<{ pageId: string, sources: object, briefing?: Array }>} args.pages - getAllHeadlines results
 * @param {Date} args.now
 * @param {number} args.maxAgeHours
 * @param {Array<{ urls?: string[], titles?: string[] }>} [args.previousStories] - stories of earlier editions
 * @param {number} [args.cap]
 * @returns {{ candidates: object[], counts: { headlines: number, tooOld: number, undated: number, repeated: number, seenBefore: number } }}
 */
export function buildCandidates({ pages = [], now, maxAgeHours, previousStories = [], cap = CANDIDATE_CAP }) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  for (const story of previousStories) {
    for (const url of story?.urls || []) { const c = canonicalUrl(url); if (c) seenUrls.add(c); }
    for (const title of story?.titles || []) { const t = normalizeTitle(title); if (t) seenTitles.add(t); }
  }

  const clusterOf = new Map();
  for (const page of pages) {
    for (const cluster of page?.briefing || []) {
      for (const c of cluster.coverage || []) clusterOf.set(`${c.sourceId}|${c.id}`, cluster.id);
    }
  }

  const cutoff = now.getTime() - maxAgeHours * 3600 * 1000;
  const counts = { headlines: 0, tooOld: 0, undated: 0, repeated: 0, seenBefore: 0 };
  const byKey = new Set();
  const urlsToday = new Set();
  const titlesToday = new Set();
  const pool = [];
  for (const page of pages) {
    for (const [sourceId, source] of Object.entries(page?.sources || {})) {
      for (const item of source?.items || []) {
        counts.headlines += 1;
        const key = `${sourceId}|${item.id ?? item.link ?? item.title}`;
        if (byKey.has(key)) { counts.repeated += 1; continue; }
        byKey.add(key);
        const publishedAt = publishedOf(item);
        const ms = publishedAt ? Date.parse(publishedAt) : NaN;
        if (!Number.isFinite(ms)) { counts.undated += 1; continue; }
        if (ms < cutoff) { counts.tooOld += 1; continue; }
        const url = item.link || item.url || null;
        const curl = canonicalUrl(url);
        const ntitle = normalizeTitle(item.title);
        if ((curl && seenUrls.has(curl)) || (ntitle && seenTitles.has(ntitle))) { counts.seenBefore += 1; continue; }
        if ((curl && urlsToday.has(curl)) || (ntitle && titlesToday.has(ntitle))) { counts.repeated += 1; continue; }
        if (curl) urlsToday.add(curl);
        if (ntitle) titlesToday.add(ntitle);
        pool.push({
          sourceId,
          sourceLabel: source.label || sourceId,
          row: source.row ?? null,
          col: source.col ?? null,
          title: String(item.title || '').trim(),
          desc: String(item.desc || item.summary || '').trim(),
          url,
          publishedAt: new Date(ms).toISOString(),
          clusterId: clusterOf.get(`${sourceId}|${item.id}`) ?? null,
          ms,
        });
      }
    }
  }
  pool.sort((a, b) => b.ms - a.ms);
  const candidates = pool.slice(0, cap).map(({ ms, ...c }, i) => ({ id: `h${i + 1}`, ...c }));
  return { candidates, counts };
}

/** The candidates one category may draw from. */
export function candidatesFor(candidates, category) {
  const only = category.sources ? new Set(category.sources) : null;
  const not = new Set(category.exclude || []);
  return candidates.filter((c) => (!only || only.has(c.sourceId)) && !not.has(c.sourceId));
}

function policyAllows(show, date) {
  if (show === 'always' || show === 'when_notable' || show === 'rotate') return true;
  if (show === 'weekdays') return !isWeekend(date);
  if (show === 'weekends') return isWeekend(date);
  return false;
}

/**
 * Which modules to gather for this edition.
 * @param {object} args
 * @param {object} args.day - parsed `day` config
 * @param {string} args.date
 * @param {string[]} [args.previousModules] - modules the previous edition carried
 * @param {string} [args.seed] - extra seed (the reporter id)
 * @returns {{ modules: string[], drawn: string[], pool: string[] }}
 */
export function planModules({ day, date, previousModules = [], seed = '' }) {
  const modules = [];
  const pool = [];
  for (const name of DAY_MODULES) {
    const mod = day?.[name];
    if (!mod || !policyAllows(mod.show, date)) continue;
    if (mod.show === 'rotate') pool.push(name);
    else modules.push(name);
  }
  const previous = new Set(previousModules);
  const eligible = pool.filter((name) => !previous.has(name));
  const random = seededRandom(`${seed}|${date}`);
  const drawn = [];
  const slots = day?.rotation?.slots ?? 1;
  const remaining = [...eligible];
  while (drawn.length < slots && remaining.length) {
    const total = remaining.reduce((sum, name) => sum + (day[name].weight ?? 1), 0);
    let r = random() * total;
    let idx = remaining.findIndex((name) => (r -= day[name].weight ?? 1) < 0);
    if (idx < 0) idx = remaining.length - 1;
    drawn.push(remaining.splice(idx, 1)[0]);
  }
  return { modules: [...modules, ...drawn], drawn, pool };
}

/** Drop `when_notable` modules whose facts were not flagged, and modules with no facts. */
export function finalizeModules({ day, modules, facts }) {
  return modules.filter((name) => {
    const f = facts[name];
    if (!f) return false;
    if (day?.[name]?.show === 'when_notable') return f.notable === true;
    return true;
  });
}
