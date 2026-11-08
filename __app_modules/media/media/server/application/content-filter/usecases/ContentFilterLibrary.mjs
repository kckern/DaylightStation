/**
 * The Admin library (spec "Build it"): every matched movie with VidAngel tags, plus every title
 * with a household override, each with its stage. Per-film facts are cached in memory and
 * invalidated when a run settles, an audit lands or the film is written. Plex is never called.
 */
import { filmStage } from '../../../domain/content-filter/filmStage.mjs';
import { countReviewed } from './ContentFilterReview.mjs';

export class ContentFilterLibrary {
  #repo; #jobs; #digestOf; #index = null; #facts = new Map();

  constructor({ contentFilterRepository, jobs, digestOf }) {
    if (!contentFilterRepository || !jobs || !digestOf) throw new Error('ContentFilterLibrary requires contentFilterRepository, jobs and digestOf');
    this.#repo = contentFilterRepository; this.#jobs = jobs; this.#digestOf = digestOf;
  }

  /** Forget one film's facts (or everything, with no key: the index too). */
  invalidate(ratingKey) {
    if (ratingKey == null) { this.#index = null; this.#facts.clear(); return; }
    this.#facts.delete(String(ratingKey));
  }

  async #titles() {
    if (this.#index) return this.#index;
    const out = new Map();
    for (const [key, m] of Object.entries((await this.#repo.getMatchIndex())?.map || {})) {
      const rk = key.replace(/^plex:/, '');
      if (m?.plexType === 'movie' && (m.vidangel?.tagCount ?? 0) > 0 && /^\d+$/.test(rk)) out.set(rk, m.title ?? null);
    }
    for (const rk of await this.#repo.listOverrides()) if (!out.has(String(rk))) out.set(String(rk), null);
    this.#index = out;
    return out;
  }

  async #film(rk, indexTitle) {
    if (this.#facts.has(rk)) return this.#facts.get(rk);
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
    const films = [];
    for (const [rk, title] of await this.#titles()) {
      const f = await this.#film(rk, title);
      if (stage && f.stage !== stage) continue;
      if (needle && !String(f.title || '').toLowerCase().includes(needle)) continue;
      films.push(f);
    }
    films.sort((a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')));
    return { films };
  }
}

export default ContentFilterLibrary;
