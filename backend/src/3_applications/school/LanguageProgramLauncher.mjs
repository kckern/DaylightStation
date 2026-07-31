/**
 * LanguageProgramLauncher — the `IProgramLauncher` face of language study.
 *
 * Deliberately thin: `status()` is a pure pass-through to
 * `LanguageStudyService.todayStatus`, which already owns the day-queue
 * derivation; this class does not re-derive anything. `launch()` routes
 * through `DoNowService.dispatch` (spec §6 last bullet — "program launchers
 * become DoNow callers where they dispatch surfaces"), so a mid-quiz sibling
 * on the Portal is protected by the SAME occupancy/override policy a
 * `launch:` unit or a `SurfaceProgramLauncher` gets, rather than a parallel
 * broadcast that could clobber it.
 *
 * `status()` stays evidence-owned by the ladder (`LanguageStudyService`), not
 * the DoNow dispatch log — a language dispatch's `programId` on that log row
 * is audit trail, never the source of truth for `doneToday`.
 */
export class LanguageProgramLauncher {
  #languageStudyService; #donow; #logger;

  /**
   * @param {object} deps
   * @param {import('./LanguageStudyService.mjs').LanguageStudyService} deps.languageStudyService
   * @param {import('../donow/DoNowService.mjs').DoNowService} deps.donow
   * @param {object} [deps.logger]
   */
  constructor({ languageStudyService, donow, logger = console }) {
    this.#languageStudyService = languageStudyService;
    this.#donow = donow;
    this.#logger = logger;
  }

  /** Stable id, matches the `IProgramReporter` for the same program. */
  get id() { return 'language'; }

  /**
   * The language ladder always dispatches to the `portal` surface (see
   * `launch()` below) — this is the one program whose "on the Portal"
   * wording is actually true, so it is stated here explicitly. Callers
   * (`BuildAgenda`/`ResolveScanAction`) never assume this for any OTHER
   * launcher — a launcher that declares no `locationHint` (e.g. a
   * `SurfaceProgramLauncher` with no configured hint) gets a generic,
   * location-agnostic wording instead, precisely because a garage program
   * is not on the Portal.
   */
  get locationHint() { return 'on the Portal'; }

  /**
   * @param {{userId: string}} args
   * @returns {Promise<{doneToday: boolean, progressLabel: string|null, score: number|null}>}
   */
  async status({ userId }) {
    return this.#languageStudyService.todayStatus({ userId });
  }

  /**
   * @param {{userId: string}} args
   * @returns {Promise<{decision: 'dispatched'|'pending_approval'|'denied'|'failed', approvalId?: string, message: string}>}
   */
  async launch({ userId }) {
    return this.#donow.dispatch({
      surface: 'portal',
      action: { target: { kind: 'program', program: 'language' } },
      learnerId: userId,
      requestedBy: 'school-program',
      ref: 'language',
      programId: 'language',
    });
  }
}

export default LanguageProgramLauncher;
