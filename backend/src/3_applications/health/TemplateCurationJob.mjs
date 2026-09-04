/**
 * TemplateCurationJob — the weekly pass that turns repeated meals into
 * proposals a person can approve (PRD F6.2).
 *
 * It reads, mines, and writes proposals. It never creates a template: a
 * proposal sits in the picker with Approve / Dismiss on it, and a dismissal is
 * remembered forever.
 *
 * SAFE TO RE-RUN. Every proposal is keyed by its core set, and
 * `TemplateService.saveProposals` skips a key already held by a template, a
 * live proposal, or the dismissal ledger. Running it twice in one day is a
 * no-op — unlike `backfill`, which increments a counter per row per run
 * (decision 2.29). Proved by a test that runs it twice and diffs the store.
 */

import { mineTemplates, MINER_WINDOW_DAYS } from '#domains/nutrition/services/TemplateMiner.mjs';

/** Local (not UTC) YYYY-MM-DD — the UTC form reads as tomorrow every evening here. */
function localDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDays(iso, days) {
  const at = new Date(`${iso}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export class TemplateCurationJob {
  #templateService; #nutriListStore; #clock; #windowDays; #logger;

  constructor({ templateService, nutriListStore, clock, windowDays = MINER_WINDOW_DAYS, logger }) {
    if (!templateService || !nutriListStore || !clock?.now) {
      throw new Error('TemplateCurationJob requires templateService, nutriListStore, clock');
    }
    this.#templateService = templateService;
    this.#nutriListStore = nutriListStore;
    this.#clock = clock;
    this.#windowDays = windowDays;
    this.#logger = logger || console;
  }

  /**
   * @param {string} userId
   * @returns {Promise<{ created, skipped, proposals, from, to }>}
   */
  async run(userId) {
    const today = localDateISO(new Date(this.#clock.now()));
    const from = shiftDays(today, -this.#windowDays);
    const rows = await this.#nutriListStore.findByDateRange(userId, from, today);

    // Proposals count as existing: a combo already waiting for a decision must
    // not be proposed a second time on next week's run.
    const templates = await this.#templateService.list(userId, { includeProposed: true });
    const proposals = mineTemplates({
      rows,
      today,
      windowDays: this.#windowDays,
      existingTemplateNames: templates.map((t) => t.name),
      existingKeys: templates.map((t) => t.proposalKey).filter(Boolean),
      dismissedKeys: await this.#templateService.listDismissedKeys(userId),
    });

    const result = await this.#templateService.saveProposals(proposals, userId);
    this.#logger.info?.('health.templates.curation', {
      userId, from, to: today, mined: proposals.length, created: result.created, skipped: result.skipped,
    });
    return { ...result, proposals: proposals.length, from, to: today };
  }
}
export default TemplateCurationJob;
