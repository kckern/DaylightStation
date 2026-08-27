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
  // asked and the configuration could not be READ, which reports every
  // tap-entered program unreachable rather than passing them all silently. A
  // Set/array is the answer itself.
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
      if (declaredEntryActions !== undefined
        && !entryActionIsReachable({
          entryAction: launcher.entryAction, declaredActions: declaredEntryActions,
        })) {
        logger.warn?.('school.program-status.no-entry-point', {
          learnerId, program: programId, programInstance, entryAction: launcher.entryAction,
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
