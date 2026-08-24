/**
 * Read each configured program instance exactly once for an agenda-style
 * projection. Instance identity belongs in the status key and in the launcher
 * call; the launcher id alone identifies only the adapter family.
 */
export async function collectProgramStatuses({
  plan, learnerId, launchers = new Map(), logger = console,
  logEvent = 'school.program-status.launcher-failed',
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
