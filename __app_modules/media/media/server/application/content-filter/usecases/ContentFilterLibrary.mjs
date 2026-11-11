/**
 * The Admin library (spec "Build it"): every matched movie with VidAngel tags, plus every title
 * with a household override, each with its stage. Per-film facts are cached in memory and
 * invalidated when a run settles, an audit lands or the film is written. Plex is asked only which
 * movie keys are live (movie sections, never shows), once per INDEX_TTL_MS: the match index is a
 * snapshot, and a media reorg re-keys titles, so a film can be in the index and gone from Plex
 * (`linked: false`). Plex unreachable means `linked: null`; the list never fails for it.
 *
 * Each film is also `match: 'verified' | 'unmatched'` (domain/content-filter/plexMatch.mjs
 * filmMatch): verified = its key is a live Plex film whose year is within one of the EDL's. A
 * stale key, a different year, an index entry the matcher left unmatched (several Plex films ...)
 * or a key whose film another entry holds is unmatched, with a one-line reason; the Admin shows
 * those apart and never offers them a run. A runtime more than 5 minutes off is only a warning.
 */
import { filmStage } from '../../../domain/content-filter/filmStage.mjs';
import { filmMatch } from '../../../domain/content-filter/plexMatch.mjs';
import { countReviewed } from './ContentFilterReview.mjs';

export const INDEX_TTL_MS = 10 * 60 * 1000;
// A Plex failure is remembered briefly: a blip must not hide linkage for a whole TTL.
const FAILED_LIVE_TTL_MS = 30 * 1000;

export class ContentFilterLibrary {
  #repo; #jobs; #digestOf; #now; #plex; #live = null; #liveAt = null; #liveP = null; #gen = 0; #index = null; #workAt = new Map(); #indexAt = 0; #facts = new Map();

  constructor({ contentFilterRepository, jobs, digestOf, now = () => Date.now(), plex = null }) {
    if (!contentFilterRepository || !jobs || !digestOf) throw new Error('ContentFilterLibrary requires contentFilterRepository, jobs and digestOf');
    this.#repo = contentFilterRepository; this.#jobs = jobs; this.#digestOf = digestOf; this.#now = now; this.#plex = plex;
  }

