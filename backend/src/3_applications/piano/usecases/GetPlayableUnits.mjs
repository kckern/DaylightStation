/**
 * GetPlayableUnits — a course's playable units for one kiosk user.
 *
 * Verbatim extraction of the algorithm the piano router used to inline at
 * GET /piano/courses/:courseId/playable: fetch the course's playable episodes,
 * lift the unit/season link to item top-level, per-user progress enrichment,
 * reference-unit matching (config-flagged, never-gated units), and the
 * co-progress lock (block the ahead user in a paired sequential course until the
 * gap falls below `rule.buffer`).
 *
 * Returns a discriminated result so the router keeps HTTP mapping thin:
 *   { ok: false, reason: 'invalid_user' }         → router 400
 *   { ok: true, result: { ...playable, isSequential, coProgressLock, referenceUnitIds } }
 *
 * Dependencies (fitnessPlayableService, userVideoProgressStore, configService)
 * are constructor-injected at the composition root.
 */
export class GetPlayableUnits {
  #fitnessPlayableService;
  #userVideoProgressStore;
  #configService;
  #logger;

  constructor({ fitnessPlayableService, userVideoProgressStore = null, configService, logger = console } = {}) {
    this.#fitnessPlayableService = fitnessPlayableService;
    this.#userVideoProgressStore = userVideoProgressStore;
    this.#configService = configService;
    this.#logger = logger;
  }

  // Router's knownUser() fallback (used only when no progress store is wired).
  #isKnownUser(userId) {
    return typeof userId === 'string' && userId.length > 0
      && !userId.includes('/') && !userId.includes('\\') && !userId.includes('..')
      && !!this.#configService.getUserProfile(userId);
  }

  /**
   * @param {{ courseId: string, userId?: string }} params
   */
  async execute({ courseId, userId } = {}) {
    // `guest` is the who's-playing dismiss-outcome identity (it never has tracked
    // progress). Treat it like an anonymous request: serve the course + isSequential
    // with NO per-user enrichment, rather than rejecting it — otherwise an idle
    // kiosk that fell back to Guest would 400 here and the course would render blank.
    const isGuest = userId === 'guest';

    // Validate a real userId. Prefer the store's guard if wired, else the router's
    // knownUser() — both reject unknown users with 400 (guest is exempted above).
    if (userId && !isGuest) {
      const ok = this.#userVideoProgressStore ? this.#userVideoProgressStore.isKnownUser(userId) : this.#isKnownUser(userId);
      if (!ok) return { ok: false, reason: 'invalid_user' };
    }

    const playable = await this.#fitnessPlayableService.getPlayableEpisodes(courseId);

    // Surface the unit/season link at the item top-level. The shared playable
    // service nests it under `metadata.parentId/parentIndex/parentTitle`, but the
    // frontend's unit grouping (CourseDetail.episodesOf) keys off a top-level
    // `parentId` that matches the `parents` map. Without this lift, multi-unit
    // courses (e.g. Hoffman Academy's 18 units) render zero episodes per unit.
    if (Array.isArray(playable.items)) {
      playable.items = playable.items.map((it) => {
        const md = it?.metadata || {};
        return {
          ...it,
          parentId: it.parentId ?? md.parentId ?? null,
          parentIndex: it.parentIndex ?? md.parentIndex ?? null,
          parentTitle: it.parentTitle ?? md.parentTitle ?? null,
          // The episode number (E12 badge) and intra-unit sort key live under
          // metadata too; lift so the grid can label + order lectures correctly.
          itemIndex: it.itemIndex ?? md.itemIndex ?? null,
          // Curriculum metadata (course grouping, styles, skill, instructor, and
          // the season category block) is merged onto metadata.piano by the Plex
          // adapter; lift it top-level so the curriculum UX reads item.piano.*
          // consistently with the /list contract.
          piano: it.piano ?? md.piano ?? null,
        };
      });
    }

    // Per-user progress enrichment (userPercent/userWatched/etc.) via the shared
    // store — known users only; guest/anonymous get the course with no progress.
    if (userId && !isGuest && this.#userVideoProgressStore) {
      playable.items = this.#userVideoProgressStore.enrich(playable.items, userId);
    }

    const pianoConfig = this.#configService.getHouseholdAppConfig(null, 'piano') || {};
    const compoundId = playable.compoundId || `plex:${courseId}`;
    const sequentialLabels = new Set(
      (pianoConfig.videos?.sequential_labels || []).map((l) => l.toLowerCase())
    );
    const isSequential = Array.isArray(playable.info?.labels) &&
      playable.info.labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));

    // Reference units: config-flagged units (by title pattern or explicit id) that
    // are never gated, give no progression credit, and render in the always-open
    // Practice & Reference zone. Matched per course against unit (season) titles.
    const referenceUnitIds = new Set();
    const refRule = (pianoConfig.videos?.reference_units || []).find((r) => r.courseId === compoundId);
    if (refRule) {
      const patterns = (refRule.titlePatterns || []).map((p) => String(p).toLowerCase()).filter(Boolean);
      const explicit = new Set((refRule.unitIds || []).map(String));
      for (const [pid, parent] of Object.entries(playable.parents || {})) {
        const title = String(parent?.title || '').toLowerCase();
        if (explicit.has(String(pid)) || patterns.some((pat) => title.includes(pat))) {
          referenceUnitIds.add(String(pid));
        }
      }
    }
    if (Array.isArray(playable.items)) {
      playable.items = playable.items.map((it) => ({
        ...it,
        isReference: referenceUnitIds.has(String(it.parentId)),
      }));
    }

    // Co-progress lock: in sequential courses with a configured user pair, block the
    // ahead user from the next episode until the gap falls below the buffer. Reference
    // episodes give no credit, so they're excluded from both users' counts.
    let coProgressLock = null;
    if (isSequential && userId && !isGuest && this.#userVideoProgressStore) {
      const rules = pianoConfig.videos?.co_progress || [];
      const rule = rules.find(
        (r) => r.courseId === compoundId &&
               Array.isArray(r.users) &&
               r.users.includes(userId),
      );
      if (rule) {
        const isCredit = (it) => it.userWatched && !referenceUnitIds.has(String(it.parentId));
        const myCount = (playable.items || []).filter(isCredit).length;
        const partnerIds = rule.users.filter((u) => u !== userId);
        const partnerCounts = partnerIds.map((pid) => {
          if (!this.#userVideoProgressStore.isKnownUser(pid)) return 0;
          const enriched = this.#userVideoProgressStore.enrich(playable.items || [], pid);
          return enriched.filter(isCredit).length;
        });
        if (partnerCounts.length) {
          const minPartnerCount = Math.min(...partnerCounts);
          const aheadBy = myCount - minPartnerCount;
          if (aheadBy >= rule.buffer) {
            const slowestIndex = partnerCounts.indexOf(minPartnerCount);
            coProgressLock = {
              locked: true,
              aheadBy,
              waitingForId: partnerIds[slowestIndex],
              buffer: rule.buffer,
            };
          }
        }
      }
    }

    this.#logger.info?.('piano.courses.playable', { courseId, userId: userId || null, isSequential });
    return { ok: true, result: { ...playable, isSequential, coProgressLock, referenceUnitIds: [...referenceUnitIds] } };
  }
}

export default GetPlayableUnits;
