/**
 * GetMaterialProgressSummary — data source for the "Continue where you left
 * off" rail (Phase 6). Composes the existing catalog + per-material units +
 * the progress store; it does NOT re-implement unit ordering, locking, or
 * completion policy.
 *
 * Completion/current flags come verbatim from `GetMaterialUnits` (already
 * School-policy, gate-aware) — this use-case never recomputes them.
 * `progressStore.summarize` is consulted ONLY for its `lastPlayedAt` field
 * (a dumb max-of-timestamps read); its `completed` is Piano completion
 * policy and must never be consumed here (spec §6).
 *
 * Guests (`!userId`) have no recorded progress by definition, so `execute`
 * short-circuits to `[]` before touching the catalog or Plex at all.
 */
export class GetMaterialProgressSummary {
  #catalog;
  #getMaterialUnits;
  #progressStore;
  #logger;

  constructor({ catalog, getMaterialUnits, progressStore, logger = console }) {
    this.#catalog = catalog;
    this.#getMaterialUnits = getMaterialUnits;
    this.#progressStore = progressStore;
    this.#logger = logger;
  }

  /**
   * @param {{ userId?: string, subject?: string }} args
   * @returns {Promise<Array<{
   *   materialId: string, unitsDone: number, unitTotal: number,
   *   nextUnitId: string|null, nextUnitTitle: string|null,
   *   percent: number, lastActivity: string|null
   * }>>}
   */
  async execute({ userId, subject } = {}) {
    if (!userId) return [];

    const { materials } = await this.#catalog.execute();
    const scoped = subject ? materials.filter((m) => m.subject === subject) : materials;

    const results = [];
    for (const m of scoped) {
      let units;
      try {
        ({ units } = await this.#getMaterialUnits.execute({ materialId: m.id, userId }));
      } catch (err) {
        this.#logger.warn?.('school.progress-summary.units-failed', { materialId: m.id, error: err.message });
        continue;
      }

      const hasProgress = units.some((u) => (u.percent ?? 0) > 0 || u.completed);
      if (!hasProgress) continue;

      const unitsDone = units.filter((u) => u.completed).length;
      const unitTotal = units.length;
      const nextUnit = units.find((u) => u.current) ?? null;
      const percent = unitTotal ? Math.round((unitsDone / unitTotal) * 100) : 0;
      const lastActivity = this.#progressStore.summarize(units, userId).lastPlayedAt;

      results.push({
        materialId: m.id,
        unitsDone,
        unitTotal,
        nextUnitId: nextUnit?.id ?? null,
        nextUnitTitle: nextUnit?.title ?? null,
        percent,
        lastActivity,
      });
    }

    results.sort((a, b) => String(b.lastActivity ?? '').localeCompare(String(a.lastActivity ?? '')));

    return results;
  }
}

export default GetMaterialProgressSummary;
