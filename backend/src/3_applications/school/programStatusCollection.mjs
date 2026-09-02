/**
 * Read each configured program instance exactly once for an agenda-style
 * projection. Instance identity belongs in the status key and in the launcher
 * call; the launcher id alone identifies only the adapter family.
 */
import { entryActionIsReachable } from '#domains/school/reachability.mjs';

export async function collectProgramStatuses({
  plan, learnerId, launchers = new Map(), logger = console,
  logEvent = 'school.program-status.launcher-failed',
  // Every `learner_action` the household's trigger sources declare.
  //
  // THREE STATES, NOT TWO. `undefined` (the default) means the caller did not
  // ask the reachability question at all, and nothing is checked — every
  // existing caller and test keeps its behaviour. `null` means the caller
  // asked and does not YET know the answer — in production this is a boot
  // ordering artifact (School's own completion recompute can run before
  // app.mjs finishes composing the Trigger API that is the source of this
  // set), not a broken config — so it is reported as a DEBUG breadcrumb, not
  // an unreachability claim: "I cannot tell yet" and "this is unreachable"
  // are different statements, and asserting the second when only the first is
  // true is a false alarm (2026-09-01). A Set/array is the answer itself, and
  // an ENTRY ACTION genuinely absent from it still warns and still faults —
  // see the branch below.
  declaredEntryActions = undefined,
} = {}) {
  const programs = new Map();
  (plan?.entries ?? []).filter((entry) => entry?.program).forEach((entry) => {
    const key = JSON.stringify([entry.program, entry.programInstance ?? null]);
    if (!programs.has(key)) programs.set(key, {
      key, programId: entry.program, programInstance: entry.programInstance ?? null,
    });
  });

  const statuses = [];
  await Promise.all([...programs.values()].map(async ({ programId, programInstance }) => {
    let status;
    try {
      const launcher = launchers.get(programId);
      if (!launcher) throw new Error(`no launcher registered for program "${programId}"`);
      const entryAction = launcher.entryAction;
      const needsEntryAction = typeof entryAction === 'string' && entryAction.trim() !== '';
      // REACHABILITY IS ASKED BEFORE `status()`, NOT AFTER.
      //
      // A launcher whose entry action nothing declares will answer `status()`
      // perfectly happily — story time's reads a log and reports "0 of 2 read
      // today", which is TRUE and completely useless, because no reader in the
      // house can start the thing (2026-08-26). Asking first also means a
      // misconfigured program costs no I/O.
      //
      // `error: true` is deliberately the SAME shape a launcher failure
      // produces, because `planDailyAgenda` already turns it into
      // `program_unavailable`, which is already in `FAULT_REASONS`, which
      // `resolveDayCompletion` already folds into `indeterminate`. The day is
      // then never reported complete — which is the honest state, and is what
      // stops the status board's done chip and the receipt's done-for-the-day
      // line from congratulating a child who was never able to start.
      //
      // "CANNOT TELL YET" IS NOT "UNREACHABLE" (2026-09-01). `declaredEntryActions
      // === null` means the trigger config could not be read AT THIS INSTANT, from
      // either of two sources (`PlanProjection#resolveDeclaredEntryActions`):
      //
      //   1. A BOOT-ORDERING ARTIFACT, the common case in production: School's
      //      own completion recompute can run (via an eagerly-fired
      //      `school.assignments.changed` -> SchoolCompletionBridge -> this
      //      collector) before app.mjs composes the Trigger API a few lines
      //      later, which is the thing that populates the declared set. It
      //      self-resolves within the same boot and never recurs for the rest
      //      of the process's life — verified against production logs, exactly
      //      two warns at startup, none in the following six hours, real card
      //      taps opening real sessions moments later on the same process.
      //   2. A GENUINE READ FAILURE: the declared-entry-actions thunk itself
      //      throws (malformed trigger config, etc.), caught and logged as
      //      `school.plan.entry-actions-unreadable` in `PlanProjection`, then
      //      mapped to the same `null`. That case does NOT self-resolve on its
      //      own the way boot ordering does.
      //
      // Either way, asserting `no_entry_point` here would state a program is
      // unreachable when the honest fact is "not yet checked (or not
      // currently checkable)" — the false-alarm pattern that trains everyone
      // to ignore this exact warn. A debug breadcrumb only; no error, no warn,
      // and — critically — still asks `status()` below rather than skipping
      // the program. A `school.plan.entry-actions-unreadable` warn recurring
      // past the same boot's startup window is the tell that this is case 2,
      // not case 1.
      if (needsEntryAction && declaredEntryActions === null) {
        logger.debug?.('school.program-status.entry-actions-unknown', {
          learnerId, program: programId, programInstance, entryAction,
        });
      } else if (declaredEntryActions !== undefined
        && !entryActionIsReachable({ entryAction, declaredActions: declaredEntryActions })) {
        logger.warn?.('school.program-status.no-entry-point', {
          learnerId, program: programId, programInstance, entryAction,
        });
        statuses.push({
          programId, programInstance, status: { error: true, reason: 'no_entry_point' },
        });
        return;
      }
      status = await launcher.status({ userId: learnerId, programInstance });
    } catch (err) {
      logger.warn?.(logEvent, {
        learnerId, program: programId, programInstance, error: err?.message ?? String(err),
      });
      status = { error: true };
    }
    statuses.push({ programId, programInstance, status });
  }));
  return statuses.sort((a, b) => `${a.programId}\0${a.programInstance ?? ''}`.localeCompare(`${b.programId}\0${b.programInstance ?? ''}`));
}

export default collectProgramStatuses;
