/**
 * GetMaterialUnits — a material's unit list with per-user progress, quiz
 * gate and lock state folded in (spec §5, §6). Resolution of `materialId` is
 * delegated entirely to the injected `catalog.findMaterial` (GetMaterialCatalog)
 * so this use-case never re-implements the source/root walk or its cache.
 *
 * Flow per unit: read raw playhead/percent via `progressStore.enrich` (dumb
 * store read only — School must never consume its `userWatched`/
 * `userEngaged`/`userCompletedAt`, which are Piano completion policy, spec §6);
 * look up the unit's gating banks via `bankIndex.byUnit` (chapter banks roll
 * up to their parent unit through the fetch's `trackParents` map); if any
 * exist, fold the user's attempt log through `quizSessionPassed` PER BANK —
 * every one must pass — to derive `gateSatisfied` (a guest, i.e. no `userId`,
 * never satisfies a gate — nothing to attribute a pass to);
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
 * Backlinks come in two grains (Blocker 2):
 * - WORK level — `bank.unit` IS a listed unit id. Binds directly, as always.
 * - TRACK level — `bank.unit` is a CHAPTER of a listed unit (the Shakespeare
 *   shape: units are plays, banks backlink the plays' tracks). `trackParents`
 *   (Map<trackId, unitId>, supplied by the material fetch, which already sees
 *   the tracks) rolls every chapter bank up to its parent unit, in TRACK order
 *   — ALL of them must pass for the unit's gate (fold lives in execute()).
 *
 * `byUnit` keeps the legacy `{bankId, itemCount}` face (first bank) so
 * existing consumers read it unchanged, plus the ordered `banks` roll-up.
 *
 * @param {Array<{id:string, unit?:string, itemCount:number}>} banks
 * @param {{trackParents?: Map<string,string>|null}} [options]
 * @returns {{byUnit: function(string): ({banks:Array<{bankId:string,itemCount:number}>, bankId:string, itemCount:number}|null)}}
 */
export function buildBankIndex(banks, { trackParents = null } = {}) {
  const direct = new Map(); // unitId -> [{bankId, itemCount}...] (backlink IS the unit id)
  const byTrack = new Map(); // trackId -> [{bankId, itemCount}...]
  for (const bank of banks || []) {
    if (!bank.unit) continue;
    const entry = { bankId: bank.id, itemCount: bank.itemCount };
    const bucket = trackParents?.has(bank.unit) ? byTrack : direct;
    if (!bucket.has(bank.unit)) bucket.set(bank.unit, []);
    bucket.get(bank.unit).push(entry);
  }
  // Chapter banks in TRACK order (the map's insertion order is the material's
  // own track order), not the arbitrary order the bank scan returned them in.
  const rolled = new Map(); // unitId -> [{bankId, itemCount}...]
  if (trackParents) {
    for (const [trackId, unitId] of trackParents) {
      const entries = byTrack.get(trackId);
      if (!entries) continue;
      if (!rolled.has(unitId)) rolled.set(unitId, []);
      rolled.get(unitId).push(...entries);
    }
  }
  return {
    byUnit: (unitId) => {
      const list = [...(direct.get(unitId) ?? []), ...(rolled.get(unitId) ?? [])];
      if (list.length === 0) return null;
      return { banks: list, bankId: list[0].bankId, itemCount: list[0].itemCount };
    },
  };
}

// Fetching a material's remote units (episodes/chapters) occasionally stalls
// on a specific item — a single show could hang the request for 70s+, leaving
// the detail's chapter tiles stuck on their loading skeletons forever. Bound
// each fetch so a stall fails fast (the detail then shows a retry, not an
// endless skeleton); cache the expensive result so a load, once it succeeds, is
// instant for everyone; coalesce concurrent fetches so the frontend's retries
// don't stampede the stall.
const MATERIAL_TIMEOUT_MS = 20_000;
const MATERIAL_TTL_MS = 3_600_000; // units rarely change; progress is folded fresh each call
// Past the TTL a cached material is STALE, not gone: it is served immediately
// while a background refresh replaces it (stale-while-revalidate), so nobody
// waits out the provider's serialized fan-out at the TTL boundary or after a
// redeploy (the disk snapshot re-seeds the cache at boot). The bound exists
// for a provider that stays down: a material older than this blocks on a real
// fetch rather than serving arbitrarily old units forever.
const MATERIAL_MAX_STALE_MS = 86_400_000; // 24h

export class GetMaterialUnits {
  #catalog;
  #sources;
  #config;
  #progressStore;
  #bankIndex;
  #attemptsReader;
  #logger;
  #materialTimeoutMs;
  #scheduler;
  #snapshot;
  #materialCache = new Map(); // materialId -> { full, at }
  #materialInflight = new Map(); // materialId -> Promise

  constructor({ catalog, sources, config, progressStore, bankIndex, attemptsReader, scheduler = null, logger = console, materialTimeoutMs = MATERIAL_TIMEOUT_MS, snapshot = null }) {
    this.#catalog = catalog;
    this.#sources = sources;
    this.#config = config;
    this.#progressStore = progressStore;
    this.#bankIndex = bankIndex;
    this.#attemptsReader = attemptsReader;
    this.#logger = logger;
    this.#materialTimeoutMs = materialTimeoutMs;
    this.#scheduler = scheduler;
    this.#snapshot = snapshot;
    if (snapshot) {
      // Seed the in-memory cache from the last runtime's snapshot so a
      // redeploy starts warm. Best-effort: a failed seed just means a cold
      // start, exactly what we had before snapshots existed.
      try {
        for (const [materialId, entry] of snapshot.load()) this.#materialCache.set(materialId, entry);
        this.#logger.info?.('school.material.snapshot-seeded', { count: this.#materialCache.size });
      } catch (err) {
        this.#logger.warn?.('school.material.snapshot-seed-failed', { error: err?.message });
      }
    }
  }