  /** Forget one film's facts (or everything, with no key: the index too). */
  invalidate(ratingKey) {
    if (ratingKey == null) { this.#index = null; this.#live = null; this.#liveAt = null; this.#liveP = null; this.#gen++; this.#facts.clear(); return; }
    this.#facts.delete(String(ratingKey));
  }

  async #titles() {
    // New matches and overrides appear within INDEX_TTL_MS without a restart.
    if (this.#index && this.#now() - this.#indexAt <= INDEX_TTL_MS) return this.#index;
    const out = new Map();
    const doc = await this.#repo.getMatchIndex();
    const workAt = new Map(); // VidAngel work id -> the key the index verified it at
    for (const [key, m] of Object.entries(doc?.map || {})) {
      const rk = key.replace(/^plex:/, '');
      if (m?.plexType === 'movie' && (m.vidangel?.tagCount ?? 0) > 0 && /^\d+$/.test(rk)) {
        out.set(rk, { kind: 'map', title: m.title ?? null, year: m.year ?? null });
        if (m.vidangel?.id != null) workAt.set(Number(m.vidangel.id), rk);
      }
    }
    for (const [key, u] of Object.entries(doc?.unmatched || {})) {
      const rk = key.replace(/^plex:/, '');
      if (/^\d+$/.test(rk) && !out.has(rk)) out.set(rk, { kind: 'unmatched', title: u?.title ?? null, reason: u?.reason ?? 'not-in-plex', plexYears: u?.plexYears || [] });
    }
    for (const rk of await this.#repo.listOverrides()) if (!out.has(String(rk))) out.set(String(rk), { kind: 'override', title: null });
    this.#index = out;
    this.#workAt = workAt;
    this.#indexAt = this.#now();
    return out;
  }

  /** Map of live Plex movie ratingKey -> { title, year, runtimeSec }, or null when Plex cannot be read. */
  async #liveMovies() {
    if (!this.#plex) return null;
    const ttl = this.#live ? INDEX_TTL_MS : FAILED_LIVE_TTL_MS;
    if (this.#liveAt !== null && this.#now() - this.#liveAt <= ttl) return this.#live;
    if (!this.#liveP) {
      const p = this.#sweepLive().finally(() => { if (this.#liveP === p) this.#liveP = null; });
      this.#liveP = p;
    }
    return this.#liveP;
  }

  async #sweepLive() {
    const gen = this.#gen;
    let live = new Map();
    try {
      const sections = (await this.#plex.getLibrarySections())?.MediaContainer?.Directory || [];
      for (const sec of sections.filter((d) => d.type === 'movie')) {
        const items = (await this.#plex.getContainer(`/library/sections/${sec.key}/all`))?.MediaContainer?.Metadata || [];
        for (const it of items) {
          live.set(String(it.ratingKey), { title: it.title ?? null, year: it.year ?? null, runtimeSec: Number.isFinite(it.duration) ? Math.round(it.duration / 1000) : null });
        }
      }
      if (gen === this.#gen) this.#live = live;
    } catch {
      live = null;
      if (gen === this.#gen) this.#live = null;
    }
    // A sweep that began before an invalidate() hands its answer to its caller but does not cache it.
    if (gen === this.#gen) this.#liveAt = this.#now();
    return gen === this.#gen ? this.#live : live;
  }

  async #film(rk, indexTitle) {
    const cached = this.#facts.get(rk);
    // A run moves through its steps in another process: an active film is re-read every time.
    if (cached && !(cached.job && (cached.job.status === 'queued' || cached.job.status === 'running'))) return cached;
    if (cached) this.#facts.delete(rk);
    const raw = await this.#repo.getEdl(rk);
    const ref = raw?.sourceRef;
    const refined = ref?.workId != null && ref?.tagSetId != null ? await this.#repo.getRefinedEdl(ref) : null;
    const record = await this.#jobs.record(rk);
    const audit = record?.audit || null;
    const run = (record?.runs || []).at(-1) || null;
    const failedStep = run && (run.status === 'failed' || run.status === 'interrupted') ? run.steps?.find((s) => s.name === run.step) : null;
    const override = refined && audit ? await this.#repo.getOverride(rk) : null;
    const counts = audit ? countReviewed(audit.rows || [], override?.review || {}) : null;
    const facts = {
      ratingKey: rk,
      title: indexTitle ?? raw?.title ?? refined?.title ?? null,
      year: refined?.year ?? raw?.year ?? null,
      stage: filmStage({
        hasRefined: !!refined, hasScenesKey: Array.isArray(refined?.scenes),
        audit: audit ? { ok: audit.ok, fresh: refined ? audit.digest === (await this.#digestOf(rk)) : false } : null,
        certificationLevel: refined?.certification?.level ?? 'none', job: run,
      }),
      job: run ? { status: run.status, step: run.step ?? null, error: failedStep?.error ?? null } : null,
      reviewed: counts ? { n: counts.reviewed, m: (audit.rows || []).length } : null,
      // The exported EDL's VidAngel facts, for the Plex match (not shown as such).
      edl: raw ? { year: Number.isFinite(raw.year) ? raw.year : null, runtimeSec: Number.isFinite(raw.runtimeUnalteredSec) ? raw.runtimeUnalteredSec : null, workId: raw.sourceRef?.workId ?? null } : null,
    };
    this.#facts.set(rk, facts);
    return facts;
  }

  async list({ stage = null, q = null } = {}) {
    const needle = q ? String(q).toLowerCase() : null;
    const live = await this.#liveMovies();
    const titles = await this.#titles();
    const films = [];
    let unlinked = 0; let verified = 0;
    for (const [rk, entry] of titles) {
      const f = await this.#entry(rk, entry, live);
      if (f.linked === false) unlinked += 1;
      if (f.match === 'verified') verified += 1;
      if (stage && f.stage !== stage) continue;
      if (needle && !String(f.title || '').toLowerCase().includes(needle)) continue;
      films.push(f);
    }
    films.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')));
    const indexedAt = typeof this.#repo.getMatchIndexWrittenAt === 'function' ? await this.#repo.getMatchIndexWrittenAt() : null;
    return {
      films, worker: typeof this.#jobs.workerStatus === 'function' ? this.#jobs.workerStatus() : null,
      meta: { indexedAt: indexedAt ?? null, total: titles.size, unlinked, verified, unmatched: titles.size - verified },
    };
  }

  async #entry(rk, entry, live) {
    const { edl, ...base } = await this.#film(rk, entry.title);
    const item = live?.get(rk) ?? null;
    const linked = live ? live.has(rk) : null;
    const held = edl?.workId != null ? this.#workAt.get(Number(edl.workId)) : null;
    const verdict = filmMatch({ edl, live: !!live, plexItem: item, indexEntry: entry, duplicateOf: entry.kind !== 'map' && held && held !== rk ? held : null });
    // A poster only when the key is the film: a year-off key would show another film's poster.
    const thumb = linked && verdict.match === 'verified' ? `/api/v1/proxy/plex/library/metadata/${rk}/thumb?w=120&h=180` : null;
    return { ...base, title: base.title ?? item?.title ?? null, year: base.year ?? item?.year ?? null, linked, thumb, ...verdict };
  }

  /** One film's match verdict, for the review page and the run guard. Unknown keys are "no Plex film". */
  async matchOf(ratingKey) {
    const rk = String(ratingKey);
    const live = await this.#liveMovies();
    const titles = await this.#titles();
    const f = await this.#entry(rk, titles.get(rk) || { kind: 'none', title: null }, live);
    return { ratingKey: rk, title: f.title, year: f.year, match: f.match, unmatched: f.unmatched, runtimeWarning: f.runtimeWarning };
  }
}

export default ContentFilterLibrary;
