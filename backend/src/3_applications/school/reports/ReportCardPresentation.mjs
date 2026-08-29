/** Add transient report aggregates required by the printable presentation. */
export function prepareReportCardPresentation(report) {
  return {
    ...report,
    courses: (report?.courses ?? []).map((course) => ({
      ...course,
      attemptedCount: (course.unitGrades ?? []).filter((unit) => (unit.attempts ?? 0) > 0).length,
      passedCount: (course.unitGrades ?? []).filter((unit) => unit.passed === true).length,
    })),
  };
}

export default prepareReportCardPresentation;
