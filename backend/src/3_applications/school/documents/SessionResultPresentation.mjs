/** Build the visual model for an effective or original machine result. */
export function prepareSessionResultPresentation(session, { kind = 'effective' } = {}) {
  const correction = session?.state?.gradeAdjustments?.filter((row) => !row.retracted).at(-1);
  return {
    title: session?.taxonomy?.lessonTitle ?? session?.state?.unitId ?? 'School work',
    subtitle: `${kind === 'machine' ? 'Original machine score' : 'Current effective score'} · Revision ${session?.revision ?? '—'}`,
    score: kind === 'machine' ? session?.scores?.machine : session?.scores?.effective,
    sessionId: session?.sessionId,
    kind,
    items: (session?.reviewEvidence ?? []).map((item, index) => {
      const adjusted = correction?.itemVerdicts?.find((row) => row.itemId === item.itemId);
      const verdict = kind === 'effective' && adjusted && adjusted.voided !== true
        ? (adjusted.correct ? 'correct' : 'incorrect')
        : (item.verdict ?? 'unresolved');
      return { questionNumber: item.questionNumber ?? index + 1, given: item.given, verdict };
    }),
  };
}

export function prepareMachineScanResultPresentation({ sessionId, unitId, card }) {
  const correctCount = card.results.filter((row) => row.status === 'correct').length;
  const totalCount = card.results.length;
  return prepareSessionResultPresentation({
    sessionId, revision: 1, taxonomy: { lessonTitle: unitId ?? card.documentId },
    scores: { machine: { percent: totalCount ? Math.round((correctCount / totalCount) * 10000) / 100 : 0,
      correctCount, totalCount } },
    reviewEvidence: card.results.map((row) => ({ itemId: row.itemId, questionNumber: row.row,
      given: row.given, verdict: row.status })),
    state: { unitId, gradeAdjustments: [] },
  }, { kind: 'machine' });
}
