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

// Fetching a material's units from Plex (episodes/chapters) occasionally stalls
// on a specific item — a single show could hang the request for 70s+, leaving
// the detail's chapter tiles stuck on their loading skeletons forever. Bound
// each fetch so a stall fails fast (the detail then shows a retry, not an
// endless skeleton); cache the expensive result so a load, once it succeeds, is
// instant for everyone; coalesce concurrent fetches so the frontend's retries
// don't stampede the stall.
const MATERIAL_TIMEOUT_MS = 20_000;
const MATERIAL_TTL_MS = 300_000; // units rarely change; progress is folded fresh each call

export class GetMaterialUnits {
  #catalog;
  #sources;
  #config;
  #progressStore;
  #bankIndex;
  #attemptsReader;
  #logger;
  #materialTimeoutMs;
  #materialCache = new Map(); // materialId -> { full, at }
  #materialInflight = new Map(); // materialId -> Promise

  constructor({ catalog, sources, config, progressStore, bankIndex, attemptsReader, logger = console, materialTimeoutMs = MATERIAL_TIMEOUT_MS }) {
    this.#catalog = catalog;
    this.#sources = sources;
    this.#config = config;
    this.#progressStore = progressStore;
    this.#bankIndex = bankIndex;
    this.#attemptsReader = attemptsReader;
    this.#logger = logger;
    this.#materialTimeoutMs = materialTimeoutMs;
  }

  #withTimeout(promise, ms, materialId) {
    let t;
    const timeout = new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`getMaterial("${materialId}") timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }

  // The expensive part: pull the material + its raw units from the source
  // (Plex). Cached per material, deduped while in flight, and bounded so a Plex
  // stall rejects instead of hanging. Progress/lock state is NOT cached here —
  // it is folded fresh from the store on every execute() call.
  async #fetchFull(adapter, materialId) {
    const cached = this.#materialCache.get(materialId);
    if (cached && (Date.now() - cached.at) < MATERIAL_TTL_MS) return cached.full;

    // One real fetch per material, shared by all concurrent callers. It caches
    // on completion INDEPENDENT of any caller's timeout — so even a very slow
    // Plex response still warms the cache, and the user's next "Try again" then
    // loads instantly rather than racing the same stall forever.
    let real = this.#materialInflight.get(materialId);
    if (!real) {
      real = adapter.getMaterial(materialId)
        .then((full) => { this.#materialCache.set(materialId, { full, at: Date.now() }); return full; })
        .finally(() => this.#materialInflight.delete(materialId));
      this.#materialInflight.set(materialId, real);
    }
    // Each caller bounds its OWN wait so a stall fails THIS request fast (the
    // detail shows a retry) without cancelling the shared, cache-warming fetch.
    return this.#withTimeout(real, this.#materialTimeoutMs, materialId);
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
    const full = await this.#fetchFull(adapter, materialId);
    const ordered = orderUnits(full.units);

    const enriched = this.#progressStore.enrich(ordered, userId);

    const attempts = userId != null ? this.#attemptsReader.read(userId) : [];

    const rows = ordered.map((unit, i) => {
      const bank = this.#bankIndex.byUnit(unit.id);
      const percent = enriched[i]?.userPercent ?? null;
      const playhead = enriched[i]?.userPlayhead ?? null;
      // A gated (course) unit with NO bank does not auto-satisfy its gate:
      // the gate exists in principle, the quiz just hasn't been authored yet
      // (quizzes are made on demand — see the request-a-quiz affordance).
      // Watching stays open; moving on waits for the quiz. Ungated categories
      // are unaffected (their completion never consults the gate).
      const gateSatisfied = bank
        ? (userId != null && quizSessionPassed(attempts, { bankId: bank.bankId, itemCount: bank.itemCount, passPercent: this.#config.quiz_pass_percent }))
        : !categoryDef.gated;
      const needsQuiz = Boolean(categoryDef.gated && !bank);
      const played = (percent ?? 0) >= this.#config.completion_threshold_percent;
      const completed = unitCompleted({ percent: percent ?? 0, gateSatisfied }, categoryDef, {
        completionThresholdPercent: this.#config.completion_threshold_percent,
      });
      return {
        unit, percent, playhead, completed, needsQuiz,
        quiz: bank ? { bankId: bank.bankId } : null,
        gateInfo: { hasQuiz: !!bank, gateSatisfied, needsQuiz, played },
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
      played: r.gateInfo.played, // watched to the completion threshold (drives the request-a-quiz affordance)
      locked: locks[i].locked,
      current: locks[i].current,
      lockReason: locks[i].lockReason,
      quiz: r.quiz,
      needsQuiz: r.needsQuiz,
    }));

    // Title/poster fall back to the (already-proxied) catalog material: the
    // plex-show source now returns them null (it fetches episodes directly and
    // no longer resolves the show's own metadata), and the catalog already
    // carries a proxied poster + title for the detail header.
    const material = {
      ...full,
      title: full.title ?? catalogMaterial.title ?? null,
      poster: full.poster ?? catalogMaterial.poster ?? null,
      category: catalogMaterial.category,
    };
    return { material, units };
  }
}

export default GetMaterialUnits;