  #withTimeout(promise, ms, materialId) {
    return this.#scheduler?.withDeadline
      ? this.#scheduler.withDeadline(promise, { milliseconds: ms, description: `getMaterial("${materialId}")` })
      : promise;
  }

  // The expensive part: pull the material + its raw units from the source.
  // Cached per material, deduped while in flight, and bounded so a provider
  // stall rejects instead of hanging. Progress/lock state is NOT cached here —
  // it is folded fresh from the store on every execute() call.
  async #fetchFull(adapter, materialId) {
    const cached = this.#materialCache.get(materialId);
    const age = cached ? Date.now() - cached.at : Infinity;
    if (cached && age < MATERIAL_TTL_MS) return cached.full;

    // One real fetch per material, shared by all concurrent callers. It caches
    // on completion INDEPENDENT of any caller's timeout — so even a very slow
    // provider response still warms the cache, and the user's next "Try again" then
    // loads instantly rather than racing the same stall forever.
    let real = this.#materialInflight.get(materialId);
    if (!real) {
      real = adapter.getMaterial(materialId)
        .then((full) => {
          const at = Date.now();
          this.#materialCache.set(materialId, { full, at });
          this.#snapshot?.put(materialId, full, at); // never throws — see the store
          return full;
        })
        .finally(() => this.#materialInflight.delete(materialId));
      this.#materialInflight.set(materialId, real);
    }
    // Stale-while-revalidate: a past-TTL (but bounded) entry is served NOW and
    // the refresh above lands in the background — the caller never waits on
    // the provider for a material we already know.
    if (cached && age < MATERIAL_MAX_STALE_MS) {
      real.catch((err) => this.#logger.warn?.('school.material.refresh-failed', { materialId, error: err?.message }));
      return cached.full;
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

    // The material fetch's track→parent map (Map<trackContentId, unitContentId>,
    // built from children the fetch already walks — no extra provider calls).
    // Threaded into the bank lookup so CHAPTER banks roll up to the unit they
    // gate; absent (null) for materials whose units are already leaves.
    const trackParents = full.trackParents ?? null;

    const rows = ordered.map((unit, i) => {
      const gate = this.#bankIndex.byUnit(unit.id, { trackParents });
      // Defensive: an injected index may still answer in the legacy
      // single-bank shape; treat it as a one-bank roll-up.
      const gateBanks = gate ? (Array.isArray(gate.banks) && gate.banks.length ? gate.banks : [{ bankId: gate.bankId, itemCount: gate.itemCount }]) : [];
      const percent = enriched[i]?.userPercent ?? null;
      const playhead = enriched[i]?.userPlayhead ?? null;
      // A gated (course) unit with NO bank does not auto-satisfy its gate:
      // the gate exists in principle, the quiz just hasn't been authored yet
      // (quizzes are made on demand — see the request-a-quiz affordance).
      // Watching stays open; moving on waits for the quiz. Ungated categories
      // are unaffected (their completion never consults the gate).
      //
      // With a roll-up, ALL of the unit's chapter banks must pass (user
      // decision 2026-08-06); the quiz affordance always launches the NEXT
      // UNPASSED chapter (or the first again, once every one has passed).
      const passPercent = this.#config.quiz_pass_percent;
      const passedFlags = gateBanks.map((b) => userId != null
        && quizSessionPassed(attempts, { bankId: b.bankId, itemCount: b.itemCount, passPercent }));
      const gateSatisfied = gate
        ? passedFlags.length > 0 && passedFlags.every(Boolean)
        : !categoryDef.gated;
      const nextBank = gateBanks.find((b, j) => !passedFlags[j]) ?? gateBanks[0] ?? null;
      const needsQuiz = Boolean(categoryDef.gated && !gate);
      const played = (percent ?? 0) >= this.#config.completion_threshold_percent;
      const completed = unitCompleted({ percent: percent ?? 0, gateSatisfied }, categoryDef, {
        completionThresholdPercent: this.#config.completion_threshold_percent,
      });
      return {
        unit, percent, playhead, completed, needsQuiz,
        quiz: nextBank ? {
          bankId: nextBank.bankId,
          // The gate's own bar, told to the child (advocacy M7 fix): the
          // SAME threshold quizSessionPassed applies above — the runner's
          // pass line and retake ask key off it.
          passingPercent: passPercent ?? 80,
          banksTotal: gateBanks.length,
          banksPassed: passedFlags.filter(Boolean).length,
        } : null,
        gateInfo: { hasQuiz: !!gate, gateSatisfied, needsQuiz, played },
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
    // A series source may return them null when it fetches episodes directly;
    // the catalog already
    // carries a proxied poster + title for the detail header.
    // trackParents is fetch-internal plumbing (a Map, useless over JSON) —
    // it never rides the API payload.
    const { trackParents: _tp, ...fullRest } = full;
    const material = {
      ...fullRest,
      title: full.title ?? catalogMaterial.title ?? null,
      poster: full.poster ?? catalogMaterial.poster ?? null,
      category: catalogMaterial.category,
    };
    return { material, units };
  }
}

export default GetMaterialUnits;
