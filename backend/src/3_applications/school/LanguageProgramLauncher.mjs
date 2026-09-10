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
import { IProgramLauncher } from './ports/IProgramLauncher.mjs';

export class SentenceLadderProgramLauncher extends IProgramLauncher {
  #languageStudyService; #donow; #logger; #studyGrants;

  /**
   * @param {object} deps
   * @param {import('./LanguageStudyService.mjs').LanguageStudyService} deps.languageStudyService
   * @param {import('../donow/DoNowService.mjs').DoNowService} deps.donow
   * @param {object} [deps.logger]
   */
  constructor({ languageStudyService, donow, studyGrants = null, logger = console }) {
    super();
    this.#languageStudyService = languageStudyService;
    this.#donow = donow;
    this.#studyGrants = studyGrants;
    this.#logger = logger;
  }

  /** Stable id, matches the `IProgramReporter` for the same program. */
  get id() { return 'sentence-ladder'; }

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
   * The surface `launch()` below dispatches to, stated structurally so a
   * caller can branch on it without parsing `locationHint`'s prose. The
   * school-room panel is the Portal, so this is the one program family that
   * really does open where the child is standing.
   */
  get surface() { return 'portal'; }

  /**
   * @param {{userId: string, programInstance?: string|null}} args
   * @returns {Promise<{doneToday: boolean, progressLabel: string|null, score: number|null}>}
   */
  async status({ userId, programInstance = null }) {
    // This launcher had no log events at all, so "the agenda said Done and the
    // child had not studied" was unanswerable after the fact: the question and
    // the answer both vanished. Debug, because an agenda build asks every
    // launcher on every render — raise the level for a week, not forever.
    const answer = await this.#languageStudyService.todayStatus({ userId, corpusId: programInstance });
    this.#logger.debug?.('school.language.launcher.status', {
      learnerId: userId,
      corpus: programInstance,
      doneToday: answer?.doneToday ?? null,
      score: answer?.score ?? null,
      progressLabel: answer?.progressLabel ?? null,
    });
    return answer;
  }

  /**
   * @param {{userId: string}} args
   * @returns {Promise<{decision: 'dispatched'|'pending_approval'|'denied'|'failed', approvalId?: string, message: string}>}
   */
  async launch({ userId, corpusId = null }) {
    let target;
    try {
      target = this.issueLaunchTarget({ userId, corpusId });
    } catch (err) {
      // A refused grant is the difference between "the Portal ignored me" and
      // "the ladder would not let me in", and only this line can tell them
      // apart afterwards.
      this.#logger.error?.('school.language.launcher.launch-failed', {
        learnerId: userId, corpus: corpusId, surface: 'portal', error: err.message,
      });
      throw err;
    }
    const result = await this.#donow.dispatch({
      surface: 'portal',
      action: { target },
      learnerId: userId,
      requestedBy: 'school-program',
      ref: 'sentence-ladder',
      programId: 'sentence-ladder',
      // A study grant is intentionally memory-only. A pending DoNow request
      // persists its action, so a grant-bearing launch must dispatch now or
      // refuse; it must never enter the approval queue.
      force: 'never_ask',
    });
    // Info: a launch is a household event, not a poll — one per child per
    // sitting. The grant flag is a yes/no; the grant itself is never logged.
    this.#logger.info?.('school.language.launcher.launch', {
      learnerId: userId,
      corpus: corpusId,
      surface: 'portal',
      decision: result?.decision ?? null,
      grantIssued: !!target?.studyGrant,
      approvalId: result?.approvalId ?? null,
    });
    return result;
  }

  issueLaunchTarget({ userId, corpusId }) {
    if (!this.#studyGrants) throw new Error('Sentence Ladder study grants are unavailable');
    if (!userId || !corpusId) throw new Error('Sentence Ladder launch requires learner and corpus');
    return {
      kind: 'program', program: 'sentence-ladder', corpusId,
      studyGrant: this.#studyGrants.issue({ learnerId: userId, corpusId }),
    };
  }
}

// Compatibility export for imports that have not yet crossed the canonical
// naming boundary. The runtime identity is still sentence-ladder.
export const LanguageProgramLauncher = SentenceLadderProgramLauncher;
export default SentenceLadderProgramLauncher;
