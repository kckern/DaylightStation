/** Project active append-only exceptions into planner evidence without
 * pretending they are grades or mastery. */
export function withCurriculumExceptions(history, exceptions, learnerId) {
  const synthetic = (exceptions ?? [])
    .filter((exception) => exception.learnerId === learnerId
      && (exception.kind === 'excused' || exception.kind === 'replaced'))
    .flatMap((exception) => (exception.resolvedLessonIds ?? []).map((unitId) => ({
      sessionId: `exception:${exception.exceptionId}:${unitId}`,
      learnerId,
      unitId,
      outcome: { result: 'passed' },
      terminal: true,
      curriculumException: {
        exceptionId: exception.exceptionId,
        status: exception.kind,
        replacementLessonId: exception.replacementLessonId ?? null,
      },
      updatedAt: exception.decidedAt,
    })));
  return synthetic.length ? [...history, ...synthetic] : history;
}

export function pausedExceptionFor(exceptions, unitId) {
  return (exceptions ?? []).find((exception) => exception.kind === 'paused'
    && exception.resolvedLessonIds?.includes(unitId)) ?? null;
}
