/**
 * The startup half of the reachability guarantee (design:
 * 2026-08-26-story-time-reachability-design §5.2).
 *
 * The per-projection fault is the safety net — it surfaces on the status board
 * every morning and cannot be forgotten. This is the FAST signal: one line at
 * boot naming any program the house is configured to assign but not to start.
 * Both exist because they fail differently. A boot line is seen once, by
 * whoever happened to be deploying; a daily fault is seen by whoever is
 * teaching. Today's bug survived because neither existed.
 *
 * A WARN, NEVER A THROW. A household mid-setup is a legitimate state, and
 * refusing to boot would take four children's school day down over one child's
 * misconfigured program. The agenda still tells the truth either way.
 *
 * Layer: COMPOSITION. It reads launchers (application objects) and logs; the
 * decision itself is the pure domain function it delegates to.
 */
import { unreachablePrograms } from '#domains/school/reachability.mjs';

/**
 * @param {object} args
 * @param {Map<string, {entryAction?: string|null}>|null} args.launchers
 * @param {Set<string>|string[]|null} args.declared - every declared
 *   `learner_action`; `null` when the trigger config could not be read.
 * @param {object} [args.logger]
 * @returns {Array<{programId: string, entryAction: string}>} what was reported
 */
export function reportUnreachableSchoolPrograms({ launchers, declared, logger = console } = {}) {
  if (!launchers || typeof launchers.entries !== 'function') return [];
  const programs = [...launchers.entries()].map(([programId, launcher]) => ({
    programId,
    // Duck-typed launchers do not extend `IProgramLauncher`, so this getter is
    // frequently absent rather than null. Both mean the same thing — not
    // entered by a tap — and the domain function treats them alike.
    entryAction: launcher?.entryAction ?? null,
  }));

  const unreachable = unreachablePrograms({ programs, declaredActions: declared });
  for (const program of unreachable) {
    logger.warn?.('school.program.no-entry-point', {
      program: program.programId,
      entryAction: program.entryAction,
      // Named explicitly because it is the whole fix: somebody has to add this
      // `learner_action` to a reader in triggers/sources.yml.
      remedy: `declare learner_action: ${program.entryAction} on a trigger source`,
      configUnreadable: declared === null || declared === undefined,
    });
  }
  return unreachable;
}

export default reportUnreachableSchoolPrograms;
