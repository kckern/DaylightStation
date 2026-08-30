/**
 * The interface every School program plugs into so the daily agenda can offer
 * "go do this" without knowing what any individual program does or where it
 * lives.
 *
 * A launcher answers two questions for one learner: is today's work for this
 * program already done, and — if not — how do we hand the learner off to it?
 * `status` is read-only and safe to call speculatively (agenda compilation,
 * dashboards); `launch` has a side effect (it dispatches the learner
 * somewhere) and should only be called on an actual "go" action.
 *
 * The status shape is intentionally the same shape `planDailyAgenda` already
 * consumes as `programStatuses` — `{ doneToday, progressLabel, score,
 * obligationProgress? }` — so a
 * launcher's `status()` can be wired straight into agenda compilation without
 * an adapter in between. `score` is a percentage from 0–100 when the program
 * can produce one, and `null` when it cannot (a language ladder does not grade;
 * a question bank does).
 *
 * @interface IProgramLauncher
 */
export class IProgramLauncher {
  /** Stable id, e.g. 'language'. Matches the id an `IProgramReporter` for the
   * same program would use, so the two can be keyed together. */
  get id() {
    throw new Error('IProgramLauncher.id must be implemented');
  }

  /**
   * OPTIONAL. The wording a child reads for "where this program sends me" —
   * e.g. `'on the Portal'` (`LanguageProgramLauncher`, always true) or
   * `'in the garage'` (a `SurfaceProgramLauncher` configured for
   * `garage-fitness`). `BuildAgenda`/`ResolveScanAction` compose it into the
   * offer label and the dispatch slip; a launcher that returns `undefined`/
   * `null` (the base class default) gets a generic, location-agnostic
   * wording from those callers instead of a guessed — or worse, wrong —
   * location. Never assume `'on the Portal'` for a launcher that has not
   * said so itself.
   * @returns {string|null|undefined}
   */
  get locationHint() {
    return null;
  }

  /**
   * OPTIONAL. The DoNow surface id this program dispatches to — `'portal'`
   * for a Portal-hosted program, `'garage-fitness'` for one that sends a
   * child out of the room, `null` when the launcher does not say.
   *
   * STRUCTURAL, NOT WORDING. `locationHint` above is display copy and must
   * never be routed on; this is the field a caller may branch on. The
   * self-service panel (`RunSelfServiceAction`) is the caller that needs it:
   * the school-room panel IS the Portal, so a `'portal'` program genuinely
   * opens in place and can be mounted client-side, while any other surface
   * must go through `launch()` — telling a child "opening it here on the
   * screen" for a garage program is a dead end wearing the words of a
   * success. `null` degrades to `launch()`, which is always truthful.
   * @returns {string|null|undefined}
   */
  /**
   * OPTIONAL. The `learner_action` a trigger source must declare for a child
   * to be able to START this program by tapping their card — `'reading-session'`
   * for story time. `null` (the default) means the program is not entered by a
   * tap at all: a Portal course opened from the panel, a worksheet that arrives
   * on paper. Those have no reader to configure and reachability is not a
   * question that applies to them.
   *
   * THE LAUNCHER DECLARES THIS BECAUSE THE LAUNCHER IS WHAT KNOWS IT. Holding
   * the program→action mapping anywhere else would make it a second, separately
   * maintained copy of "how is this program started", free to drift from the
   * code that actually starts it.
   *
   * `collectProgramStatuses` reads it to answer a question nothing used to ask:
   * on 2026-08-26 two children were assigned a daily reading obligation that no
   * reader in the house was configured to let them begin, and every layer
   * behaved exactly as written while they stood there tapping.
   * @returns {string|null|undefined}
   */
  get entryAction() {
    return null;
  }

  get surface() {
    return null;
  }

  /**
   * Today's status for one learner. Must not throw: agenda compilation calls
   * every launcher, and one failing program must not blank the agenda for the
   * rest.
   *
   * `programInstance` identifies one configured instance (for example a
   * language corpus); launchers with no instance-specific state may ignore it.
   *
   * @param {{userId: string, programInstance?: string|null}} args
   * @returns {Promise<{doneToday: boolean, progressLabel: string|null, score: number|null,
   *   obligationProgress?: {completed: number, total: number}|null, servedWork?: object[]}>}
   */
  // eslint-disable-next-line no-unused-vars
  status({ userId, programInstance = null }) {
    throw new Error('IProgramLauncher.status must be implemented');
  }

  /**
   * Hand the learner off to the program — dispatch it to wherever this
   * learner studies (a portal target, a kiosk screen, a bank session).
   *
   * Routes through `DoNowService.dispatch` (spec §6 last bullet — "program
   * launchers become DoNow callers where they dispatch surfaces"), so the
   * return value is DoNow's own contract result, not a bare boolean: the
   * caller (`ResolveScanAction`) must branch on `decision` to slip the right
   * wording for a busy surface exactly as a `launch:` unit's one-shot
   * dispatch does.
   *
   * @param {{userId: string}} args
   * @returns {Promise<{decision: 'dispatched'|'pending_approval'|'denied'|'failed',
   *                     approvalId?: string, message: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  launch({ userId }) {
    throw new Error('IProgramLauncher.launch must be implemented');
  }
}

export function isProgramLauncher(obj) {
  return Boolean(obj)
    && typeof obj.status === 'function'
    && typeof obj.launch === 'function'
    && typeof obj.id === 'string';
}

export default IProgramLauncher;
