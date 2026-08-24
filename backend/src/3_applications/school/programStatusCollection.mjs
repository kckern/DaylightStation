/**
 * Read each configured program instance exactly once for an agenda-style
 * projection. Instance identity belongs in the status key and in the launcher
 * call; the launcher id alone identifies only the adapter family.
 */
import { programStatusKey } from '#domains/school/agenda.mjs';

export async function collectProgramStatuses({
  plan, learnerId, launchers = new Map(), logger = console,
  logEvent = 'school.program-status.launcher-failed',
} = {}) {
  const programs = new Map();
  (plan?.entries ?? []).filter((entry) => entry?.program).forEach((entry) => {
    const key = programStatusKey(entry);
    if (!programs.has(key)) programs.set(key, {
      key, programId: entry.program, programInstance: entry.programInstance ?? null,
    });
  });

  const statuses = {};
  await Promise.all([...programs.values()].map(async ({ key, programId, programInstance }) => {
    try {
      const launcher = launchers.get(programId);
      if (!launcher) throw new Error(`no launcher registered for program "${programId}"`);
      statuses[key] = await launcher.status({ userId: learnerId, programInstance });
    } catch (err) {
      logger.warn?.(logEvent, {
        learnerId, program: programId, programInstance, error: err?.message ?? String(err),
      });
      statuses[key] = { error: true };
    }
  }));
  return statuses;
}

export default collectProgramStatuses;
