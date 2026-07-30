/**
 * LanguageProgramLauncher — the `IProgramLauncher` face of language study.
 *
 * Deliberately thin: `status()` is a pure pass-through to
 * `LanguageStudyService.todayStatus`, which already owns the day-queue
 * derivation; this class does not re-derive anything. `launch()` does not
 * know or care what screen the learner ends up on — that is `PortalDispatch`'s
 * job — it only knows the fixed program target to ask for.
 */
export class LanguageProgramLauncher {
  #languageStudyService; #portal; #logger;

  /**
   * @param {object} deps
   * @param {import('./LanguageStudyService.mjs').LanguageStudyService} deps.languageStudyService
   * @param {import('./PortalDispatch.mjs').PortalDispatch} deps.portal
   * @param {object} [deps.logger]
   */
  constructor({ languageStudyService, portal, logger = console }) {
    this.#languageStudyService = languageStudyService;
    this.#portal = portal;
    this.#logger = logger;
  }

  /** Stable id, matches the `IProgramReporter` for the same program. */
  get id() { return 'language'; }

  /**
   * @param {{userId: string}} args
   * @returns {Promise<{doneToday: boolean, progressLabel: string|null, score: number|null}>}
   */
  async status({ userId }) {
    return this.#languageStudyService.todayStatus({ userId });
  }

  /**
   * @param {{userId: string}} args
   * @returns {Promise<{dispatched: boolean}>}
   */
  async launch({ userId }) {
    return this.#portal.launch({
      learnerId: userId,
      target: { kind: 'program', program: 'language' },
    });
  }
}

export default LanguageProgramLauncher;
