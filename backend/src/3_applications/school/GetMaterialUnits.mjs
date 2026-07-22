/**
 * GetMaterialUnits — a material's unit list with per-user progress, quiz
 * gate and lock state folded in (spec §5, §6). Resolution of `materialId` is
 * delegated entirely to the injected `catalog.findMaterial` (GetMaterialCatalog)
 * so this use-case never re-implements the source/root walk or its cache.
 *
 * Flow per unit: read raw playhead/percent via `progressStore.enrich` (dumb
 * store read only — School must never consume its `userWatched`/
 * `userEngaged`/`userCompletedAt`, which are Piano completion policy, spec §6);
 * look up a gating bank via `bankIndex.byUnit`; if one exists, fold the user's
 * attempt log through `quizSessionPassed` to derive `gateSatisfied` (a guest,
 * i.e. no `userId`, never satisfies a gate — nothing to attribute a pass to);
 * fold `percent`+`gateSatisfied` through the category's `unitCompleted`
 * conditions; then `annotateLocks` the whole ordered list in one pass.
 */
import { resolveCategory, orderUnits, unitCompleted, annotateLocks, quizSessionPassed } from '#domains/school/index.mjs';
import { EntityNotFoundError } from '#domains/core/errors/index.mjs';

/**
 * Builds a tiny lookup from `listBanks()`-shaped bank rows to the unit each
 * gates. Banks without a `unit` backlink are not gates for anything and are
 * skipped.
 *
 * @param {Array<{id:string, unit?:string, itemCount:number}>} banks
 * @returns {{byUnit: function(string): ({bankId:string, itemCount:number}|null)}}
 */
export function buildBankIndex(banks) {
  const map = new Map();
  for (const bank of banks || []) {
    if (!bank.unit) continue;
    map.set(bank.unit, { bankId: bank.id, itemCount: bank.itemCount });
  }
  return { byUnit: (unitId) => map.get(unitId) || null };
}

export class GetMaterialUnits {
  #catalog;
  #sources;
  #config;
  #progressStore;
  #bankIndex;
  #attemptsReader;
  #logger;

  constructor({ catalog, sources, config, progressStore, bankIndex, attemptsReader, logger = console }) {
    this.#catalog = catalog;
    this.#sources = sources;
    this.#config = config;
    this.#progressStore = progressStore;
    this.#bankIndex = bankIndex;
    this.#attemptsReader = attemptsReader;
    this.#logger = logger;
  }

  /**
   * @param {{materialId:string, userId?:string}} args
   * @returns {Promise<{material:object, units:Array}>}
   */
  async execute({ materialId, userId }) {
    const found = await this.#catalog.findMaterial(materialId);
    if (!found) throw new EntityNotFoundError('material', materialId);
    const { entry, material: catalogMaterial } = found;

    const { def: categoryDef } = resolveCategory(catalogMaterial.category, { logger: this.#logger, sourceLabel: entry.label });

    const adapter = this.#sources[entry.source];
    const full = await adapter.getMaterial(materialId);
    const ordered = orderUnits(full.units);

    const enriched = this.#progressStore.enrich(ordered, userId);

    const attempts = userId != null ? this.#attemptsReader.read(userId) : [];

    const rows = ordered.map((unit, i) => {
      const bank = this.#bankIndex.byUnit(unit.id);
      const percent = enriched[i]?.userPercent ?? null;
      const playhead = enriched[i]?.userPlayhead ?? null;
      const gateSatisfied = bank
        ? (userId != null && quizSessionPassed(attempts, { bankId: bank.bankId, itemCount: bank.itemCount, passPercent: this.#config.quiz_pass_percent }))
        : true;
      const completed = unitCompleted({ percent: percent ?? 0, gateSatisfied }, categoryDef, {
        completionThresholdPercent: this.#config.completion_threshold_percent,
      });
      return {
        unit, percent, playhead, completed,
        quiz: bank ? { bankId: bank.bankId } : null,
        gateInfo: { hasQuiz: !!bank, gateSatisfied },
      };
    });

    const completedFlags = rows.map((r) => r.completed);
    const gateInfos = rows.map((r) => r.gateInfo);
    const locks = annotateLocks(ordered, completedFlags, categoryDef, gateInfos);

    const units = rows.map((r, i) => ({
      ...r.unit,
      percent: r.percent,
      playhead: r.playhead,
      completed: r.completed,
      locked: locks[i].locked,
      current: locks[i].current,
      lockReason: locks[i].lockReason,
      quiz: r.quiz,
    }));

    const material = { ...full, category: catalogMaterial.category };
    return { material, units };
  }
}

export default GetMaterialUnits;
