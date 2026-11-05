/**
 * Merges the achievement providers each module contributes into one
 * IAchievementEvidence. A provider is `{name, activities, week(args)}` and
 * returns the port's shape for its own activities only. One that throws makes
 * ITS activities unavailable (indeterminate lines), never the others'.
 */
export class CompositeAchievementEvidence {
  #providers; #logger;

  constructor({ providers = [], logger = console } = {}) {
    this.#providers = providers.filter((p) => p && typeof p.week === 'function');
    this.#logger = logger;
  }

  get activities() { return this.#providers.flatMap((p) => p.activities ?? []); }

  async week(args) {
    const learners = Object.fromEntries((args.learnerIds ?? []).map((id) => [id, { days: {}, milestones: {} }]));
    const contests = {};
    const unavailable = [];
    const results = await Promise.all(this.#providers.map(async (p) => {
      const t0 = Date.now();
      try {
        return { p, out: await p.week(args), ms: Date.now() - t0 };
      } catch (err) {
        this.#logger.warn?.('economy.gems.evidence-unavailable', { source: p.name, error: err?.message ?? String(err) });
        return { p, out: null, ms: Date.now() - t0 };
      }
    }));
    for (const { p, out, ms } of results) {
      if (!out) { unavailable.push(...(p.activities ?? [])); continue; }
      this.#logger.debug?.('economy.gems.evidence-read', { source: p.name, ms });
      for (const [id, mine] of Object.entries(out.learners ?? {})) {
        if (!learners[id]) continue;
        Object.assign(learners[id].days, mine.days ?? {});
        Object.assign(learners[id].milestones, mine.milestones ?? {});
      }
      Object.assign(contests, out.contests ?? {});
      unavailable.push(...(out.unavailable ?? []));
    }
    return { learners, contests, unavailable };
  }
}

export default CompositeAchievementEvidence;
