/**
 * The Admin library (spec "Build it"): every matched movie with VidAngel tags, plus every title
 * with a household override, each with its stage. Per-film facts are cached in memory and
 * invalidated when a run settles, an audit lands or the film is written. Plex is asked only which
 * movie keys are live (movie sections, never shows), once per INDEX_TTL_MS: the match index is a
 * snapshot, and a media reorg re-keys titles, so a film can be in the index and gone from Plex
 * (`linked: false`). Plex unreachable means `linked: null`; the list never fails for it.
 */
import { filmStage } from '../../../domain/content-filter/filmStage.mjs';
import { countReviewed } from './ContentFilterReview.mjs';

export const INDEX_TTL_MS = 10 * 60 * 1000;
// A Plex failure is remembered briefly: a blip must not hide linkage for a whole TTL.
const FAILED_LIVE_TTL_MS = 30 * 1000;

export class ContentFilterLibrary {
  #repo; #jobs; #digestOf; #now; #plex; #live = null; #liveAt = null; #liveP = null; #gen = 0; #index = null; #indexAt = 0; #facts = new Map();

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
    for (const [key, m] of Object.entries((await this.#repo.getMatchIndex())?.map || {})) {
      const rk = key.replace(/^plex:/, '');
      if (m?.plexType === 'movie' && (m.vidangel?.tagCount ?? 0) > 0 && /^\d+$/.test(rk)) out.set(rk, m.title ?? null);
    }
    for (const rk of await this.#repo.listOverrides()) if (!out.has(String(rk))) out.set(String(rk), null);
    this.#index = out;
    this.#indexAt = this.#now();
    return out;
  }

  /** Map of live Plex movie ratingKey -> { title, year }, or null when Plex cannot be read. */
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
        for (const it of items) live.set(String(it.ratingKey), { title: it.title ?? null, year: it.year ?? null });
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
    };
    this.#facts.set(rk, facts);
    return facts;
  }

  async list({ stage = null, q = null } = {}) {
    const needle = q ? String(q).toLowerCase() : null;
    const live = await this.#liveMovies();
    const titles = await this.#titles();
    const films = [];
    let unlinked = 0;
    for (const [rk, title] of titles) {
      const base = await this.#film(rk, title);
      const item = live?.get(rk) ?? null;
      const linked = live ? live.has(rk) : null;
      if (linked === false) unlinked += 1;
      const f = { ...base, title: base.title ?? item?.title ?? null, year: base.year ?? item?.year ?? null,
        linked, thumb: linked ? `/api/v1/proxy/plex/library/metadata/${rk}/thumb?w=120&h=180` : null };
      if (stage && f.stage !== stage) continue;
      if (needle && !String(f.title || '').toLowerCase().includes(needle)) continue;
      films.push(f);
    }
    films.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')));
    const indexedAt = typeof this.#repo.getMatchIndexWrittenAt === 'function' ? await this.#repo.getMatchIndexWrittenAt() : null;
    return {
      films, worker: typeof this.#jobs.workerStatus === 'function' ? this.#jobs.workerStatus() : null,
      meta: { indexedAt: indexedAt ?? null, total: titles.size, unlinked },
    };
  }
}

export default ContentFilterLibrary;
