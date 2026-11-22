/**
 * Drafts the bullets on each child's weekly school showcase slide.
 *
 * The domain (schoolShowcasePolicy) builds every showcase with plain bullets.
 * This asks the AI gateway for warmer wording, one child at a time and in
 * parallel, and keeps the plain bullets whenever the answer is missing,
 * malformed or breaks the house rules (praise words, exclamation marks,
 * scores, grades, percentages). Accepted bullets are cached per week and
 * child, keyed by the week's itemsHash, so a replay does not pay again and a
 * changed week is drafted afresh.
 */

export const SHOWCASE_SYSTEM_PROMPT = 'You write short captions for a family\'s weekly review on a TV that young children watch. '
  + 'Given one child\'s school work this week as JSON facts, return ONLY a JSON array of 2 to 5 short bullet strings '
  + '(max 90 characters each). Use only the facts given. Be concrete and warm but plain: no praise words like '
  + 'great/amazing/awesome, no exclamation marks, no scores, no grades, no comparisons, never mention anything '
  + 'missing or not done. Write in the third person without the child\'s name (the slide title already names them).';

const BANNED = /\b(great|amazing|awesome|perfect|score|grade|percent)\b|!|%/i;
const MAX_BULLETS = 5;
const MAX_BULLET_CHARS = 120;

/**
 * Strictly read the model's answer: a JSON array (optionally in a ```json
 * fence) of 1 to 5 non-empty strings of at most 120 characters, none banned.
 * @returns {string[]|null}
 */
export function parseShowcaseBullets(answer) {
  if (typeof answer !== 'string') return null;
  const body = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_BULLETS) return null;
  const bullets = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') return null;
    const bullet = entry.trim();
    if (!bullet || bullet.length > MAX_BULLET_CHARS || BANNED.test(bullet)) return null;
    bullets.push(bullet);
  }
  return bullets;
}

export class SchoolShowcaseService {
  #ai;
  #store;
  #logger;
  #clock;

  /**
   * @param {object} deps
   * @param {{ chat(messages: object[], opts: object): Promise<string> }|null} [deps.ai]
   * @param {{ load(week: string): any, save(week: string, data: object): any }} deps.store
   * @param {object} [deps.logger]
   * @param {() => Date} [deps.clock]
   */
  constructor({ ai = null, store, logger = null, clock = () => new Date() } = {}) {
    if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') {
      throw new Error('SchoolShowcaseService requires a store with load and save');
    }
    this.#ai = ai && typeof ai.chat === 'function' ? ai : null;
    this.#store = store;
    this.#logger = logger;
    this.#clock = clock;
  }

  /**
   * @param {string} week YYYY-MM-DD window start
   * @param {object[]} showcases from buildShowcases (plain bullets, items, itemsHash)
   * @returns {Promise<object[]>} the showcases with `bullets` and `source` settled
   */
  async execute(week, showcases) {
    const list = Array.isArray(showcases) ? showcases : [];
    if (list.length === 0) return [];
    const cache = await this.#loadCache(week);
    const fresh = {};

    const results = await Promise.all(list.map(async (showcase) => {
      const started = this.#clock().getTime();
      const { learnerId } = showcase;
      const cached = cache[learnerId];
      let outcome;
      if (cached && cached.itemsHash === showcase.itemsHash && Array.isArray(cached.bullets) && cached.bullets.length > 0) {
        outcome = { bullets: cached.bullets, source: 'ai', cachedHit: true };
      } else {
        const bullets = await this.#draft(showcase);
        if (bullets) {
          fresh[learnerId] = { itemsHash: showcase.itemsHash, bullets, at: this.#clock().toISOString() };
          outcome = { bullets, source: 'ai', cachedHit: false };
        } else {
          outcome = { bullets: showcase.bullets, source: 'plain', cachedHit: false };
        }
      }
      this.#logger?.info?.('weekly-review.showcase.generated', {
        week,
        learnerId,
        items: Array.isArray(showcase.items) ? showcase.items.length : 0,
        ms: this.#clock().getTime() - started,
        cached: outcome.cachedHit,
        source: outcome.source,
      });
      return { ...showcase, bullets: outcome.bullets, source: outcome.source };
    }));

    if (Object.keys(fresh).length > 0) {
      try {
        await this.#store.save(week, { ...cache, ...fresh });
      } catch (err) {
        this.#logger?.warn?.('weekly-review.showcase.cache-save-failed', { week, error: err.message });
      }
    }
    return results;
  }

  async #loadCache(week) {
    try {
      const data = await this.#store.load(week);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (err) {
      this.#logger?.warn?.('weekly-review.showcase.cache-load-failed', { week, error: err.message });
      return {};
    }
  }

  /** AI bullets for one child, or null to keep the plain ones. */
  async #draft(showcase) {
    if (!this.#ai) return null;
    try {
      const answer = await this.#ai.chat(
        [
          { role: 'system', content: SHOWCASE_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify({ name: showcase.learnerName, work: showcase.items || [] }) },
        ],
        { temperature: 0.3, maxTokens: 400 },
      );
      const bullets = parseShowcaseBullets(answer);
      if (!bullets) {
        this.#logger?.warn?.('weekly-review.showcase.ai-rejected', { learnerId: showcase.learnerId });
      }
      return bullets;
    } catch (err) {
      this.#logger?.warn?.('weekly-review.showcase.ai-failed', { learnerId: showcase.learnerId, error: err.message });
      return null;
    }
  }
}

export default SchoolShowcaseService;
