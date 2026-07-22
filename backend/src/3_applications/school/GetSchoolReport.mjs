import { normalizeReport, compareReports } from '#domains/school/reporting.mjs';

/**
 * The aggregate view: every program × every learner, in one shape.
 *
 * This use case knows nothing about quizzes, courses or sentence ladders. It
 * asks each registered reporter for its rows, normalises them against the
 * closed metric set, and orders the result so the board answers "who needs
 * attention" from the top down. Adding a program means registering a reporter,
 * not editing this file.
 *
 * Reports are derived on every read, never stored — the same rule the attempt
 * log holds to, so a parent's reassignment moves the evidence and the
 * statistics together.
 */
export class GetSchoolReport {
  #reporters; #userService; #logger;

  constructor({ reporters = [], userService, logger = console }) {
    this.#reporters = reporters.filter(Boolean);
    this.#userService = userService;
    this.#logger = logger;
  }

  #roster() {
    const profiles = [...this.#userService.getAllProfiles().values()];
    return profiles
      .map((p) => ({ id: p.username, name: p.display_name || p.username }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * @param {object} [args]
   * @param {string} [args.userId] - one learner; omit for the whole household.
   * @returns {Promise<{learners: Array}>}
   */
  async execute({ userId = null } = {}) {
    const roster = this.#roster();
    const learners = userId ? roster.filter((l) => l.id === userId) : roster;

    const rows = await Promise.all(learners.map(async (learner) => {
      const reports = [];

      for (const reporter of this.#reporters) {
        // One program failing must not blank the board for the rest. This is
        // the whole reason each reporter is called in its own try: a thrown
        // error here would cost the parent every other program's status.
        try {
          const raw = await reporter.summarize({ userId: learner.id });
          for (const report of (Array.isArray(raw) ? raw : [])) {
            const normalized = normalizeReport(report, { logger: this.#logger });
            if (normalized) reports.push(normalized);
          }
        } catch (err) {
          this.#logger.error?.('school.report.reporter-failed', {
            program: reporter.id, userId: learner.id, error: err.message,
          });
        }
      }

      reports.sort(compareReports);
      return {
        ...learner,
        reports,
        // Cheap top-line answers so the household view does not have to
        // re-derive them per card.
        needsAttention: reports.some((r) => r.state === 'blocked'),
        active: reports.filter((r) => r.state === 'active').length,
      };
    }));

    // A learner studying nothing is not a row worth rendering on the household
    // board; asked for explicitly by id, they still get their (empty) row.
    return { learners: userId ? rows : rows.filter((r) => r.reports.length > 0) };
  }
}

export default GetSchoolReport;
