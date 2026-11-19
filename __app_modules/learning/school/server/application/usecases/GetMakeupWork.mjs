/**
 * GetMakeupWork — what a learner still owes from earlier this week and can
 * still make up (`domain/makeup.mjs`).
 *
 * READ, NEVER STORED. It asks the term verdicts (which already lay makeup
 * credit over the week) for the days still marked `makeupOpen`, and lists each
 * section on them still `obligated` in a subject the policy covers. A section
 * made up since is `served` on that read and simply drops off, so a makeup
 * sheet or agenda card built from this never asks for work already done.
 *
 * Never throws: makeup is an addition to the morning paper, and a verdict read
 * that fails costs the makeup line, never the agenda.
 */
import { DEFAULT_MAKEUP_POLICY, makeupDeadline } from "../../domain/makeup.mjs";

const EMPTY = Object.freeze({ deadline: null, items: Object.freeze([]) });

export class GetMakeupWork {
  #termVerdicts; #policy; #logger;

  /**
   * @param {object} deps
   * @param {{read: Function}|(() => {read: Function}|null)} deps.termVerdicts
   *   the TermVerdictService, or a getter for one (composition builds it later)
   * @param {object|(() => object)} [deps.makeupPolicy] `readMakeupPolicy(...).policy`, or a getter
   * @param {object} [deps.logger]
   */
  constructor({ termVerdicts, makeupPolicy = DEFAULT_MAKEUP_POLICY, logger = console } = {}) {
    this.#termVerdicts = typeof termVerdicts === 'function' ? termVerdicts : () => termVerdicts;
    this.#policy = typeof makeupPolicy === 'function' ? makeupPolicy : () => makeupPolicy;
    this.#logger = logger;
  }

  /**
   * @param {{learnerId: string}} args
   * @returns {Promise<{deadline: string|null, items: Array<{day: string, subject: string}>}>}
   *   oldest day first; `deadline` is the last study day the work counts on
   */
  async execute({ learnerId } = {}) {
    const policy = this.#policy() ?? DEFAULT_MAKEUP_POLICY;
    if (!policy.enabled || typeof learnerId !== 'string' || !learnerId.trim()) return EMPTY;
    const verdicts = this.#termVerdicts();
    if (typeof verdicts?.read !== 'function') return EMPTY;
    let term;
    try {
      term = await verdicts.read(learnerId, { detail: true });
    } catch (error) {
      this.#logger.warn?.('school.makeup.read-failed', { learnerId, error: error?.message ?? String(error) });
      return EMPTY;
    }
    const allowed = (subject) => !policy.subjects || policy.subjects.includes(subject);
    const days = (Array.isArray(term?.days) ? term.days : [])
      .filter((row) => row?.makeupOpen === true && typeof row.studyDay === 'string')
      .sort((a, b) => a.studyDay.localeCompare(b.studyDay));
    const items = days.flatMap((row) => (Array.isArray(row.sections) ? row.sections : [])
      .filter((section) => section?.state === 'obligated'
        && typeof section.subject === 'string' && section.subject && allowed(section.subject))
      .map((section) => ({ day: row.studyDay, subject: section.subject })));
    if (!items.length) return EMPTY;
    // Every open day shares its week's deadline; the earliest is the honest one
    // should a policy ever let two weeks overlap.
    const deadline = items.map((item) => makeupDeadline(item.day, policy)).sort()[0];
    return { deadline, items };
  }
}

export default GetMakeupWork;
