/**
 * IssueDirectLaunch — open a program from a URL, with no access code.
 *
 * ## Why this exists
 *
 * Every on-screen program normally starts the same way: a child types a
 * six-digit code on the Portal keypad, `ResolveAccessCode` turns it into a
 * launch card, and running an action mints a grant. That is the right door for
 * a child at the panel, and it is the wrong one for a grown-up testing or
 * administering from a laptop — the panel is a kiosk with no address bar, so a
 * URL is a door only the grown-up can reach.
 *
 * ## What it does and does not weaken
 *
 * It removes the CODE, not the household. Everything under `/api/v1` already
 * passes `permissionGate`, so the caller is an authenticated household browser
 * before this is reached; the access code was a second, narrower factor on top.
 * What is genuinely given up: an authenticated browser can now open any
 * learner's queue as that learner. That is the point — it is an admin door —
 * and it is why every issue is logged at `warn` with the learner named.
 *
 * ## How
 *
 * It does NOT call `launcher.launch()`. That dispatches the work to the Portal
 * through DoNow, which is the opposite of what a person opening a URL wants:
 * the work would appear on the tablet instead of in front of them. It calls
 * `issueLaunchTarget()` — the seam every on-screen launcher already exposes for
 * exactly this "mint the target, do not dispatch it" purpose — so each program
 * keeps minting its own grant, in its own way, and this use case never learns
 * what a study grant or a book grant is.
 *
 * @module applications/school/usecases/IssueDirectLaunch
 */
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

const ID_RE = /^[a-z0-9][a-z0-9_\-.:/]*$/i;

export class IssueDirectLaunch {
  #launchers; #roster; #logger;

  /**
   * @param {object} deps
   * @param {Map<string, object>|(() => Map<string, object>)} deps.launchers
   *   the program-launcher registry, or a function returning it
   * @param {(() => Array<object>)} [deps.roster] household roster, read at call
   *   time, used only to refuse an unknown learner id early with a clear message
   * @param {object} [deps.logger]
   */
  constructor({ launchers, roster = null, logger = console } = {}) {
    if (!launchers) throw new Error('IssueDirectLaunch requires launchers');
    this.#launchers = typeof launchers === 'function' ? launchers : () => launchers;
    this.#roster = typeof roster === 'function' ? roster : null;
    this.#logger = logger;
  }

  /** Program ids that can be opened this way, for a caller building a menu. */
  available() {
    const registry = this.#launchers();
    return [...registry.entries()]
      .filter(([, launcher]) => typeof launcher?.issueLaunchTarget === 'function')
      .map(([id, launcher]) => ({
        programId: id,
        surface: launcher.surface ?? null,
        // Whether the program needs an instance naming WHICH corpus/deck/reel.
        // Reported rather than guessed at, so a caller can say so in a URL.
        instanceRequired: !['book-log', 'story-time', 'rubiks-cube'].includes(id),
      }));
  }

  /**
   * @param {object} args
   * @param {string} args.learnerId
   * @param {string} args.programId
   * @param {string|null} [args.instance] corpus / deck / reel id, where the
   *   program has more than one
   * @param {string|null} [args.unitId]
   * @returns {Promise<{target: object}>}
   */
  async execute({ learnerId, programId, instance = null, unitId = null } = {}) {
    if (!learnerId || !ID_RE.test(String(learnerId))) {
      throw new ValidationError('a learner id is required', { field: 'learnerId' });
    }
    if (!programId || !ID_RE.test(String(programId))) {
      throw new ValidationError('a program id is required', { field: 'programId' });
    }
    if (instance !== null && instance !== undefined && !ID_RE.test(String(instance))) {
      throw new ValidationError('malformed program instance', { field: 'instance' });
    }

    if (this.#roster) {
      let known = null;
      try {
        known = (this.#roster() ?? []).some((person) => person?.id === learnerId);
      } catch (error) {
        // An unreadable roster must not block an admin door; the launcher will
        // still refuse a learner it cannot serve.
        this.#logger.warn?.('school.direct-launch.roster-unreadable', { error: error.message });
      }
      if (known === false) throw new EntityNotFoundError('learner', learnerId);
    }

    const launcher = this.#launchers().get(programId) ?? null;
    if (!launcher) throw new EntityNotFoundError('program', programId);
    if (typeof launcher.issueLaunchTarget !== 'function') {
      throw new ValidationError(
        `${programId} cannot be opened directly — it has no on-screen launch target`,
        { field: 'programId', value: programId },
      );
    }

    // Launchers disagree on the instance parameter's name: the sentence ladder
    // calls it `corpusId`, the rest `programInstance`. Both are passed rather
    // than renaming a published seam, and the extra key is ignored by whichever
    // launcher does not want it.
    const target = await launcher.issueLaunchTarget({
      userId: learnerId,
      programInstance: instance,
      corpusId: instance,
      unitId,
    });
    if (!target) throw new EntityNotFoundError('program instance', `${programId}#${instance ?? '-'}`);

    // Loud on purpose. This is the one path that opens a learner's queue with
    // no access code, so every use is legible afterwards.
    this.#logger.warn?.('school.direct-launch.issued', {
      learnerId, programId, instance: instance ?? null, kind: target.kind ?? null,
    });

    return { target };
  }
}

export default IssueDirectLaunch;
