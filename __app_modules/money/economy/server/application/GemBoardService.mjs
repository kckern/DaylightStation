/**
 * The Gem Board read (`GET /api/v1/earnings/gems`): the week's priced preview
 * folded into a learner × gem grid, with each learner's lifetime gems from the
 * ledger. Read-only over the same evaluator the payouts use, so the board and
 * the bank cannot disagree. Design:
 * ops:docs/superpowers/specs/2026-11-04-achievement-gems-design.md.
 */
import { buildGemBoard, gemCategories, lifetimeGemsByRule } from "../domain/earnings/index.mjs";
import { isPayoutEntry, paidRefOf } from "../domain/index.mjs";

const AREAS = new Set(['move', 'school', 'games']);

export class GemBoardService {
  #preview; #rules; #economy; #config; #logger;
  #warnedGroups = new Set(); // custom gem.group slugs already reported (once per process)

  /**
   * @param {object} deps
   * @param {{roster: Function}} deps.preview - EarningsPreviewService
   * @param {{get: Function}} deps.rules - EarnRulesService
   * @param {{getHistory: Function, peekBalance: Function, hasUser?: Function}} deps.economy - EconomyService
   * @param {{catalog: () => {mode: string}}} deps.config
   */
  constructor({ preview, rules, economy, config, logger = console }) {
    if (!preview?.roster) throw new Error('GemBoardService requires preview');
    if (!rules?.get) throw new Error('GemBoardService requires rules');
    if (!economy?.getHistory || !economy?.peekBalance) throw new Error('GemBoardService requires economy');
    if (!config?.catalog) throw new Error('GemBoardService requires config');
    this.#preview = preview; this.#rules = rules; this.#economy = economy; this.#config = config; this.#logger = logger;
  }

  #isUser(id) { return typeof this.#economy.hasUser !== 'function' || this.#economy.hasUser(id); }

  async #lifetime(learnerId) {
    if (!this.#isUser(learnerId)) return { byRule: {}, total: null };
    try {
      const history = await this.#economy.getHistory(learnerId);
      const wallet = await this.#economy.peekBalance(learnerId);
      return { byRule: lifetimeGemsByRule(history, { isPayoutEntry, paidRefOf }), total: wallet?.gems ?? null };
    } catch (err) {
      this.#logger.warn?.('economy.gems.lifetime-unavailable', { learnerId, error: err?.message ?? String(err) });
      return { byRule: {}, total: null };
    }
  }

  /**
   * The board for the week holding `week` (any study day; null = this week).
   * `fresh` reads the achievement evidence now rather than the minute-shared copy.
   * `roster` is a priced week the caller already holds (`preview.roster({week, fresh})`
   * for the same week): the board folds it instead of pricing the roster again —
   * the fitness standings read both, and two rosters doubled every school read.
   */
  async board({ week = null, fresh = false, roster: priced = null } = {}) {
    const t0 = Date.now();
    const mode = this.#config.catalog().mode;
    if (mode === 'off') return { mode, week: null, learners: [], categories: [], cells: {}, totals: {} };
    const [ruleset, roster] = await Promise.all([this.#rules.get(), priced ?? this.#preview.roster({ week, fresh })]);
    const ids = (roster?.learners ?? []).map((l) => l.learnerId);
    const lifetime = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await this.#lifetime(id)])));
    for (const category of gemCategories(ruleset)) {
      if (!AREAS.has(category.group) && !this.#warnedGroups.has(category.group)) {
        this.#warnedGroups.add(category.group);
        this.#logger.warn?.('economy.gems.group-filed-under-school', { group: category.group, row: category.id, area: category.area });
      }
    }
    const board = buildGemBoard({ ruleset, week: roster, lifetime, mode });
    this.#logger.debug?.('economy.gems.board.read', {
      week: board.week, learners: board.learners.length, categories: board.categories.length, ms: Date.now() - t0,
    });
    return board;
  }
}

export default GemBoardService;
